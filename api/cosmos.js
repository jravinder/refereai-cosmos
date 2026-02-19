// Vercel serverless proxy to Jetson Cosmos endpoint
// Avoids mixed-content (HTTPS→HTTP) and hides Jetson IP
// Env vars: COSMOS_BACKEND_URL, COSMOS_API_KEY

export default async function handler(req, res) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const t0 = Date.now();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // API key gate
  const apiKey = process.env.COSMOS_API_KEY;
  const provided = req.headers['x-cosmos-key'];
  if (!apiKey || provided !== apiKey) {
    console.log(`[${requestId}] AUTH_FAIL ip=${req.headers['x-forwarded-for'] || 'unknown'}`);
    return res.status(401).json({ error: 'Unauthorized' });
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
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
