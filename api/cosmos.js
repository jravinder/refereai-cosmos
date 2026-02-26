// Vercel serverless proxy to Jetson Cosmos endpoint
// Avoids mixed-content (HTTPS→HTTP) and hides Jetson IP
// Env vars: COSMOS_BACKEND_URL, COSMOS_API_KEY

export default async function handler(req, res) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Rate-limit logging (no client auth — backend key handles real auth)
  const clientIp = req.headers['x-forwarded-for'] || 'unknown';
  console.log(`[${requestId}] ip=${clientIp}`);

  // ── Guardrails: payload validation ──
  const bodyStr = JSON.stringify(req.body || {});
  const bodySizeKB = bodyStr.length / 1024;

  // Block oversized payloads (>10MB — base64 images can be large)
  if (bodySizeKB > 10240) {
    console.log(`[${requestId}] BLOCKED size=${bodySizeKB.toFixed(0)}KB`);
    return res.status(413).json({ error: 'Payload too large. Max 10MB.' });
  }

  // Validate request structure
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 5) {
    console.log(`[${requestId}] BLOCKED invalid_messages count=${messages?.length}`);
    return res.status(400).json({ error: 'Invalid request: expected 1-5 messages.' });
  }

  // Block prompt injection attempts in user messages
  const blockedPattern = /\b(ignore previous|forget instructions|disregard|you are now|new persona|system prompt|jailbreak)\b/i;
  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content :
      Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ') : '';
    if (msg.role === 'user' && blockedPattern.test(text)) {
      console.log(`[${requestId}] BLOCKED prompt_injection ip=${clientIp}`);
      return res.status(400).json({ error: 'Request blocked: please ask a sports-related question.' });
    }
  }

  // Cap max_tokens to prevent resource abuse
  if (req.body.max_tokens && req.body.max_tokens > 512) {
    req.body.max_tokens = 512;
  }

  const backendUrl = process.env.COSMOS_BACKEND_URL;
  if (!backendUrl) {
    console.log(`[${requestId}] NO_BACKEND`);
    return res.status(503).json({
      error: 'Live inference unavailable — Jetson endpoint not configured',
    });
  }

  // Extract request metadata for logging (don't log the full base64 payload)
  const model = req.body?.model || 'unknown';
  const msgCount = req.body?.messages?.length || 0;
  const maxTokens = req.body?.max_tokens || '?';
  const bodySize = JSON.stringify(req.body).length;

  console.log(`[${requestId}] REQ model=${model} msgs=${msgCount} max_tokens=${maxTokens} body=${(bodySize/1024).toFixed(1)}KB`);

  try {
    const backendHeaders = { 'Content-Type': 'application/json' };
    const backendKey = process.env.COSMOS_BACKEND_KEY;
    if (backendKey) {
      backendHeaders['Authorization'] = `Bearer ${backendKey}`;
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    const elapsed = Date.now() - t0;

    // Log response metadata
    const tokens = data.usage?.total_tokens || '?';
    const promptTokens = data.usage?.prompt_tokens || '?';
    const completionTokens = data.usage?.completion_tokens || '?';
    const finishReason = data.choices?.[0]?.finish_reason || '?';

    console.log(`[${requestId}] RES status=${response.status} elapsed=${elapsed}ms tokens=${promptTokens}+${completionTokens}=${tokens} finish=${finishReason}`);

    // Inject observability metadata into response
    data._refereai = {
      request_id: requestId,
      proxy_latency_ms: elapsed,
      backend: 'jetson-agx-orin',
      source: 'live',
    };

    return res.status(response.status).json(data);
  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error(`[${requestId}] ERR elapsed=${elapsed}ms error=${err.message}`);
    return res.status(502).json({
      error: `Cannot reach Jetson: ${err.message}`,
      _refereai: { request_id: requestId, proxy_latency_ms: elapsed, source: 'error' },
    });
  }
}
