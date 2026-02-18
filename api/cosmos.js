// Vercel serverless proxy to Jetson Cosmos endpoint
// Avoids mixed-content (HTTPS→HTTP) and hides Jetson IP
// Set COSMOS_BACKEND_URL env var in Vercel dashboard

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const backendUrl = process.env.COSMOS_BACKEND_URL;
  if (!backendUrl) {
    return res.status(503).json({
      error: 'Live inference unavailable — Jetson endpoint not configured',
      hint: 'Set COSMOS_BACKEND_URL in Vercel environment variables (e.g. http://<tailscale-ip>:8000/v1/chat/completions)',
    });
  }

  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({
      error: `Cannot reach Jetson: ${err.message}`,
      hint: 'Ensure Jetson is online and reachable via Tailscale',
    });
  }
}
