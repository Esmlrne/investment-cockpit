export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "").trim().toUpperCase();

  if (!/^[A-Z.]{1,8}$/.test(ticker)) {
    return res.status(400).json({ error: "Invalid US ticker" });
  }

  const key = process.env.ALPHA_VANTAGE_API_KEY;

  if (!key) {
    return res.status(500).json({
      error: "ALPHA_VANTAGE_API_KEY is not configured in Vercel"
    });
  }

  try {
    const response = await fetch(
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${key}`
    );

    const data = await response.json();

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage rate limit reached. Please try again later."
      });
    }

    const series = data["Time Series (Daily)"];

    if (!series) {
      return res.status(404).json({
        error: "No historical data returned for this ticker"
      });
    }

    const dates = Object.keys(series).sort();

    const closes = dates
      .map(date => Number(series[date]["4. close"]))
      .filter(Number.isFinite);

    if (closes.length < 50) {
      return res.status(404).json({
        error: "Not enough historical data"
      });
    }

    const price = closes[closes.length - 1];

    function sma(values, period) {
      if (values.length < period) return null;

      const slice = values.slice(-period);

      return slice.reduce((a, b) => a + b, 0) / period;
    }

    function calculateRSI(values, period = 14) {
      if (values.length <= period) return null;

      let gains = 0;
      let losses = 0;

      for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      if (losses === 0) return 100;

      const averageGain = gains / period;
      const averageLoss = losses / period;

      const rs = averageGain / averageLoss;

      return 100 - 100 / (1 + rs);
    }

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const rsi = calculateRSI(closes, 14);

    let score = 50;
    const reasons = [];
    const risks = [];

    if (price > sma20) {
      score += 10;
      reasons.push("Price is above the 20-day moving average.");
    } else {
      score -= 10;
      risks.push("Price is below the 20-day moving average.");
    }

    if (price > sma50) {
      score += 15;
      reasons.push("Price is above the 50-day moving average.");
    } else {
      score -= 15;
      risks.push("Price is below the 50-day moving average.");
    }

    if (sma20 > sma50) {
      score += 10;
      reasons.push("20-day trend is above the 50-day trend.");
    } else {
      score -= 10;
      risks.push("20-day trend is below the 50-day trend.");
    }

    if (rsi !== null) {
      if (rsi >= 50 && rsi <= 70) {
        score += 10;
        reasons.push("RSI shows healthy positive momentum.");
      } else if (rsi > 70) {
        score -= 5;
        risks.push("RSI indicates the stock may be overbought.");
      } else if (rsi < 30) {
        score += 5;
        reasons.push("RSI indicates potentially oversold conditions.");
      } else {
        risks.push("RSI does not currently show strong momentum.");
      }
    }

    score = Math.max(0, Math.min(100, score));

    let signal = "WATCH";

    if (score >= 75) {
      signal = "STRONG BUY";
    } else if (score >= 60) {
      signal = "BUY";
    } else if (score < 40) {
      signal = "SELL";
    }

    const previousClose =
      closes.length >= 2 ? closes[closes.length - 2] : price;

    const change_pct =
      previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;

    const support = Math.min(...closes.slice(-20));
    const resistance = Math.max(...closes.slice(-20));

    return res.status(200).json({
      symbol: ticker,
      name: ticker,
      price,
      change_pct: Number(change_pct.toFixed(2)),
      score,
      signal,
      rsi: Number(rsi.toFixed(1)),
      entry_low: Number(support.toFixed(2)),
      entry_high: Number(sma20.toFixed(2)),
      stop: Number((support * 0.97).toFixed(2)),
      target1: Number((price * 1.1).toFixed(2)),
      target2: Number((price * 1.2).toFixed(2)),
      reasons,
      risks,
      fundamentals: {
        sma20: Number(sma20.toFixed(2)),
        sma50: Number(sma50.toFixed(2)),
        support: Number(support.toFixed(2)),
        resistance: Number(resistance.toFixed(2))
      }
    });

  } catch (error) {
    return res.status(500).json({
      error: "Failed to calculate technical analysis"
    });
  }
}
