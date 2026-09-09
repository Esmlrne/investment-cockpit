export default async function handler(req, res) {
  const symbol = req.query.symbol;

  if (!symbol) {
    return res.status(400).json({
      error: "Missing symbol"
    });
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "API key is not configured"
    });
  }

  try {
    const url =
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data["Error Message"]) {
      return res.status(400).json({
        error: data["Error Message"]
      });
    }

    if (!data["Global Quote"]) {
      return res.status(502).json({
        error: "No quote data returned",
        details: data
      });
    }

    return res.status(200).json(data["Global Quote"]);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch market data"
    });
  }
}
