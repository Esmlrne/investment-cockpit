export default async function handler(req, res) {
  const ticker = String(req.query.ticker || "")
    .trim()
    .toUpperCase();

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
    /* =========================================================
       DATA
    ========================================================= */

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

    /* =========================================================
       HELPERS
    ========================================================= */

    function round(value, digits = 2) {
      return value == null
        ? null
        : Number(value.toFixed(digits));
    }

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

    function calculateRSI(values, period = 14) {
      const result = new Array(values.length).fill(null);

      if (values.length <= period) return result;

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) gains += change;
        else losses += Math.abs(change);
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
              100 / (1 + averageGain / averageLoss);
      }

      return result;
    }

    function calculateMACD(values) {
      const ema12 = ema(values, 12);
      const ema26 = ema(values, 26);

      const macdLine = new Array(values.length).fill(null);

      for (let i = 0; i < values.length; i++) {
        if (ema12[i] !== null && ema26[i] !== null) {
          macdLine[i] = ema12[i] - ema26[i];
        }
      }

      const clean = macdLine.filter(x => x !== null);
      const cleanSignal = ema(clean, 9);

      const signal = new Array(values.length).fill(null);

      let index = 0;

      for (let i = 0; i < values.length; i++) {
        if (macdLine[i] !== null) {
          signal[i] = cleanSignal[index];
          index++;
        }
      }

      const histogram = new Array(values.length).fill(null);

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

    /* =========================================================
       CANDLE ANALYSIS
    ========================================================= */

    function candleAnalysis(candles) {
      const n = candles.length;

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

      const previousBullish = p.close > p.open;
      const previousBearish = p.close < p.open;

      const p2Bullish = p2.close > p2.open;
      const p2Bearish = p2.close < p2.open;

      let pattern = "NEUTRAL";
      let signal = "NEUTRAL";
      let strength = 0;
      let description = "No significant candlestick pattern.";

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

      else if (
        p2Bearish &&
        Math.abs(p.close - p.open) <
          Math.abs(p2.close - p2.open) * 0.45 &&
        bullish &&
        c.close > (p2.open + p2.close) / 2
      ) {
        pattern = "MORNING STAR";
        signal = "BULLISH";
        strength = 3;
        description =
          "Three-candle bullish reversal structure detected.";
      }

      else if (
        p2Bullish &&
        Math.abs(p.close - p.open) <
          Math.abs(p2.close - p2.open) * 0.45 &&
        bearish &&
        c.close < (p2.open + p2.close) / 2
      ) {
        pattern = "EVENING STAR";
        signal = "BEARISH";
        strength = 3;
        description =
          "Three-candle bearish reversal structure detected.";
      }

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

    /* =========================================================
       MARKET STRUCTURE
    ========================================================= */

    function findPivots(candles) {
      const highs = [];
      const lows = [];

      const start =
        Math.max(2, candles.length - 45);

      const end = candles.length - 2;

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

      return { highs, lows };
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
          structure: "HIGHER HIGH + HIGHER LOW",
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
          structure: "LOWER HIGH + LOWER LOW",
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
          structure: "HIGHER HIGH / MIXED LOWS",
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
          structure: "LOWER HIGH / MIXED LOWS",
          score: -1,
          lastHigh,
          previousHigh,
          lastLow,
          previousLow
        };
      }

      return {
        direction: "SIDEWAYS",
        structure: "MIXED MARKET STRUCTURE",
        score: 0,
        lastHigh,
        previousHigh,
        lastLow,
        previousLow
      };
    }

    /* =========================================================
       BREAKOUT
    ========================================================= */

    function analyzeBreakout(candles) {
      const latest = candles[candles.length - 1];
      const previous = candles[candles.length - 2];

      const lookback = candles.slice(-21, -1);

      const resistance =
        Math.max(...lookback.map(x => x.high));

      const support =
        Math.min(...lookback.map(x => x.low));

      if (
        latest.close > resistance &&
        previous.close <= resistance
      ) {
        return {
          type: "BREAKOUT",
          strength: 4,
          level: resistance
        };
      }

      if (
        latest.close < support &&
        previous.close >= support
      ) {
        return {
          type: "BREAKDOWN",
          strength: -4,
          level: support
        };
      }

      return {
        type: "NONE",
        strength: 0,
        level: null
      };
    }

    /* =========================================================
       INDICATORS
    ========================================================= */

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

    const structure =
      analyzeStructure(history);

    const candle =
      candleAnalysis(history);

    const breakout =
      analyzeBreakout(history);

    /* =========================================================
       TREND
    ========================================================= */

    let trendScore = 0;

    if (currentSMA20 !== null) {
      trendScore +=
        price > currentSMA20 ? 2 : -2;
    }

    if (currentSMA50 !== null) {
      trendScore +=
        price > currentSMA50 ? 2 : -2;
    }

    if (
      currentSMA20 !== null &&
      currentSMA50 !== null
    ) {
      trendScore +=
        currentSMA20 > currentSMA50 ? 2 : -2;
    }

    if (
      currentMACD !== null &&
      currentMACDSignal !== null
    ) {
      trendScore +=
        currentMACD > currentMACDSignal ? 2 : -2;
    }

    trendScore += structure.score;
    trendScore += breakout.strength;

    let trend = "SIDEWAYS";

    if (trendScore >= 6) {
      trend = "BULLISH";
    }

    if (trendScore <= -6) {
      trend = "BEARISH";
    }

    /* =========================================================
       SHORT TERM
    ========================================================= */

    let shortTermTrend = "NEUTRAL";

    if (
      currentSMA20 !== null &&
      currentMACD !== null &&
      currentMACDSignal !== null &&
      price > currentSMA20 &&
      currentMACD > currentMACDSignal
    ) {
      shortTermTrend = "BULLISH";
    }

    if (
      currentSMA20 !== null &&
      currentMACD !== null &&
      currentMACDSignal !== null &&
      price < currentSMA20 &&
      currentMACD < currentMACDSignal
    ) {
      shortTermTrend = "BEARISH";
    }

    /* =========================================================
       MOMENTUM
    ========================================================= */

    const macdBullish =
      currentMACD !== null &&
      currentMACDSignal !== null &&
      currentMACD > currentMACDSignal;

    const macdBearish =
      currentMACD !== null &&
      currentMACDSignal !== null &&
      currentMACD < currentMACDSignal;

    const histogramTurningBullish =
      previousHistogram !== null &&
      currentHistogram !== null &&
      currentHistogram > previousHistogram;

    const histogramTurningBearish =
      previousHistogram !== null &&
      currentHistogram !== null &&
      currentHistogram < previousHistogram;

    /* =========================================================
       SUPPORT / RESISTANCE
    ========================================================= */

    const recent20 =
      history.slice(-20);

    const support =
      Math.min(...recent20.map(x => x.low));

    const resistance =
      Math.max(...recent20.map(x => x.high));

    /* =========================================================
       VOLUME
    ========================================================= */

    const recentVolumes =
      history.slice(-21, -1).map(x => x.volume);

    const averageVolume =
      recentVolumes.reduce(
        (sum, value) => sum + value,
        0
      ) / recentVolumes.length;

    const currentVolume =
      history[history.length - 1].volume;

    const relativeVolume =
      averageVolume > 0
        ? currentVolume / averageVolume
        : null;

    const volumeConfirmation =
      relativeVolume !== null &&
      relativeVolume >= 1.2;

    /* =========================================================
       REVERSAL
    ========================================================= */

    let reversal = "NONE";
    let reversalConfidence = 0;

    if (
      trend === "BEARISH" &&
      (
        candle.signal === "BULLISH" ||
        histogramTurningBullish ||
        (
          currentRSI !== null &&
          currentRSI >= 30 &&
          currentRSI <= 42
        )
      )
    ) {
      reversal = "BULLISH REVERSAL WATCH";
      reversalConfidence = 60;

      if (candle.signal === "BULLISH") {
        reversalConfidence += 12;
      }

      if (histogramTurningBullish) {
        reversalConfidence += 10;
      }

      reversalConfidence =
        Math.min(90, reversalConfidence);
    }

    if (
      trend === "BULLISH" &&
      (
        candle.signal === "BEARISH" ||
        histogramTurningBearish ||
        (
          currentRSI !== null &&
          currentRSI >= 58 &&
          currentRSI <= 72
        )
      )
    ) {
      reversal = "BEARISH REVERSAL WATCH";
      reversalConfidence = 60;

      if (candle.signal === "BEARISH") {
        reversalConfidence += 12;
      }

      if (histogramTurningBearish) {
        reversalConfidence += 10;
      }

      reversalConfidence =
        Math.min(90, reversalConfidence);
    }

    /* =========================================================
       CONFIRMATIONS
    ========================================================= */

    let bullishConfirmations = 0;
    let bearishConfirmations = 0;

    if (structure.direction === "BULLISH") {
      bullishConfirmations++;
    }

    if (shortTermTrend === "BULLISH") {
      bullishConfirmations++;
    }

    if (macdBullish) {
      bullishConfirmations++;
    }

    if (
      currentRSI !== null &&
      currentRSI >= 50 &&
      currentRSI <= 68
    ) {
      bullishConfirmations++;
    }

    if (candle.signal === "BULLISH") {
      bullishConfirmations++;
    }

    if (volumeConfirmation) {
      bullishConfirmations++;
    }

    if (breakout.type === "BREAKOUT") {
      bullishConfirmations += 2;
    }

    if (structure.direction === "BEARISH") {
      bearishConfirmations++;
    }

    if (shortTermTrend === "BEARISH") {
      bearishConfirmations++;
    }

    if (macdBearish) {
      bearishConfirmations++;
    }

    if (
      currentRSI !== null &&
      currentRSI >= 32 &&
      currentRSI <= 55
    ) {
      bearishConfirmations++;
    }

    if (candle.signal === "BEARISH") {
      bearishConfirmations++;
    }

    if (breakout.type === "BREAKDOWN") {
      bearishConfirmations += 2;
    }

    /* =========================================================
       SETUP
    ========================================================= */

    let setup = "RANGE / WAIT";

    if (
      breakout.type === "BREAKOUT" &&
      structure.direction === "BULLISH"
    ) {
      setup = "BREAKOUT CONFIRMATION";
    }

    else if (
      breakout.type === "BREAKDOWN" &&
      structure.direction === "BEARISH"
    ) {
      setup = "BEARISH BREAKDOWN";
    }

    else if (
      reversal === "BULLISH REVERSAL WATCH"
    ) {
      setup = "REVERSAL WATCH";
    }

    else if (
      reversal === "BEARISH REVERSAL WATCH"
    ) {
      setup = "REVERSAL RISK";
    }

    else if (
      structure.direction === "BULLISH" &&
      shortTermTrend === "BEARISH"
    ) {
      setup = "BUY ON PULLBACK";
    }

    else if (
      structure.direction === "BULLISH" &&
      shortTermTrend === "BULLISH" &&
      bullishConfirmations >= 5 &&
      candle.signal === "BULLISH"
    ) {
      setup = "CONFIRMED BUY";
    }

    else if (
      (
        trend === "BULLISH" ||
        structure.direction === "BULLISH"
      ) &&
      shortTermTrend === "BULLISH"
    ) {
      setup =
        "BULLISH SETUP — WAIT FOR CONFIRMATION";
    }

    else if (
      structure.direction === "BEARISH" &&
      shortTermTrend === "BEARISH" &&
      bearishConfirmations >= 5 &&
      candle.signal === "BEARISH"
    ) {
      setup = "CONFIRMED SELL";
    }

    else if (
      trend === "BEARISH" ||
      structure.direction === "BEARISH"
    ) {
      setup =
        "BEARISH SETUP — WAIT FOR CONFIRMATION";
    }

    /* =========================================================
       BUY / SELL TRIGGER ENGINE
    ========================================================= */

    const breakoutTrigger =
      resistance * 1.002;

    const pullbackZoneLow =
      support;

    const pullbackZoneHigh =
      currentSMA20 !== null
        ? Math.max(currentSMA20, support)
        : support;

    let buyTrigger =
      "WAIT FOR CONFIRMATION";

    let buyTriggerPrice =
      breakoutTrigger;

    let triggerReason =
      "Wait for price and momentum confirmation.";

    let triggerConfirmed = false;

    /* Confirmed breakout */

    if (
      setup === "BREAKOUT CONFIRMATION"
    ) {
      buyTrigger =
        "BREAKOUT ABOVE RESISTANCE";

      buyTriggerPrice =
        breakoutTrigger;

      triggerReason =
        "Close above resistance with bullish momentum.";
    }

    /* Bullish setup */

    else if (
      setup ===
      "BULLISH SETUP — WAIT FOR CONFIRMATION"
    ) {
      buyTrigger =
        "CLOSE ABOVE RESISTANCE";

      buyTriggerPrice =
        breakoutTrigger;

      triggerReason =
        "Wait for a daily close above resistance with bullish candle and momentum confirmation.";
    }

    /* Pullback */

    else if (
      setup === "BUY ON PULLBACK"
    ) {
      buyTrigger =
        "BULLISH REACTION FROM SUPPORT";

      buyTriggerPrice =
        pullbackZoneHigh;

      triggerReason =
        "Wait for price to pull back toward support/SMA20 and produce bullish confirmation.";
    }

    /* Reversal */

    else if (
      setup === "REVERSAL WATCH"
    ) {
      buyTrigger =
        "REVERSAL CONFIRMATION";

      buyTriggerPrice =
        resistance;

      triggerReason =
        "Wait for structure to improve and price to reclaim resistance.";
    }

    /* =========================================================
       INVALIDATION
    ========================================================= */

    let invalidation =
      support;

    if (
      structure.lastLow !== null &&
      structure.lastLow < support
    ) {
      invalidation =
        structure.lastLow;
    }

    /* =========================================================
       TARGETS
    ========================================================= */

    const range =
      Math.max(
        resistance - support,
        price * 0.05
      );

    let target1 =
      resistance +
      range * 0.50;

    let target2 =
      resistance +
      range;

    if (target1 <= price) {
      target1 = price * 1.08;
    }

    if (target2 <= target1) {
      target2 = target1 * 1.10;
    }

    /* =========================================================
       RISK / REWARD
    ========================================================= */

    const entry =
      buyTriggerPrice;

    const risk =
      entry > invalidation
        ? entry - invalidation
        : null;

    const reward1 =
      target1 > entry
        ? target1 - entry
        : null;

    const reward2 =
      target2 > entry
        ? target2 - entry
        : null;

    const riskReward1 =
      risk && reward1
        ? reward1 / risk
        : null;

    const riskReward2 =
      risk && reward2
        ? reward2 / risk
        : null;

    let riskRewardQuality =
      "NOT ATTRACTIVE";

    if (riskReward1 !== null) {
      if (riskReward1 >= 2) {
        riskRewardQuality =
          "ATTRACTIVE";
      }
      else if (riskReward1 >= 1.5) {
        riskRewardQuality =
          "ACCEPTABLE";
      }
    }

    /* =========================================================
       EXACT BUY CONDITIONS
    ========================================================= */

    const buyConditions = [];

    buyConditions.push({
      condition:
        "Price closes above resistance",
      required: true,
      met:
        price > resistance
    });

    buyConditions.push({
      condition:
        "Bullish market structure",
      required: true,
      met:
        structure.direction === "BULLISH"
    });

    buyConditions.push({
      condition:
        "Short-term trend bullish",
      required: true,
      met:
        shortTermTrend === "BULLISH"
    });

    buyConditions.push({
      condition:
        "MACD bullish",
      required: true,
      met:
        macdBullish
    });

    buyConditions.push({
      condition:
        "RSI above 50",
      required: true,
      met:
        currentRSI !== null &&
        currentRSI > 50
    });

    buyConditions.push({
      condition:
        "Bullish candle confirmation",
      required: true,
      met:
        candle.signal === "BULLISH"
    });

    buyConditions.push({
      condition:
        "Volume confirmation",
      required: false,
      met:
        volumeConfirmation
    });

    const requiredConditions =
      buyConditions.filter(x => x.required);

    const conditionsMet =
      requiredConditions.filter(x => x.met).length;

    const conditionsTotal =
      requiredConditions.length;

    triggerConfirmed =
      conditionsMet === conditionsTotal &&
      price > resistance;

    /* =========================================================
       FINAL SIGNAL
    ========================================================= */

    let score = 50;

    const reasons = [];
    const risks = [];

    if (currentSMA20 !== null) {
      if (price > currentSMA20) {
        score += 8;
        reasons.push(
          "Price is above the 20-day moving average."
        );
      } else {
        score -= 8;
        risks.push(
          "Price is below the 20-day moving average."
        );
      }
    }

    if (currentSMA50 !== null) {
      if (price > currentSMA50) {
        score += 12;
        reasons.push(
          "Price is above the 50-day moving average."
        );
      } else {
        score -= 12;
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
        score += 8;
        reasons.push(
          "20-day moving average is above the 50-day moving average."
        );
      } else {
        score -= 8;
        risks.push(
          "20-day moving average is below the 50-day moving average."
        );
      }
    }

    if (currentRSI !== null) {
      if (
        currentRSI >= 50 &&
        currentRSI <= 68
      ) {
        score += 8;
        reasons.push(
          "RSI supports healthy momentum."
        );
      }
      else if (currentRSI > 70) {
        score -= 5;
        risks.push(
          "RSI indicates potentially overbought conditions."
        );
      }
      else if (currentRSI < 30) {
        score += 4;
        reasons.push(
          "RSI indicates potentially oversold conditions."
        );
      }
      else {
        risks.push(
          "RSI does not currently show strong momentum."
        );
      }
    }

    if (macdBullish) {
      score += 7;
      reasons.push(
        "MACD is above its signal line."
      );
    } else {
      score -= 7;
      risks.push(
        "MACD is below its signal line."
      );
    }

    if (histogramTurningBullish) {
      score += 3;
      reasons.push(
        "MACD histogram is improving."
      );
    }

    if (histogramTurningBearish) {
      score -= 3;
      risks.push(
        "MACD histogram is weakening."
      );
    }

    if (structure.direction === "BULLISH") {
      score += 7;
      reasons.push(
        "Market structure shows higher highs and higher lows."
      );
    }

    if (structure.direction === "BEARISH") {
      score -= 7;
      risks.push(
        "Market structure shows lower highs and lower lows."
      );
    }

    if (breakout.type === "BREAKOUT") {
      score += 10;
      reasons.push(
        "Price has broken above recent resistance."
      );
    }

    if (breakout.type === "BREAKDOWN") {
      score -= 10;
      risks.push(
        "Price has broken below recent support."
      );
    }

    if (candle.signal === "BULLISH") {
      score += candle.strength * 2;
      reasons.push(
        `${candle.pattern}: ${candle.description}`
      );
    }

    if (candle.signal === "BEARISH") {
      score -= candle.strength * 2;
      risks.push(
        `${candle.pattern}: ${candle.description}`
      );
    }

    if (candle.pattern === "DOJI") {
      risks.push(
        "Latest candle shows indecision."
      );
    }

    if (volumeConfirmation) {
      reasons.push(
        "Trading volume is above its recent average."
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

    if (
      triggerConfirmed &&
      score >= 75
    ) {
      signal = "STRONG BUY";
    }

    else if (
      triggerConfirmed &&
      score >= 60
    ) {
      signal = "BUY";
    }

    else if (
      setup === "CONFIRMED SELL" &&
      score < 40
    ) {
      signal = "SELL";
    }

    /* =========================================================
       TREND CONFIDENCE
    ========================================================= */

    let trendConfidence =
      50 + Math.abs(trendScore) * 4;

    if (structure.direction === trend) {
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

    if (breakout.type !== "NONE") {
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

    /* =========================================================
       DIAGNOSIS
    ========================================================= */

    let diagnosis =
      "The market is currently neutral. Wait for stronger directional evidence.";

    if (
      setup ===
      "BULLISH SETUP — WAIT FOR CONFIRMATION"
    ) {
      diagnosis =
        `The structure is bullish and short-term momentum is improving, but the entry is not confirmed. ` +
        `The key trigger is a daily close above ${round(resistance)} with bullish candle and momentum confirmation.`;
    }

    else if (setup === "CONFIRMED BUY") {
      diagnosis =
        `Bullish structure, momentum and confirmation signals are aligned. ` +
        `The setup has met the model's confirmation requirements.`;
    }

    else if (setup === "BREAKOUT CONFIRMATION") {
      diagnosis =
        `Price is testing a breakout condition above resistance. ` +
        `Follow-through and volume confirmation should be monitored.`;
    }

    else if (setup === "BUY ON PULLBACK") {
      diagnosis =
        `The broader structure remains bullish but short-term momentum has weakened. ` +
        `A controlled pullback toward support/SMA20 may offer a better entry.`;
    }

    else if (setup === "REVERSAL WATCH") {
      diagnosis =
        `Bearish conditions are showing signs of a possible bullish reversal. ` +
        `Wait for price structure to confirm the reversal.`;
    }

    else if (setup === "REVERSAL RISK") {
      diagnosis =
        `The broader trend is bullish but momentum is showing reversal risk. ` +
        `Monitor support and momentum before adding exposure.`;
    }

    else if (
      setup ===
      "BEARISH SETUP — WAIT FOR CONFIRMATION"
    ) {
      diagnosis =
        `Bearish evidence is building, but confirmation is incomplete. ` +
        `Wait for a breakdown or stronger bearish momentum before taking a bearish position.`;
    }

    else if (setup === "BEARISH BREAKDOWN") {
      diagnosis =
        `Price has broken below support with bearish evidence. ` +
        `The breakdown should be monitored for follow-through.`;
    }

    /* =========================================================
       CHART HISTORY
    ========================================================= */

    const chartHistory =
      history.map((item, i) => ({
        date: item.date,
        open: round(item.open),
        high: round(item.high),
        low: round(item.low),
        close: round(item.close),
        volume: item.volume,

        sma20:
          sma20[i] !== null
            ? round(sma20[i])
            : null,

        sma50:
          sma50[i] !== null
            ? round(sma50[i])
            : null,

        rsi:
          rsiValues[i] !== null
            ? round(rsiValues[i], 1)
            : null,

        macd:
          macdLine[i] !== null
            ? round(macdLine[i], 4)
            : null,

        macdSignal:
          macdSignal[i] !== null
            ? round(macdSignal[i], 4)
            : null,

        macdHistogram:
          macdHistogram[i] !== null
            ? round(macdHistogram[i], 4)
            : null
      }));

    /* =========================================================
       RESPONSE
    ========================================================= */

    return res.status(200).json({
      symbol: ticker,
      name: ticker,

      price: round(price),

      change_pct:
        round(
          previousClose !== 0
            ? ((price - previousClose) /
                previousClose) *
                100
            : 0
        ),

      /* SIGNAL */

      score,
      signal,

      /* SETUP */

      setup,
      diagnosis,

      /* TREND */

      trend,
      trend_score: trendScore,
      trend_confidence: trendConfidence,
      short_term_trend: shortTermTrend,

      structure: structure.structure,
      structure_direction:
        structure.direction,

      /* CANDLE */

      candle_pattern:
        candle.pattern,

      candle_signal:
        candle.signal,

      candle_strength:
        candle.strength,

      candle_context:
        candle.signal === "BULLISH"
          ? "BULLISH CONFIRMATION"
          : candle.signal === "BEARISH"
          ? "BEARISH CONFIRMATION"
          : "INDECISION / WAIT FOR CONFIRMATION",

      candle_description:
        candle.description,

      /* BREAKOUT */

      breakout:
        breakout.type,

      breakout_level:
        breakout.level !== null
          ? round(breakout.level)
          : null,

      /* REVERSAL */

      reversal,
      reversal_confidence:
        reversalConfidence,

      /* LEVELS */

      entry_low:
        round(pullbackZoneLow),

      entry_high:
        round(pullbackZoneHigh),

      stop:
        round(invalidation),

      target1:
        round(target1),

      target2:
        round(target2),

      /* NEW DECISION ENGINE */

      buy_trigger:
        buyTrigger,

      buy_trigger_price:
        round(buyTriggerPrice),

      buy_trigger_confirmed:
        triggerConfirmed,

      trigger_reason:
        triggerReason,

      invalidation:
        round(invalidation),

      invalidation_reason:
        "Setup is invalidated if price closes below the key structural support.",

      risk_per_share:
        round(risk),

      reward_to_target1:
        round(reward1),

      reward_to_target2:
        round(reward2),

      risk_reward_target1:
        round(riskReward1),

      risk_reward_target2:
        round(riskReward2),

      risk_reward_quality:
        riskRewardQuality,

      /* CONDITIONS */

      buy_conditions:
        buyConditions,

      conditions_met:
        conditionsMet,

      conditions_total:
        conditionsTotal,

      /* VOLUME */

      relative_volume:
        round(relativeVolume, 2),

      volume_confirmation:
        volumeConfirmation,

      /* EXPLANATION */

      reasons,
      risks,

      /* TECHNICAL */

      fundamentals: {
        sma20:
          round(currentSMA20),

        sma50:
          round(currentSMA50),

        support:
          round(support),

        resistance:
          round(resistance),

        macd:
          round(currentMACD, 4),

        macd_signal:
          round(currentMACDSignal, 4),

        macd_histogram:
          round(currentHistogram, 4),

        rsi:
          round(currentRSI, 1)
      },

      /* HISTORY */

      history: chartHistory
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to calculate technical analysis"
    });
  }
}
