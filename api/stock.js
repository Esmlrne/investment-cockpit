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
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(
        ticker
      )}&outputsize=compact&apikey=${key}`
    );

    const data = await response.json();

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage rate limit reached. Please try again later."
      });
    }

    if (data["Error Message"]) {
      return res.status(404).json({
        error: "Ticker not found"
      });
    }

    const series = data["Time Series (Daily)"];

    if (!series) {
      return res.status(404).json({
        error: "No historical data returned for this ticker"
      });
    }

    const dates = Object.keys(series).sort();

    const history = dates
      .map(date => ({
        date,
        open: Number(series[date]["1. open"]),
        high: Number(series[date]["2. high"]),
        low: Number(series[date]["3. low"]),
        close: Number(series[date]["4. close"]),
        volume: Number(series[date]["5. volume"])
      }))
      .filter(
        x =>
          Number.isFinite(x.open) &&
          Number.isFinite(x.high) &&
          Number.isFinite(x.low) &&
          Number.isFinite(x.close)
      );

    if (history.length < 50) {
      return res.status(404).json({
        error: "Not enough historical data"
      });
    }

    const closes = history.map(x => x.close);

    function sma(values, period) {
      if (values.length < period) return null;

      const result = new Array(values.length).fill(null);

      for (let i = period - 1; i < values.length; i++) {
        let sum = 0;

        for (let j = i - period + 1; j <= i; j++) {
          sum += values[j];
        }

        result[i] = sum / period;
      }

      return result;
    }

    function ema(values, period) {
      if (values.length < period) {
        return new Array(values.length).fill(null);
      }

      const result = new Array(values.length).fill(null);

      let sum = 0;

      for (let i = 0; i < period; i++) {
        sum += values[i];
      }

      result[period - 1] = sum / period;

      const multiplier = 2 / (period + 1);

      for (let i = period; i < values.length; i++) {
        result[i] =
          (values[i] - result[i - 1]) * multiplier + result[i - 1];
      }

      return result;
    }

    function calculateRSI(values, period = 14) {
      const result = new Array(values.length).fill(null);

      if (values.length <= period) return result;

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change >= 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      let averageGain = gains / period;
      let averageLoss = losses / period;

      if (averageLoss === 0) {
        result[period] = 100;
      } else {
        const rs = averageGain / averageLoss;
        result[period] = 100 - 100 / (1 + rs);
      }

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        averageGain =
          (averageGain * (period - 1) + gain) / period;

        averageLoss =
          (averageLoss * (period - 1) + loss) / period;

        if (averageLoss === 0) {
          result[i] = 100;
        } else {
          const rs = averageGain / averageLoss;
          result[i] = 100 - 100 / (1 + rs);
        }
      }

      return result;
    }

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);

    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);

    const macdLine = new Array(closes.length).fill(null);

    for (let i = 0; i < closes.length; i++) {
      if (ema12[i] !== null && ema26[i] !== null) {
        macdLine[i] = ema12[i] - ema26[i];
      }
    }

    const macdValues = macdLine.filter(x => x !== null);
    const macdSignalValues = ema(macdValues, 9);

    const macdSignal = new Array(closes.length).fill(null);

    let signalIndex = 0;

    for (let i = 0; i < closes.length; i++) {
      if (macdLine[i] !== null) {
        macdSignal[i] = macdSignalValues[signalIndex];
        signalIndex++;
      }
    }

    const macdHistogram = new Array(closes.length).fill(null);

    for (let i = 0; i < closes.length; i++) {
      if (
        macdLine[i] !== null &&
        macdSignal[i] !== null
      ) {
        macdHistogram[i] =
          macdLine[i] - macdSignal[i];
      }
    }

    const rsiValues = calculateRSI(closes, 14);

    const chartHistory = history.map((item, i) => ({
      date: item.date,
      open: Number(item.open.toFixed(2)),
      high: Number(item.high.toFixed(2)),
      low: Number(item.low.toFixed(2)),
      close: Number(item.close.toFixed(2)),
      volume: item.volume,
      sma20:
        sma20[i] !== null
          ? Number(sma20[i].toFixed(2))
          : null,
      sma50:
        sma50[i] !== null
          ? Number(sma50[i].toFixed(2))
          : null,
      rsi:
        rsiValues[i] !== null
          ? Number(rsiValues[i].toFixed(1))
          : null,
      macd:
        macdLine[i] !== null
          ? Number(macdLine[i].toFixed(4))
          : null,
      macdSignal:
        macdSignal[i] !== null
          ? Number(macdSignal[i].toFixed(4))
          : null,
      macdHistogram:
        macdHistogram[i] !== null
          ? Number(macdHistogram[i].toFixed(4))
          : null
    }));

    const price = closes[closes.length - 1];

    const previousClose =
      closes.length >= 2
        ? closes[closes.length - 2]
        : price;

    const change_pct =
      previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : 0;

    const currentSMA20 = sma20[sma20.length - 1];
    const currentSMA50 = sma50[sma50.length - 1];
    const currentRSI = rsiValues[rsiValues.length - 1];

    const recent = history.slice(-20);

    const support = Math.min(
      ...recent.map(x => x.low)
    );

    const resistance = Math.max(
      ...recent.map(x => x.high)
    );

    let score = 50;

    const reasons = [];
    const risks = [];

    if (currentSMA20 !== null) {
      if (price > currentSMA20) {
        score += 10;
        reasons.push(
          "Price is above the 20-day moving average."
        );
      } else {
        score -= 10;
        risks.push(
          "Price is below the 20-day moving average."
        );
      }
    }

    if (currentSMA50 !== null) {
      if (price > currentSMA50) {
        score += 15;
        reasons.push(
          "Price is above the 50-day moving average."
        );
      } else {
        score -= 15;
        risks.push(
          "Price is below the 50-day moving average."
        );
      }
    }

    if (
      currentSMA20 !== null &&
      currentSMA50 !== null
    ) {
      if (currentSMA20 > currentSMA50) {
        score += 10;
        reasons.push(
          "20-day trend is above the 50-day trend."
        );
      } else {
        score -= 10;
        risks.push(
          "20-day trend is below the 50-day trend."
        );
      }
    }

    if (currentRSI !== null) {
      if (
        currentRSI >= 50 &&
        currentRSI <= 70
      ) {
        score += 10;
        reasons.push(
          "RSI shows healthy positive momentum."
        );
      } else if (currentRSI > 70) {
        score -= 5;
        risks.push(
          "RSI indicates the stock may be overbought."
        );
      } else if (currentRSI < 30) {
        score += 5;
        reasons.push(
          "RSI indicates potentially oversold conditions."
        );
      } else {
        risks.push(
          "RSI does not currently show strong momentum."
        );
      }
    }

    const currentMACD =
      macdLine[macdLine.length - 1];

    const currentSignal =
      macdSignal[macdSignal.length - 1];

    if (
      currentMACD !== null &&
      currentSignal !== null
    ) {
      if (currentMACD > currentSignal) {
        score += 5;
        reasons.push(
          "MACD is above its signal line."
        );
      } else {
        score -= 5;
        risks.push(
          "MACD is below its signal line."
        );
      }
    }

    score = Math.max(
      0,
      Math.min(100, score)
    );

    let signal = "WATCH";

    if (score >= 75) {
      signal = "STRONG BUY";
    } else if (score >= 60) {
      signal = "BUY";
    } else if (score < 40) {
      signal = "SELL";
    }

    const entryLow = support;
    const entryHigh =
      currentSMA20 !== null
        ? currentSMA20
        : price;

    const stop = support * 0.97;

    const target1 = price * 1.10;
    const target2 = price * 1.20;

    return res.status(200).json({
      symbol: ticker,
      name: ticker,
      price: Number(price.toFixed(2)),
      change_pct: Number(change_pct.toFixed(2)),
      score,
      signal,

      rsi:
        currentRSI !== null
          ? Number(currentRSI.toFixed(1))
          : null,

      entry_low: Number(entryLow.toFixed(2)),
      entry_high: Number(entryHigh.toFixed(2)),
      stop: Number(stop.toFixed(2)),
      target1: Number(target1.toFixed(2)),
      target2: Number(target2.toFixed(2)),

      reasons,
      risks,

      fundamentals: {
        sma20:
          currentSMA20 !== null
            ? Number(currentSMA20.toFixed(2))
            : null,

        sma50:
          currentSMA50 !== null
            ? Number(currentSMA50.toFixed(2))
            : null,

        support: Number(support.toFixed(2)),
        resistance: Number(resistance.toFixed(2))
      },

      history: chartHistory
    });

  } catch (error) {
    return res.status(500).json({
      error: "Failed to calculate technical analysis"
    });
  }
}
