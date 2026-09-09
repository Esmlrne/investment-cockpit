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
        error: "No historical data returned"
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
      .filter(x =>
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
      const result = new Array(values.length).fill(null);

      if (values.length < period) return result;

      let sum = 0;

      for (let i = 0; i < period; i++) {
        sum += values[i];
      }

      result[period - 1] = sum / period;

      const multiplier = 2 / (period + 1);

      for (let i = period; i < values.length; i++) {
        result[i] =
          (values[i] - result[i - 1]) * multiplier +
          result[i - 1];
      }

      return result;
    }

    function rsi(values, period = 14) {
      const result = new Array(values.length).fill(null);

      if (values.length <= period) return result;

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) gains += change;
        if (change < 0) losses += Math.abs(change);
      }

      let avgGain = gains / period;
      let avgLoss = losses / period;

      result[period] =
        avgLoss === 0
          ? 100
          : 100 - 100 / (1 + avgGain / avgLoss);

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain =
          (avgGain * (period - 1) + gain) / period;

        avgLoss =
          (avgLoss * (period - 1) + loss) / period;

        result[i] =
          avgLoss === 0
            ? 100
            : 100 - 100 / (1 + avgGain / avgLoss);
      }

      return result;
    }

    function candleAnalysis(candles) {
      const n = candles.length;

      const c = candles[n - 1];
      const p = candles[n - 2];

      const body = Math.abs(c.close - c.open);
      const range = c.high - c.low;

      const upperWick =
        c.high - Math.max(c.open, c.close);

      const lowerWick =
        Math.min(c.open, c.close) - c.low;

      const bullish = c.close > c.open;
      const bearish = c.close < c.open;

      let pattern = "NEUTRAL";
      let signal = "NEUTRAL";
      let strength = 0;

      if (
        bullish &&
        p.close < p.open &&
        c.open <= p.close &&
        c.close >= p.open
      ) {
        pattern = "BULLISH ENGULFING";
        signal = "BULLISH";
        strength = 3;
      } else if (
        bearish &&
        p.close > p.open &&
        c.open >= p.close &&
        c.close <= p.open
      ) {
        pattern = "BEARISH ENGULFING";
        signal = "BEARISH";
        strength = 3;
      } else if (
        range > 0 &&
        lowerWick >= body * 2 &&
        upperWick <= body &&
        c.close > c.low + range * 0.6
      ) {
        pattern = "HAMMER";
        signal = "BULLISH";
        strength = 2;
      } else if (
        range > 0 &&
        upperWick >= body * 2 &&
        lowerWick <= body &&
        c.close < c.low + range * 0.4
      ) {
        pattern = "SHOOTING STAR";
        signal = "BEARISH";
        strength = 2;
      } else if (
        range > 0 &&
        body <= range * 0.15
      ) {
        pattern = "DOJI";
        signal = "NEUTRAL";
        strength = 1;
      } else if (
        bullish &&
        body > range * 0.7
      ) {
        pattern = "STRONG BULLISH CANDLE";
        signal = "BULLISH";
        strength = 1;
      } else if (
        bearish &&
        body > range * 0.7
      ) {
        pattern = "STRONG BEARISH CANDLE";
        signal = "BEARISH";
        strength = 1;
      }

      return {
        pattern,
        signal,
        strength
      };
    }

    function structureAnalysis(candles) {
      const recent = candles.slice(-30);

      const highs = [];
      const lows = [];

      for (let i = 2; i < recent.length - 2; i++) {
        const c = recent[i];

        if (
          c.high > recent[i - 1].high &&
          c.high > recent[i - 2].high &&
          c.high > recent[i + 1].high &&
          c.high > recent[i + 2].high
        ) {
          highs.push(c.high);
        }

        if (
          c.low < recent[i - 1].low &&
          c.low < recent[i - 2].low &&
          c.low < recent[i + 1].low &&
          c.low < recent[i + 2].low
        ) {
          lows.push(c.low);
        }
      }

      if (highs.length < 2 || lows.length < 2) {
        return {
          direction: "SIDEWAYS",
          structure: "UNDEFINED",
          score: 0
        };
      }

      const lastHigh = highs[highs.length - 1];
      const previousHigh = highs[highs.length - 2];

      const lastLow = lows[lows.length - 1];
      const previousLow = lows[lows.length - 2];

      const higherHigh = lastHigh > previousHigh;
      const higherLow = lastLow > previousLow;

      const lowerHigh = lastHigh < previousHigh;
      const lowerLow = lastLow < previousLow;

      if (higherHigh && higherLow) {
        return {
          direction: "BULLISH",
          structure: "HIGHER HIGH + HIGHER LOW",
          score: 3
        };
      }

      if (lowerHigh && lowerLow) {
        return {
          direction: "BEARISH",
          structure: "LOWER HIGH + LOWER LOW",
          score: -3
        };
      }

      return {
        direction: "SIDEWAYS",
        structure: "MIXED MARKET STRUCTURE",
        score: 0
      };
    }

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);

    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, 26);

    const macd = closes.map((_, i) => {
      if (ema12[i] === null || ema26[i] === null) {
        return null;
      }

      return ema12[i] - ema26[i];
    });

    const macdValues = macd.filter(x => x !== null);
    const signalValues = ema(macdValues, 9);

    const macdSignal = new Array(closes.length).fill(null);

    let si = 0;

    for (let i = 0; i < closes.length; i++) {
      if (macd[i] !== null) {
        macdSignal[i] = signalValues[si];
        si++;
      }
    }

    const macdHistogram = macd.map((x, i) => {
      if (x === null || macdSignal[i] === null) {
        return null;
      }

      return x - macdSignal[i];
    });

    const rsiValues = rsi(closes);

    const structure = structureAnalysis(history);
    const candle = candleAnalysis(history);

    const price = closes[closes.length - 1];

    const currentSMA20 = sma20[sma20.length - 1];
    const currentSMA50 = sma50[sma50.length - 1];

    const currentRSI = rsiValues[rsiValues.length - 1];

    const currentMACD = macd[macd.length - 1];
    const currentMACDSignal =
      macdSignal[macdSignal.length - 1];

    let trendScore = 0;

    if (price > currentSMA20) trendScore += 2;
    else trendScore -= 2;

    if (price > currentSMA50) trendScore += 2;
    else trendScore -= 2;

    if (currentSMA20 > currentSMA50) trendScore += 2;
    else trendScore -= 2;

    if (currentMACD > currentMACDSignal) {
      trendScore += 2;
    } else {
      trendScore -= 2;
    }

    trendScore += structure.score;

    let trend = "SIDEWAYS";

    if (trendScore >= 5) {
      trend = "BULLISH";
    } else if (trendScore <= -5) {
      trend = "BEARISH";
    }

    let confidence =
      50 + Math.abs(trendScore) * 5;

    if (confidence > 95) confidence = 95;

    let candleAdjusted = false;

    if (
      candle.signal === "BULLISH" &&
      trend === "BULLISH"
    ) {
      confidence += 3;
      candleAdjusted = true;
    }

    if (
      candle.signal === "BEARISH" &&
      trend === "BEARISH"
    ) {
      confidence += 3;
      candleAdjusted = true;
    }

    if (confidence > 95) confidence = 95;

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

    if (currentRSI >= 50 && currentRSI <= 70) {
      score += 10;
      reasons.push(
        "RSI shows healthy positive momentum."
      );
    } else if (currentRSI > 70) {
      score -= 5;
      risks.push(
        "RSI indicates potentially overbought conditions."
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

    if (currentMACD > currentMACDSignal) {
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

    if (structure.direction === "BULLISH") {
      score += 5;
      reasons.push(
        "Market structure shows higher highs and higher lows."
      );
    }

    if (structure.direction === "BEARISH") {
      score -= 5;
      risks.push(
        "Market structure shows lower highs and lower lows."
      );
    }

    if (candle.signal === "BULLISH") {
      reasons.push(
        `${candle.pattern} detected on the latest candle.`
      );
    }

    if (candle.signal === "BEARISH") {
      risks.push(
        `${candle.pattern} detected on the latest candle.`
      );
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
      closes[closes.length - 2];

    const change_pct =
      previousClose !== 0
        ? ((price - previousClose) /
            previousClose) *
          100
        : 0;

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
        macd[i] !== null
          ? Number(macd[i].toFixed(4))
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

    return res.status(200).json({
      symbol: ticker,
      name: ticker,

      price: Number(price.toFixed(2)),
      change_pct: Number(change_pct.toFixed(2)),

      score,
      signal,

      trend,
      trend_score: trendScore,
      trend_confidence: confidence,

      structure: structure.structure,
      structure_direction: structure.direction,

      candle_pattern: candle.pattern,
      candle_signal: candle.signal,
      candle_strength: candle.strength,

      rsi:
        currentRSI !== null
          ? Number(currentRSI.toFixed(1))
          : null,

      entry_low: Number(support.toFixed(2)),

      entry_high: Number(
        (currentSMA20 || price).toFixed(2)
      ),

      stop: Number(
        (support * 0.97).toFixed(2)
      ),

      target1: Number(
        (price * 1.10).toFixed(2)
      ),

      target2: Number(
        (price * 1.20).toFixed(2)
      ),

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
        resistance: Number(resistance.toFixed(2)),

        macd:
          currentMACD !== null
            ? Number(currentMACD.toFixed(4))
            : null,

        macd_signal:
          currentMACDSignal !== null
            ? Number(currentMACDSignal.toFixed(4))
            : null
      },

      history: chartHistory
    });

  } catch (error) {
    return res.status(500).json({
      error: "Failed to calculate technical analysis"
    });
  }
}
