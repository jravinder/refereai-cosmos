// Vercel serverless proxy to Jetson Cosmos endpoint
// Avoids mixed-content (HTTPS→HTTP) and hides Jetson IP
// Env vars: COSMOS_BACKEND_URL, COSMOS_API_KEY

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // API key gate — reject requests without valid key
  const apiKey = process.env.COSMOS_API_KEY;
  const provided = req.headers['x-cosmos-key'];
  if (!apiKey || provided !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const backendUrl = process.env.COSMOS_BACKEND_URL;
  if (!backendUrl) {
    return res.status(503).json({
      error: 'Live inference unavailable — Jetson endpoint not configured',
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
    });
  }
}
