const cache = globalThis.__investmentCockpitQuoteCache ||
  new Map();

globalThis.__investmentCockpitQuoteCache = cache;

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const AV_BASE = "https://www.alphavantage.co/query";

export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z.]{1,10}$/.test(ticker)) {
    return res.status(400).json({
      error: "Invalid ticker"
    });
  }

  const key = `quote:${ticker}`;
  const cached = cache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.status(200).json({
      ...cached.data,
      cached: true
    });
  }

  const apiKey = process.env.ALPHAVANTAGE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Alpha Vantage API key is not configured"
    });
  }

  try {
    const url =
      `${AV_BASE}?function=GLOBAL_QUOTE` +
      `&symbol=${encodeURIComponent(ticker)}` +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage rate limit reached",
        message: data.Note
      });
    }

    if (data["Error Message"]) {
      return res.status(400).json({
        error: "Alpha Vantage error",
        message: data["Error Message"]
      });
    }

    const quote = data["Global Quote"];

    if (!quote || !quote["05. price"]) {
      return res.status(404).json({
        error: `No quote available for ${ticker}`
      });
    }

    const price = Number(quote["05. price"]);
    const changePct = Number(
      String(quote["10. change percent"] || "")
        .replace("%", "")
    );

    const result = {
      symbol: ticker,
      price,
      change_pct: Number.isFinite(changePct)
        ? changePct
        : null,
      latest_trading_day:
        quote["07. latest trading day"] || null,
      cached: false,
      last_updated: new Date().toISOString()
    };

    cache.set(key, {
      timestamp: Date.now(),
      data: result
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error("Quote error:", error);

    return res.status(500).json({
      error: "Unable to retrieve quote"
    });
  }
}
