export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "").trim().toUpperCase();

  if (!/^[A-Z.]{1,8}$/.test(ticker)) {
    return res.status(400).json({
      error: "Invalid US ticker"
    });
  }

  const key = process.env.ALPHA_VANTAGE_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: "ALPHA_VANTAGE_API_KEY is not configured in Vercel"
    });
  }

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${key}`
    );

    const data = await response.json();

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage rate limit reached. Please try again later."
      });
    }

    const quote = data["Global Quote"];

    if (!quote || !quote["05. price"]) {
      return res.status(404).json({
        error: "Ticker not found or no quote returned"
      });
    }

    const price = Number(quote["05. price"]);

    const change_pct = Number(
      String(quote["10. change percent"] || "0").replace("%", "")
    );

    const score = 50;
    const signal = "WATCH";

    return res.status(200).json({
      symbol: ticker,
      name: ticker,
      price,
      change_pct,
      score,
      signal,
      rsi: null,
      entry_low: null,
      entry_high: null,
      stop: null,
      target1: null,
      target2: null,
      reasons: [
        "Live quote successfully retrieved.",
        "Full technical/fundamental scoring is the next engine upgrade."
      ],
      risks: [
        "The current V2 signal is intentionally WATCH until the full research engine is connected."
      ],
      fundamentals: {}
    });

  } catch (error) {
    return res.status(500).json({
      error: "Data provider request failed"
    });
  }
}
