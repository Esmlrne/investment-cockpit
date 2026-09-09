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

    /* =========================
       MOVING AVERAGES
    ========================= */

    function sma(values, period) {
      const result = new Array(values.length).fill(null);

      if (values.length < period) {
        return result;
      }

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

      if (values.length < period) {
        return result;
      }

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

    /* =========================
       RSI
    ========================= */

    function calculateRSI(values, period = 14) {
      const result = new Array(values.length).fill(null);

      if (values.length <= period) {
        return result;
      }

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      let averageGain = gains / period;
      let averageLoss = losses / period;

      result[period] =
        averageLoss === 0
          ? 100
          : 100 - 100 / (1 + averageGain / averageLoss);

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        averageGain =
          (averageGain * (period - 1) + gain) / period;

        averageLoss =
          (averageLoss * (period - 1) + loss) / period;

        result[i] =
          averageLoss === 0
            ? 100
            : 100 -
              100 /
                (1 + averageGain / averageLoss);
      }

      return result;
    }

    /* =========================
       MACD
    ========================= */

    function calculateMACD(values) {
      const ema12 = ema(values, 12);
      const ema26 = ema(values, 26);

      const macdLine = new Array(values.length).fill(null);

      for (let i = 0; i < values.length; i++) {
        if (
          ema12[i] !== null &&
          ema26[i] !== null
        ) {
          macdLine[i] = ema12[i] - ema26[i];
        }
      }

      const cleanMACD =
        macdLine.filter(x => x !== null);

      const signalClean =
        ema(cleanMACD, 9);

      const signal =
        new Array(values.length).fill(null);

      let index = 0;

      for (let i = 0; i < values.length; i++) {
        if (macdLine[i] !== null) {
          signal[i] = signalClean[index];
          index++;
        }
      }

      const histogram =
        new Array(values.length).fill(null);

      for (let i = 0; i < values.length; i++) {
        if (
          macdLine[i] !== null &&
          signal[i] !== null
        ) {
          histogram[i] =
            macdLine[i] - signal[i];
        }
      }

      return {
        macdLine,
        signal,
        histogram
      };
    }

    /* =========================
       CANDLESTICK ANALYSIS
    ========================= */

    function candleAnalysis(candles) {
      const n = candles.length;

      if (n < 3) {
        return {
          pattern: "NEUTRAL",
          signal: "NEUTRAL",
          strength: 0,
          description: "Not enough candle data."
        };
      }

      const c = candles[n - 1];
      const p = candles[n - 2];
      const p2 = candles[n - 3];

      const body = Math.abs(c.close - c.open);
      const range = c.high - c.low;

      const upperWick =
        c.high - Math.max(c.open, c.close);

      const lowerWick =
        Math.min(c.open, c.close) - c.low;

      const bullish = c.close > c.open;
      const bearish = c.close < c.open;

      const previousBullish =
        p.close > p.open;

      const previousBearish =
        p.close < p.open;

      const p2Bullish =
        p2.close > p2.open;

      const p2Bearish =
        p2.close < p2.open;

      let pattern = "NEUTRAL";
      let signal = "NEUTRAL";
      let strength = 0;
      let description =
        "No significant candlestick pattern.";

      /* Bullish engulfing */

      if (
        bullish &&
        previousBearish &&
        c.open <= p.close &&
        c.close >= p.open &&
        body > Math.abs(p.close - p.open)
      ) {
        pattern = "BULLISH ENGULFING";
        signal = "BULLISH";
        strength = 3;
        description =
          "Bullish candle completely engulfs the previous bearish candle.";
      }

      /* Bearish engulfing */

      else if (
        bearish &&
        previousBullish &&
        c.open >= p.close &&
        c.close <= p.open &&
        body > Math.abs(p.close - p.open)
      ) {
        pattern = "BEARISH ENGULFING";
        signal = "BEARISH";
        strength = 3;
        description =
          "Bearish candle completely engulfs the previous bullish candle.";
      }

      /* Morning star */

      else if (
        p2Bearish &&
        Math.abs(p.close - p.open) <
          Math.abs(p2.close - p2.open) * 0.45 &&
        bullish &&
        c.close >
          (p2.open + p2.close) / 2
      ) {
        pattern = "MORNING STAR";
        signal = "BULLISH";
        strength = 3;
        description =
          "Three-candle bullish reversal structure detected.";
      }

      /* Evening star */

      else if (
        p2Bullish &&
        Math.abs(p.close - p.open) <
          Math.abs(p2.close - p2.open) * 0.45 &&
        bearish &&
        c.close <
          (p2.open + p2.close) / 2
      ) {
        pattern = "EVENING STAR";
        signal = "BEARISH";
        strength = 3;
        description =
          "Three-candle bearish reversal structure detected.";
      }

      /* Hammer */

      else if (
        range > 0 &&
        lowerWick >= body * 2 &&
        upperWick <= body &&
        c.close > c.low + range * 0.6
      ) {
        pattern = "HAMMER";
        signal = "BULLISH";
        strength = 2;
        description =
          "Long lower wick shows rejection of lower prices.";
      }

      /* Shooting star */

      else if (
        range > 0 &&
        upperWick >= body * 2 &&
        lowerWick <= body &&
        c.close < c.low + range * 0.4
      ) {
        pattern = "SHOOTING STAR";
        signal = "BEARISH";
        strength = 2;
        description =
          "Long upper wick shows rejection of higher prices.";
      }

      /* Doji */

      else if (
        range > 0 &&
        body <= range * 0.15
      ) {
        pattern = "DOJI";
        signal = "NEUTRAL";
        strength = 1;
        description =
          "Indecision candle detected.";
      }

      /* Strong bullish */

      else if (
        range > 0 &&
        bullish &&
        body >= range * 0.70
      ) {
        pattern = "STRONG BULLISH CANDLE";
        signal = "BULLISH";
        strength = 1;
        description =
          "Strong buying pressure in the latest session.";
      }

      /* Strong bearish */

      else if (
        range > 0 &&
        bearish &&
        body >= range * 0.70
      ) {
        pattern = "STRONG BEARISH CANDLE";
        signal = "BEARISH";
        strength = 1;
        description =
          "Strong selling pressure in the latest session.";
      }

      return {
        pattern,
        signal,
        strength,
        description
      };
    }

    /* =========================
       MARKET STRUCTURE
    ========================= */

    function findPivots(candles) {
      const highs = [];
      const lows = [];

      const start =
        Math.max(2, candles.length - 45);

      const end =
        candles.length - 2;

      for (let i = start; i < end; i++) {

        const c = candles[i];

        const isHigh =
          c.high > candles[i - 1].high &&
          c.high > candles[i - 2].high &&
          c.high >= candles[i + 1].high &&
          c.high >= candles[i + 2].high;

        const isLow =
          c.low < candles[i - 1].low &&
          c.low < candles[i - 2].low &&
          c.low <= candles[i + 1].low &&
          c.low <= candles[i + 2].low;

        if (isHigh) {
          highs.push({
            index: i,
            value: c.high
          });
        }

        if (isLow) {
          lows.push({
            index: i,
            value: c.low
          });
        }
      }

      return {
        highs,
        lows
      };
    }

    function analyzeStructure(candles) {
      const pivots = findPivots(candles);

      const highs = pivots.highs;
      const lows = pivots.lows;

      if (
        highs.length < 2 ||
        lows.length < 2
      ) {
        return {
          direction: "SIDEWAYS",
          structure: "INSUFFICIENT STRUCTURE",
          score: 0,
          lastHigh: null,
          previousHigh: null,
          lastLow: null,
          previousLow: null
        };
      }

      const lastHigh =
        highs[highs.length - 1].value;

      const previousHigh =
        highs[highs.length - 2].value;

      const lastLow =
        lows[lows.length - 1].value;

      const previousLow =
        lows[lows.length - 2].value;

      const higherHigh =
        lastHigh > previousHigh;

      const higherLow =
        lastLow > previousLow;

      const lowerHigh =
        lastHigh < previousHigh;

      const lowerLow =
        lastLow < previousLow;

      if (higherHigh && higherLow) {
        return {
          direction: "BULLISH",
          structure:
            "HIGHER HIGH + HIGHER LOW",
          score: 3,
          lastHigh,
          previousHigh,
          lastLow,
          previousLow
        };
      }

      if (lowerHigh && lowerLow) {
        return {
          direction: "BEARISH",
          structure:
            "LOWER HIGH + LOWER LOW",
          score: -3,
          lastHigh,
          previousHigh,
          lastLow,
          previousLow
        };
      }

      if (higherHigh) {
        return {
          direction: "BULLISH",
          structure:
            "HIGHER HIGH / MIXED LOWS",
          score: 1,
          lastHigh,
          previousHigh,
          lastLow,
          previousLow
        };
      }

      if (lowerHigh) {
        return {
          direction: "BEARISH",
          structure:
            "LOWER HIGH / MIXED LOWS",
          score: -1,
          lastHigh,
          previousHigh,
          lastLow,
          previousLow
        };
      }

      return {
        direction: "SIDEWAYS",
        structure:
          "MIXED MARKET STRUCTURE",
        score: 0,
        lastHigh,
        previousHigh,
        lastLow,
        previousLow
      };
    }

    /* =========================
       BREAKOUT / BREAKDOWN
    ========================= */

    function analyzeBreakout(candles) {
      if (candles.length < 25) {
        return {
          type: "NONE",
          strength: 0
        };
      }

      const latest =
        candles[candles.length - 1];

      const previous =
        candles[candles.length - 2];

      const lookback =
        candles.slice(-21, -1);

      const resistance =
        Math.max(
          ...lookback.map(x => x.high)
        );

      const support =
        Math.min(
          ...lookback.map(x => x.low)
        );

      if (
        latest.close > resistance &&
        previous.close <= resistance
      ) {
        return {
          type: "BREAKOUT",
          strength: 3,
          level: resistance
        };
      }

      if (
        latest.close < support &&
        previous.close >= support
      ) {
        return {
          type: "BREAKDOWN",
          strength: -3,
          level: support
        };
      }

      return {
        type: "NONE",
        strength: 0,
        level: null
      };
    }

    /* =========================
       INDICATORS
    ========================= */

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);

    const rsiValues =
      calculateRSI(closes, 14);

    const macdData =
      calculateMACD(closes);

    const macdLine =
      macdData.macdLine;

    const macdSignal =
      macdData.signal;

    const macdHistogram =
      macdData.histogram;

    const price =
      closes[closes.length - 1];

    const previousClose =
      closes[closes.length - 2];

    const currentSMA20 =
      sma20[sma20.length - 1];

    const currentSMA50 =
      sma50[sma50.length - 1];

    const currentRSI =
      rsiValues[rsiValues.length - 1];

    const currentMACD =
      macdLine[macdLine.length - 1];

    const currentMACDSignal =
      macdSignal[macdSignal.length - 1];

    const currentHistogram =
      macdHistogram[macdHistogram.length - 1];

    const previousHistogram =
      macdHistogram[macdHistogram.length - 2];

    /* =========================
       STRUCTURE + CANDLE
    ========================= */

    const structure =
      analyzeStructure(history);

    const candle =
      candleAnalysis(history);

    const breakout =
      analyzeBreakout(history);

    /* =========================
       TREND SCORING
    ========================= */

    let trendScore = 0;

    /* Price vs SMA20 */

    if (
      currentSMA20 !== null
    ) {
      if (price > currentSMA20) {
        trendScore += 2;
      } else {
        trendScore -= 2;
      }
    }

    /* Price vs SMA50 */

    if (
      currentSMA50 !== null
    ) {
      if (price > currentSMA50) {
        trendScore += 2;
      } else {
        trendScore -= 2;
      }
    }

    /* SMA alignment */

    if (
      currentSMA20 !== null &&
      currentSMA50 !== null
    ) {
      if (
        currentSMA20 >
        currentSMA50
      ) {
        trendScore += 2;
      } else {
        trendScore -= 2;
      }
    }

    /* MACD */

    if (
      currentMACD !== null &&
      currentMACDSignal !== null
    ) {
      if (
        currentMACD >
        currentMACDSignal
      ) {
        trendScore += 2;
      } else {
        trendScore -= 2;
      }
    }

    /* Market structure */

    trendScore += structure.score;

    /* Breakout */

    trendScore += breakout.strength;

    /* =========================
       TREND CLASSIFICATION
    ========================= */

    let trend =
      "SIDEWAYS";

    if (trendScore >= 6) {
      trend = "BULLISH";
    } else if (trendScore <= -6) {
      trend = "BEARISH";
    }

    /* =========================
       SHORT-TERM MOMENTUM
    ========================= */

    let shortTermTrend =
      "NEUTRAL";

    if (
      currentSMA20 !== null &&
      price > currentSMA20 &&
      currentMACD !== null &&
      currentMACDSignal !== null &&
      currentMACD > currentMACDSignal
    ) {
      shortTermTrend =
        "BULLISH";
    }

    if (
      currentSMA20 !== null &&
      price < currentSMA20 &&
      currentMACD !== null &&
      currentMACDSignal !== null &&
      currentMACD < currentMACDSignal
    ) {
      shortTermTrend =
        "BEARISH";
    }

    /* =========================
       REVERSAL DETECTION
    ========================= */

    let reversal =
      "NONE";

    let reversalConfidence = 0;

    const histogramTurningBullish =
      previousHistogram !== null &&
      currentHistogram !== null &&
      currentHistogram >
        previousHistogram;

    const histogramTurningBearish =
      previousHistogram !== null &&
      currentHistogram !== null &&
      currentHistogram <
        previousHistogram;

    if (
      trend === "BEARISH" &&
      (
        candle.signal === "BULLISH" ||
        histogramTurningBullish ||
        (
          currentRSI !== null &&
          currentRSI < 40 &&
          currentRSI > 30
        )
      )
    ) {
      reversal =
        "BULLISH REVERSAL WATCH";

      reversalConfidence = 65;

      if (
        candle.signal === "BULLISH"
      ) {
        reversalConfidence += 10;
      }

      if (histogramTurningBullish) {
        reversalConfidence += 10;
      }

      if (
        currentRSI !== null &&
        currentRSI > 40
      ) {
        reversalConfidence += 5;
      }

      reversalConfidence =
        Math.min(
          90,
          reversalConfidence
        );
    }

    if (
      trend === "BULLISH" &&
      (
        candle.signal === "BEARISH" ||
        histogramTurningBearish ||
        (
          currentRSI !== null &&
          currentRSI > 60 &&
          currentRSI < 70
        )
      )
    ) {
      reversal =
        "BEARISH REVERSAL WATCH";

      reversalConfidence = 65;

      if (
        candle.signal === "BEARISH"
      ) {
        reversalConfidence += 10;
      }

      if (histogramTurningBearish) {
        reversalConfidence += 10;
      }

      reversalConfidence =
        Math.min(
          90,
          reversalConfidence
        );
    }

    /* =========================
       CANDLE CONTEXT
    ========================= */

    let candleContext =
      "NO STRONG CONTEXT";

    if (
      candle.signal === "BULLISH" &&
      price <=
        (currentSMA20 || price) &&
      currentRSI !== null &&
      currentRSI < 50
    ) {
      candleContext =
        "BULLISH REVERSAL CANDIDATE";
    }

    if (
      candle.signal === "BULLISH" &&
      price >
        (currentSMA20 || price) &&
      structure.direction === "BULLISH"
    ) {
      candleContext =
        "BULLISH TREND CONFIRMATION";
    }

    if (
      candle.signal === "BEARISH" &&
      price >=
        (currentSMA20 || price) &&
      currentRSI !== null &&
      currentRSI > 50
    ) {
      candleContext =
        "BEARISH REVERSAL CANDIDATE";
    }

    if (
      candle.signal === "BEARISH" &&
      price <
        (currentSMA20 || price) &&
      structure.direction === "BEARISH"
    ) {
      candleContext =
        "BEARISH TREND CONFIRMATION";
    }

    /* =========================
       CONFIDENCE
    ========================= */

    let trendConfidence =
      50 + Math.abs(trendScore) * 4;

    if (
      structure.direction === trend
    ) {
      trendConfidence += 5;
    }

    if (
      candle.signal === "BULLISH" &&
      trend === "BULLISH"
    ) {
      trendConfidence += 4;
    }

    if (
      candle.signal === "BEARISH" &&
      trend === "BEARISH"
    ) {
      trendConfidence += 4;
    }

    if (
      breakout.type === "BREAKOUT" &&
      trend === "BULLISH"
    ) {
      trendConfidence += 6;
    }

    if (
      breakout.type === "BREAKDOWN" &&
      trend === "BEARISH"
    ) {
      trendConfidence += 6;
    }

    trendConfidence =
      Math.max(
        50,
        Math.min(
          95,
          Math.round(trendConfidence)
        )
      );

    /* =========================
       SETUP CLASSIFICATION
    ========================= */

    let setup =
      "WAIT";

    if (
      breakout.type === "BREAKOUT" &&
      trend === "BULLISH"
    ) {
      setup =
        "BREAKOUT CONFIRMATION";
    } else if (
      breakout.type === "BREAKDOWN" &&
      trend === "BEARISH"
    ) {
      setup =
        "BEARISH BREAKDOWN";
    } else if (
      reversal === "BULLISH REVERSAL WATCH"
    ) {
      setup =
        "REVERSAL WATCH";
    } else if (
      reversal === "BEARISH REVERSAL WATCH"
    ) {
      setup =
        "REVERSAL RISK";
    } else if (
      trend === "BULLISH" &&
      shortTermTrend === "BULLISH" &&
      currentRSI !== null &&
      currentRSI < 65
    ) {
      setup =
        "BULLISH CONTINUATION";
    } else if (
      trend === "BULLISH" &&
      shortTermTrend === "BEARISH"
    ) {
      setup =
        "BUY ON PULLBACK";
    } else if (
      trend === "BEARISH" &&
      shortTermTrend === "BEARISH"
    ) {
      setup =
        "BEARISH CONTINUATION";
    } else if (
      trend === "SIDEWAYS"
    ) {
      setup =
        "RANGE / WAIT";
    }

    /* =========================
       INVESTMENT SCORE
    ========================= */

    let score = 50;

    const reasons = [];
    const risks = [];

    if (
      currentSMA20 !== null
    ) {
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

    if (
      currentSMA50 !== null
    ) {
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
      if (
        currentSMA20 >
        currentSMA50
      ) {
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

    if (
      currentRSI !== null
    ) {
      if (
        currentRSI >= 50 &&
        currentRSI <= 70
      ) {
        score += 10;

        reasons.push(
          "RSI shows healthy positive momentum."
        );
      } else if (
        currentRSI > 70
      ) {
        score -= 5;

        risks.push(
          "RSI indicates potentially overbought conditions."
        );
      } else if (
        currentRSI < 30
      ) {
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

    if (
      currentMACD !== null &&
      currentMACDSignal !== null
    ) {
      if (
        currentMACD >
        currentMACDSignal
      ) {
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

    if (
      structure.direction === "BULLISH"
    ) {
      score += 5;

      reasons.push(
        "Market structure shows higher highs and higher lows."
      );
    }

    if (
      structure.direction === "BEARISH"
    ) {
      score -= 5;

      risks.push(
        "Market structure shows lower highs and lower lows."
      );
    }

    if (
      breakout.type === "BREAKOUT"
    ) {
      score += 8;

      reasons.push(
        "Price has broken above recent resistance."
      );
    }

    if (
      breakout.type === "BREAKDOWN"
    ) {
      score -= 8;

      risks.push(
        "Price has broken below recent support."
      );
    }

    if (
      candle.signal === "BULLISH"
    ) {
      reasons.push(
        `${candle.pattern} detected: ${candle.description}`
      );
    }

    if (
      candle.signal === "BEARISH"
    ) {
      risks.push(
        `${candle.pattern} detected: ${candle.description}`
      );
    }

    score =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(score)
        )
      );

    let signal = "WATCH";

    if (score >= 75) {
      signal = "STRONG BUY";
    } else if (score >= 60) {
      signal = "BUY";
    } else if (score < 40) {
      signal = "SELL";
    }

    /* =========================
       LEVELS
    ========================= */

    const recent20 =
      history.slice(-20);

    const support =
      Math.min(
        ...recent20.map(x => x.low)
      );

    const resistance =
      Math.max(
        ...recent20.map(x => x.high)
      );

    const entryLow =
      support;

    const entryHigh =
      currentSMA20 !== null
        ? currentSMA20
        : price;

    const stop =
      support * 0.97;

    const target1 =
      price * 1.10;

    const target2 =
      price * 1.20;

    const change_pct =
      previousClose !== 0
        ? ((price - previousClose) /
            previousClose) *
          100
        : 0;

    /* =========================
       CHART DATA
    ========================= */

    const chartHistory =
      history.map((item, i) => ({
        date: item.date,

        open: Number(
          item.open.toFixed(2)
        ),

        high: Number(
          item.high.toFixed(2)
        ),

        low: Number(
          item.low.toFixed(2)
        ),

        close: Number(
          item.close.toFixed(2)
        ),

        volume: item.volume,

        sma20:
          sma20[i] !== null
            ? Number(
                sma20[i].toFixed(2)
              )
            : null,

        sma50:
          sma50[i] !== null
            ? Number(
                sma50[i].toFixed(2)
              )
            : null,

        rsi:
          rsiValues[i] !== null
            ? Number(
                rsiValues[i].toFixed(1)
              )
            : null,

        macd:
          macdLine[i] !== null
            ? Number(
                macdLine[i].toFixed(4)
              )
            : null,

        macdSignal:
          macdSignal[i] !== null
            ? Number(
                macdSignal[i].toFixed(4)
              )
            : null,

        macdHistogram:
          macdHistogram[i] !== null
            ? Number(
                macdHistogram[i].toFixed(4)
              )
            : null
      }));

    /* =========================
       RESPONSE
    ========================= */

    return res.status(200).json({

      symbol: ticker,
      name: ticker,

      price: Number(
        price.toFixed(2)
      ),

      change_pct: Number(
        change_pct.toFixed(2)
      ),

      /* Investment signal */

      score,
      signal,

      /* Trend intelligence */

      trend,
      trend_score: trendScore,
      trend_confidence: trendConfidence,

      short_term_trend:
        shortTermTrend,

      structure:
        structure.structure,

      structure_direction:
        structure.direction,

      reversal,
      reversal_confidence:
        reversalConfidence,

      setup,

      /* Candlestick intelligence */

      candle_pattern:
        candle.pattern,

      candle_signal:
        candle.signal,

      candle_strength:
        candle.strength,

      candle_context:
        candleContext,

      candle_description:
        candle.description,

      /* Breakout intelligence */

      breakout:
        breakout.type,

      breakout_level:
        breakout.level !== null
          ? Number(
              breakout.level.toFixed(2)
            )
          : null,

      /* Momentum */

      rsi:
        currentRSI !== null
          ? Number(
              currentRSI.toFixed(1)
            )
          : null,

      /* Trading levels */

      entry_low:
        Number(entryLow.toFixed(2)),

      entry_high:
        Number(entryHigh.toFixed(2)),

      stop:
        Number(stop.toFixed(2)),

      target1:
        Number(target1.toFixed(2)),

      target2:
        Number(target2.toFixed(2)),

      /* Explanation */

      reasons,
      risks,

      /* Technical fundamentals */

      fundamentals: {

        sma20:
          currentSMA20 !== null
            ? Number(
                currentSMA20.toFixed(2)
              )
            : null,

        sma50:
          currentSMA50 !== null
            ? Number(
                currentSMA50.toFixed(2)
              )
            : null,

        support:
          Number(
            support.toFixed(2)
          ),

        resistance:
          Number(
            resistance.toFixed(2)
          ),

        macd:
          currentMACD !== null
            ? Number(
                currentMACD.toFixed(4)
              )
            : null,

        macd_signal:
          currentMACDSignal !== null
            ? Number(
                currentMACDSignal.toFixed(4)
              )
            : null,

        macd_histogram:
          currentHistogram !== null
            ? Number(
                currentHistogram.toFixed(4)
              )
            : null
      },

      /* Chart */

      history: chartHistory
    });

  } catch (error) {

    return res.status(500).json({
      error:
        "Failed to calculate technical analysis"
    });
  }
}
