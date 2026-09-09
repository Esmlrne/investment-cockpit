export default async function handler(req, res) {
  const symbol = String(
    req.query.ticker || req.query.symbol || ""
  )
    .trim()
    .toUpperCase();

  if (!symbol) {
    return res.status(400).json({
      error: "Missing ticker",
      message: "Use /api/stock?ticker=AAPL"
    });
  }

  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Missing Alpha Vantage API key",
      message: "ALPHA_VANTAGE_API_KEY is not configured in Vercel."
    });
  }

  try {
    const url =
      "https://www.alphavantage.co/query" +
      `?function=TIME_SERIES_DAILY` +
      `&symbol=${encodeURIComponent(symbol)}` +
      `&outputsize=compact` +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    const data = await response.json();

    // Alpha Vantage errors / rate limits
    if (data["Error Message"]) {
      return res.status(400).json({
        error: "Alpha Vantage error",
        message: data["Error Message"]
      });
    }

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage rate limit",
        message: data.Note
      });
    }

    if (data.Information) {
      return res.status(429).json({
        error: "Alpha Vantage information",
        message: data.Information
      });
    }

    const timeSeries = data["Time Series (Daily)"];

    if (!timeSeries) {
      return res.status(502).json({
        error: "No daily market data returned",
        details: JSON.stringify(data)
      });
    }

    const dates = Object.keys(timeSeries).sort();

    if (dates.length < 30) {
      return res.status(502).json({
        error: "Not enough market history",
        message: `Only ${dates.length} daily observations were returned.`
      });
    }

    // ---------------------------------------------------------
    // Convert Alpha Vantage data
    // ---------------------------------------------------------

    const history = dates
      .map((date) => ({
        date,
        open: Number(timeSeries[date]["1. open"]),
        high: Number(timeSeries[date]["2. high"]),
        low: Number(timeSeries[date]["3. low"]),
        close: Number(timeSeries[date]["4. close"]),
        volume: Number(timeSeries[date]["5. volume"])
      }))
      .filter(
        (x) =>
          Number.isFinite(x.open) &&
          Number.isFinite(x.high) &&
          Number.isFinite(x.low) &&
          Number.isFinite(x.close)
      );

    const closes = history.map((x) => x.close);

    // ---------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------

    function round(value, decimals = 2) {
      if (!Number.isFinite(value)) return null;
      const factor = 10 ** decimals;
      return Math.round(value * factor) / factor;
    }

    function average(values) {
      const valid = values.filter(Number.isFinite);
      if (!valid.length) return null;
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    }

    function sma(values, period) {
      if (values.length < period) return null;
      return average(values.slice(-period));
    }

    function calculateRSI(values, period = 14) {
      if (values.length <= period) return null;

      let gains = 0;
      let losses = 0;

      for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change >= 0) gains += change;
        else losses += Math.abs(change);
      }

      let avgGain = gains / period;
      let avgLoss = losses / period;

      for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
      }

      if (avgLoss === 0) return 100;

      const rs = avgGain / avgLoss;

      return 100 - 100 / (1 + rs);
    }

    function ema(values, period) {
      if (values.length < period) return null;

      const multiplier = 2 / (period + 1);

      let result = average(values.slice(0, period));

      for (let i = period; i < values.length; i++) {
        result =
          (values[i] - result) * multiplier + result;
      }

      return result;
    }

    function calculateMACD(values) {
      if (values.length < 35) {
        return {
          macd: null,
          signal: null,
          histogram: null
        };
      }

      const macdSeries = [];

      for (let i = 26; i <= values.length; i++) {
        const slice = values.slice(0, i);

        const fast = ema(slice, 12);
        const slow = ema(slice, 26);

        if (fast !== null && slow !== null) {
          macdSeries.push(fast - slow);
        }
      }

      const macd = macdSeries[macdSeries.length - 1];

      const signal =
        macdSeries.length >= 9
          ? ema(macdSeries, 9)
          : null;

      const histogram =
        macd !== null && signal !== null
          ? macd - signal
          : null;

      return {
        macd,
        signal,
        histogram
      };
    }

    // ---------------------------------------------------------
    // Calculate indicators for every historical point
    // ---------------------------------------------------------

    for (let i = 0; i < history.length; i++) {
      const values = history
        .slice(0, i + 1)
        .map((x) => x.close);

      history[i].sma20 = sma(values, 20);
      history[i].sma50 = sma(values, 50);
      history[i].rsi = calculateRSI(values, 14);

      const macd = calculateMACD(values);

      history[i].macd = macd.macd;
      history[i].macdSignal = macd.signal;
      history[i].macdHistogram = macd.histogram;
    }

    const latest = history[history.length - 1];
    const previous = history[history.length - 2];

    const price = latest.close;

    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);

    // ---------------------------------------------------------
    // Price change
    // ---------------------------------------------------------

    const change =
      previous && previous.close
        ? price - previous.close
        : 0;

    const changePct =
      previous && previous.close
        ? (change / previous.close) * 100
        : 0;

    // ---------------------------------------------------------
    // Support / Resistance
    // ---------------------------------------------------------

    const recent20 = history.slice(-20);

    const support = Math.min(
      ...recent20.map((x) => x.low)
    );

    const resistance = Math.max(
      ...recent20.map((x) => x.high)
    );

    const recentLow = Math.min(
      ...history.slice(-10).map((x) => x.low)
    );

    const recentHigh = Math.max(
      ...history.slice(-10).map((x) => x.high)
    );

    // ---------------------------------------------------------
    // Market structure
    // ---------------------------------------------------------

    const firstHalf = history.slice(-20, -10);
    const secondHalf = history.slice(-10);

    const firstHigh = Math.max(
      ...firstHalf.map((x) => x.high)
    );

    const secondHigh = Math.max(
      ...secondHalf.map((x) => x.high)
    );

    const firstLow = Math.min(
      ...firstHalf.map((x) => x.low)
    );

    const secondLow = Math.min(
      ...secondHalf.map((x) => x.low)
    );

    const higherHigh = secondHigh > firstHigh;
    const higherLow = secondLow > firstLow;

    const lowerHigh = secondHigh < firstHigh;
    const lowerLow = secondLow < firstLow;

    let structure = "MIXED";
    let structureDirection = "NEUTRAL";

    if (higherHigh && higherLow) {
      structure = "HIGHER HIGH + HIGHER LOW";
      structureDirection = "BULLISH";
    } else if (lowerHigh && lowerLow) {
      structure = "LOWER HIGH + LOWER LOW";
      structureDirection = "BEARISH";
    }

    // ---------------------------------------------------------
    // Trend
    // ---------------------------------------------------------

    let trend = "SIDEWAYS";
    let trendScore = 50;

    if (
      sma20 !== null &&
      sma50 !== null
    ) {
      if (
        price > sma20 &&
        sma20 > sma50
      ) {
        trend = "BULLISH";
        trendScore = 80;
      } else if (
        price < sma20 &&
        sma20 < sma50
      ) {
        trend = "BEARISH";
        trendScore = 20;
      } else {
        trend = "SIDEWAYS";
        trendScore = 50;
      }
    }

    let shortTermTrend = "SIDEWAYS";

    if (
      sma20 !== null &&
      price > sma20
    ) {
      shortTermTrend = "BULLISH";
    } else if (
      sma20 !== null &&
      price < sma20
    ) {
      shortTermTrend = "BEARISH";
    }

    // ---------------------------------------------------------
    // Volume
    // ---------------------------------------------------------

    const volumes = history.map((x) => x.volume);

    const avgVolume20 = average(
      volumes.slice(-21, -1)
    );

    const relativeVolume =
      avgVolume20 && avgVolume20 > 0
        ? latest.volume / avgVolume20
        : null;

    let volumeConfirmation = "NEUTRAL";

    if (relativeVolume !== null) {
      if (relativeVolume >= 1.5) {
        volumeConfirmation = "STRONG";
      } else if (relativeVolume >= 1.1) {
        volumeConfirmation = "POSITIVE";
      } else if (relativeVolume < 0.8) {
        volumeConfirmation = "WEAK";
      }
    }

    // ---------------------------------------------------------
    // Candlestick analysis
    // ---------------------------------------------------------

    const candleBody =
      Math.abs(latest.close - latest.open);

    const candleRange =
      latest.high - latest.low;

    const upperWick =
      latest.high -
      Math.max(latest.open, latest.close);

    const lowerWick =
      Math.min(latest.open, latest.close) -
      latest.low;

    const bullishCandle =
      latest.close > latest.open;

    const bearishCandle =
      latest.close < latest.open;

    let candlePattern = "NORMAL";
    let candleSignal = "NEUTRAL";
    let candleStrength = "NORMAL";

    if (
      candleRange > 0 &&
      candleBody / candleRange < 0.1
    ) {
      candlePattern = "DOJI";
      candleSignal = "NEUTRAL";
      candleStrength = "WEAK";
    }

    if (
      candleRange > 0 &&
      lowerWick > candleBody * 2 &&
      upperWick < candleBody
    ) {
      candlePattern = "HAMMER";
      candleSignal = "BULLISH";
      candleStrength = "STRONG";
    }

    if (
      candleRange > 0 &&
      upperWick > candleBody * 2 &&
      lowerWick < candleBody
    ) {
      candlePattern = "SHOOTING STAR";
      candleSignal = "BEARISH";
      candleStrength = "STRONG";
    }

    if (
      bullishCandle &&
      previous &&
      previous.close < previous.open &&
      latest.open <= previous.close &&
      latest.close >= previous.open
    ) {
      candlePattern = "BULLISH ENGULFING";
      candleSignal = "BULLISH";
      candleStrength = "STRONG";
    }

    if (
      bearishCandle &&
      previous &&
      previous.close > previous.open &&
      latest.open >= previous.close &&
      latest.close <= previous.open
    ) {
      candlePattern = "BEARISH ENGULFING";
      candleSignal = "BEARISH";
      candleStrength = "STRONG";
    }

    if (
      candleRange > 0 &&
      candleBody / candleRange > 0.7
    ) {
      if (bullishCandle) {
        candlePattern = "STRONG BULLISH CANDLE";
        candleSignal = "BULLISH";
        candleStrength = "STRONG";
      } else if (bearishCandle) {
        candlePattern = "STRONG BEARISH CANDLE";
        candleSignal = "BEARISH";
        candleStrength = "STRONG";
      }
    }

    // ---------------------------------------------------------
    // Chart formations
    // ---------------------------------------------------------

    const formations = [];

    const lows = history.slice(-30).map((x) => x.low);
    const highs = history.slice(-30).map((x) => x.high);

    // Double Bottom
    if (lows.length >= 20) {
      const leftLow = Math.min(...lows.slice(0, 12));
      const rightLow = Math.min(...lows.slice(12));

      const lowDifference =
        Math.abs(leftLow - rightLow) /
        Math.max(leftLow, rightLow);

      if (lowDifference < 0.03) {
        formations.push({
          name: "Double Bottom",
          type: "BULLISH",
          confidence: Math.round(
            Math.max(0, 100 - lowDifference * 2000)
          )
        });
      }
    }

    // Double Top
    if (highs.length >= 20) {
      const leftHigh = Math.max(...highs.slice(0, 12));
      const rightHigh = Math.max(...highs.slice(12));

      const highDifference =
        Math.abs(leftHigh - rightHigh) /
        Math.max(leftHigh, rightHigh);

      if (highDifference < 0.03) {
        formations.push({
          name: "Double Top",
          type: "BEARISH",
          confidence: Math.round(
            Math.max(0, 100 - highDifference * 2000)
          )
        });
      }
    }

    // Ascending Triangle
    if (
      higherLow &&
      Math.abs(secondHigh - firstHigh) /
        firstHigh <
        0.025
    ) {
      formations.push({
        name: "Ascending Triangle",
        type: "BULLISH",
        confidence: 72
      });
    }

    // Descending Triangle
    if (
      lowerHigh &&
      Math.abs(secondLow - firstLow) /
        firstLow <
        0.025
    ) {
      formations.push({
        name: "Descending Triangle",
        type: "BEARISH",
        confidence: 72
      });
    }

    // Cup & Handle heuristic
    if (history.length >= 60) {
      const last60 = history.slice(-60);

      const cupStart =
        last60[0].close;

      const cupMiddle =
        Math.min(
          ...last60
            .slice(15, 45)
            .map((x) => x.close)
        );

      const cupEnd =
        last60[last60.length - 1].close;

      if (
        cupMiddle < cupStart * 0.92 &&
        cupEnd > cupMiddle * 1.08 &&
        Math.abs(cupEnd - cupStart) /
          cupStart <
          0.08
      ) {
        formations.push({
          name: "Cup & Handle",
          type: "BULLISH",
          confidence: 68
        });
      }
    }

    // ---------------------------------------------------------
    // Breakout
    // ---------------------------------------------------------

    const breakoutLevel = resistance;

    const breakoutTrigger =
      breakoutLevel * 1.002;

    const breakoutConfirmed =
      price > breakoutTrigger;

    // ---------------------------------------------------------
    // Pullback setup
    // ---------------------------------------------------------

    const pullbackLow = support;

    const pullbackHigh =
      sma20 !== null
        ? Math.max(sma20, support)
        : support;

    const preferredEntry =
      (pullbackLow + pullbackHigh) / 2;

    const inPullbackZone =
      price >= pullbackLow &&
      price <= pullbackHigh * 1.01;

    // ---------------------------------------------------------
    // Targets and invalidation
    // ---------------------------------------------------------

    const range =
      Math.max(
        resistance - support,
        price * 0.05
      );

    const target1 =
      resistance + range * 0.5;

    const target2 =
      resistance + range;

    const invalidation = support;

    const riskPerShare =
      Math.max(
        price - invalidation,
        0.01
      );

    const rewardToTarget1 =
      Math.max(target1 - price, 0);

    const rewardToTarget2 =
      Math.max(target2 - price, 0);

    const riskRewardTarget1 =
      rewardToTarget1 / riskPerShare;

    const riskRewardTarget2 =
      rewardToTarget2 / riskPerShare;

    let riskRewardQuality = "POOR";

    if (
      riskRewardTarget1 >= 3 &&
      riskRewardTarget2 >= 4
    ) {
      riskRewardQuality = "EXCELLENT";
    } else if (
      riskRewardTarget1 >= 2 &&
      riskRewardTarget2 >= 3
    ) {
      riskRewardQuality = "ATTRACTIVE";
    } else if (
      riskRewardTarget1 >= 1.5
    ) {
      riskRewardQuality = "ACCEPTABLE";
    }

    // ---------------------------------------------------------
    // Score
    // ---------------------------------------------------------

    let score = 50;

    if (trend === "BULLISH") score += 12;
    if (trend === "BEARISH") score -= 12;

    if (structureDirection === "BULLISH") {
      score += 10;
    }

    if (structureDirection === "BEARISH") {
      score -= 10;
    }

    if (
      shortTermTrend === "BULLISH"
    ) {
      score += 6;
    }

    if (
      shortTermTrend === "BEARISH"
    ) {
      score -= 6;
    }

    if (rsi !== null) {
      if (rsi >= 50 && rsi <= 70) {
        score += 8;
      }

      if (rsi > 75) {
        score -= 5;
      }

      if (rsi < 30) {
        score += 3;
      }
    }

    if (
      macd.histogram !== null &&
      macd.histogram > 0
    ) {
      score += 8;
    }

    if (
      macd.histogram !== null &&
      macd.histogram < 0
    ) {
      score -= 8;
    }

    if (
      candleSignal === "BULLISH"
    ) {
      score += 5;
    }

    if (
      candleSignal === "BEARISH"
    ) {
      score -= 5;
    }

    if (
      relativeVolume !== null &&
      relativeVolume >= 1.2
    ) {
      score += 4;
    }

    if (formations.some(
      (x) => x.type === "BULLISH"
    )) {
      score += 5;
    }

    if (formations.some(
      (x) => x.type === "BEARISH"
    )) {
      score -= 5;
    }

    score = Math.max(
      0,
      Math.min(100, Math.round(score))
    );

    // ---------------------------------------------------------
    // Bullish / bearish setup
    // ---------------------------------------------------------

    const bullishSetup =
      score >= 58 &&
      trend !== "BEARISH" &&
      structureDirection !== "BEARISH";

    const bearishSetup =
      score <= 42 &&
      trend !== "BULLISH" &&
      structureDirection !== "BULLISH";

    // ---------------------------------------------------------
    // Buy conditions
    // ---------------------------------------------------------

    const conditions = {
      bullishTrend:
        trend === "BULLISH",

      bullishStructure:
        structureDirection === "BULLISH",

      positiveMACD:
        macd.histogram !== null &&
        macd.histogram > 0,

      healthyRSI:
        rsi !== null &&
        rsi >= 45 &&
        rsi <= 72,

      bullishCandle:
        candleSignal === "BULLISH" ||
        bullishCandle,

      attractiveRiskReward:
        riskRewardTarget1 >= 1.5
    };

    const conditionsMet =
      Object.values(conditions)
        .filter(Boolean)
        .length;

    const conditionsTotal =
      Object.keys(conditions).length;

    // ---------------------------------------------------------
    // Decision engine
    // ---------------------------------------------------------

    let decision = "WATCH";
    let decisionReason =
      "Setup is developing; wait for confirmation.";

    let activeStrategy = "WAIT";

    if (
      bearishSetup &&
      score <= 35
    ) {
      decision = "SELL";
      decisionReason =
        "Bearish trend/structure is dominant.";
      activeStrategy = "BEARISH";
    } else if (
      bullishSetup &&
      breakoutConfirmed &&
      score >= 75 &&
      riskRewardTarget1 >= 1.5
    ) {
      decision = "STRONG BUY";
      decisionReason =
        "Bullish setup with confirmed breakout and attractive risk/reward.";
      activeStrategy = "BREAKOUT";
    } else if (
      bullishSetup &&
      inPullbackZone &&
      riskRewardTarget1 >= 1.8 &&
      score >= 60
    ) {
      decision = "BUY";
      decisionReason =
        "Bullish setup is inside the preferred pullback entry zone.";
      activeStrategy = "PULLBACK";
    } else if (
      bullishSetup &&
      score >= 68 &&
      (
        riskRewardTarget1 >= 2 ||
        riskRewardTarget2 >= 3
      )
    ) {
      decision = "BUY";
      decisionReason =
        "Strong bullish setup with attractive upside and risk/reward.";
      activeStrategy = "PULLBACK / BREAKOUT";
    } else if (
      bullishSetup &&
      score >= 58
    ) {
      decision = "WATCH";
      decisionReason =
        "Bullish setup is developing but entry confirmation is still needed.";
      activeStrategy = "WAIT FOR ENTRY";
    } else if (
      bearishSetup
    ) {
      decision = "WATCH";
      decisionReason =
        "Bearish signals are present, but confirmation is incomplete.";
      activeStrategy = "WAIT";
    } else {
      decision = "AVOID";
      decisionReason =
        "Signals are mixed and the setup lacks sufficient edge.";
      activeStrategy = "WAIT";
    }

    // ---------------------------------------------------------
    // Trigger information
    // ---------------------------------------------------------

    const buyTriggerPrice =
      breakoutTrigger;

    const buyTriggerConfirmed =
      breakoutConfirmed;

    const triggerReason =
      breakoutConfirmed
        ? "Price has broken above recent resistance."
        : `Wait for price above ${round(
            buyTriggerPrice
          )} for breakout confirmation.`;

    // ---------------------------------------------------------
    // Reasons
    // ---------------------------------------------------------

    const reasons = [];

    if (trend === "BULLISH") {
      reasons.push(
        "Price is in a bullish trend."
      );
    }

    if (
      structureDirection === "BULLISH"
    ) {
      reasons.push(
        "Market structure shows higher highs and higher lows."
      );
    }

    if (
      macd.histogram !== null &&
      macd.histogram > 0
    ) {
      reasons.push(
        "MACD momentum is positive."
      );
    }

    if (
      rsi !== null &&
      rsi >= 50 &&
      rsi <= 70
    ) {
      reasons.push(
        "RSI supports bullish momentum without being extremely overbought."
      );
    }

    if (
      candleSignal === "BULLISH"
    ) {
      reasons.push(
        `${candlePattern} provides bullish candle confirmation.`
      );
    }

    if (
      relativeVolume !== null &&
      relativeVolume >= 1.2
    ) {
      reasons.push(
        "Trading volume is above its recent average."
      );
    }

    if (!reasons.length) {
      reasons.push(
        "No strong bullish confirmation yet."
      );
    }

    // ---------------------------------------------------------
    // Risks
    // ---------------------------------------------------------

    const risks = [];

    if (trend === "BEARISH") {
      risks.push(
        "Primary trend is bearish."
      );
    }

    if (
      structureDirection === "BEARISH"
    ) {
      risks.push(
        "Market structure shows lower highs and lower lows."
      );
    }

    if (
      rsi !== null &&
      rsi > 75
    ) {
      risks.push(
        "RSI is significantly overbought."
      );
    }

    if (
      relativeVolume !== null &&
      relativeVolume < 0.8
    ) {
      risks.push(
        "Volume confirmation is weak."
      );
    }

    if (
      riskRewardTarget1 < 1.5
    ) {
      risks.push(
        "Risk/reward to Target 1 is not attractive."
      );
    }

    if (!risks.length) {
      risks.push(
        "No major technical risk detected, but market conditions can change."
      );
    }

    // ---------------------------------------------------------
    // Trend confidence
    // ---------------------------------------------------------

    let trendConfidence = 50;

    if (trend === "BULLISH") {
      trendConfidence += 20;
    }

    if (
      structureDirection === "BULLISH"
    ) {
      trendConfidence += 15;
    }

    if (
      macd.histogram !== null &&
      macd.histogram > 0
    ) {
      trendConfidence += 10;
    }

    if (
      relativeVolume !== null &&
      relativeVolume > 1.1
    ) {
      trendConfidence += 5;
    }

    if (trend === "BEARISH") {
      trendConfidence -= 20;
    }

    trendConfidence = Math.max(
      0,
      Math.min(100, trendConfidence)
    );

    // ---------------------------------------------------------
    // Response
    // ---------------------------------------------------------

    return res.status(200).json({
      symbol,

      name: symbol,

      price: round(price),

      change: round(change),

      change_pct: round(changePct),

      decision,

      score,

      decision_reason: decisionReason,

      trend,

      trend_score: trendScore,

      trend_confidence: trendConfidence,

      short_term_trend: shortTermTrend,

      structure,

      structure_direction: structureDirection,

      candle: {
        pattern: candlePattern,
        signal: candleSignal,
        strength: candleStrength
      },

      candle_pattern: candlePattern,

      candle_signal: candleSignal,

      candle_strength: candleStrength,

      volume: {
        latest: latest.volume,
        average20: round(avgVolume20),
        relative: round(relativeVolume, 2),
        confirmation: volumeConfirmation
      },

      relative_volume: round(
        relativeVolume,
        2
      ),

      volume_confirmation:
        volumeConfirmation,

      sma20: round(sma20),

      sma50: round(sma50),

      rsi: round(rsi),

      macd: round(macd.macd, 4),

      macd_signal: round(
        macd.signal,
        4
      ),

      macd_histogram: round(
        macd.histogram,
        4
      ),

      support: round(support),

      resistance: round(resistance),

      entry_low: round(pullbackLow),

      entry_high: round(pullbackHigh),

      preferred_entry: round(
        preferredEntry
      ),

      stop: round(invalidation),

      invalidation: round(
        invalidation
      ),

      target1: round(target1),

      target2: round(target2),

      risk_per_share: round(
        riskPerShare
      ),

      reward_to_target1: round(
        rewardToTarget1
      ),

      reward_to_target2: round(
        rewardToTarget2
      ),

      risk_reward_target1: round(
        riskRewardTarget1,
        2
      ),

      risk_reward_target2: round(
        riskRewardTarget2,
        2
      ),

      risk_reward_quality:
        riskRewardQuality,

      breakout_level: round(
        breakoutLevel
      ),

      buy_trigger: true,

      buy_trigger_price: round(
        buyTriggerPrice
      ),

      buy_trigger_confirmed:
        buyTriggerConfirmed,

      trigger_reason: triggerReason,

      breakout_confirmed:
        breakoutConfirmed,

      pullback_zone: {
        low: round(pullbackLow),
        high: round(pullbackHigh),
        preferred: round(preferredEntry)
      },

      in_pullback_zone:
        inPullbackZone,

      active_strategy:
        activeStrategy,

      conditions: conditions,

      conditions_met:
        conditionsMet,

      conditions_total:
        conditionsTotal,

      formations,

      reasons,

      risks,

      history: history.map((x) => ({
        date: x.date,
        open: round(x.open),
        high: round(x.high),
        low: round(x.low),
        close: round(x.close),
        volume: x.volume,
        sma20: round(x.sma20),
        sma50: round(x.sma50),
        rsi: round(x.rsi),
        macd: round(x.macd, 4),
        macdSignal: round(
          x.macdSignal,
          4
        ),
        macdHistogram: round(
          x.macdHistogram,
          4
        )
      })),

      last_updated: latest.date
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      message: error.message
    });
  }
}
