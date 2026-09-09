const https = require("https");

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Invalid API response"));
          }
        });
      })
      .on("error", reject);
  });
}

function sma(values, period) {
  if (values.length < period) return null;

  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;

  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result = (values[i] - result) * multiplier + result;
  }

  return result;
}

function calculateMACD(closes) {
  if (closes.length < 35) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  if (ema12 === null || ema26 === null) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macd = ema12 - ema26;

  const macdSeries = [];

  for (let i = 26; i <= closes.length; i++) {
    const slice = closes.slice(0, i);
    const e12 = ema(slice, 12);
    const e26 = ema(slice, 26);

    if (e12 !== null && e26 !== null) {
      macdSeries.push(e12 - e26);
    }
  }

  const signal = ema(macdSeries, 9);

  return {
    macd,
    signal,
    histogram: signal === null ? null : macd - signal
  };
}

function round(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Number(value.toFixed(decimals));
}

function detectCandlePattern(bars) {
  if (bars.length < 3) {
    return {
      pattern: "NONE",
      signal: "NEUTRAL",
      strength: "LOW",
      description: "Not enough data"
    };
  }

  const a = bars[bars.length - 3];
  const b = bars[bars.length - 2];
  const c = bars[bars.length - 1];

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;

  const bullish = c.close > c.open;
  const bearish = c.close < c.open;

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  if (
    a.close < a.open &&
    b.close > b.open &&
    b.open <= a.close &&
    b.close >= a.open
  ) {
    return {
      pattern: "BULLISH ENGULFING",
      signal: "BULLISH",
      strength: "HIGH",
      description: "Bullish candle completely engulfs the previous bearish candle."
    };
  }

  if (
    a.close > a.open &&
    b.close < b.open &&
    b.open >= a.close &&
    b.close <= a.open
  ) {
    return {
      pattern: "BEARISH ENGULFING",
      signal: "BEARISH",
      strength: "HIGH",
      description: "Bearish candle completely engulfs the previous bullish candle."
    };
  }

  if (
    lowerWick > body * 2 &&
    upperWick < body &&
    body / Math.max(range, 0.00001) < 0.4
  ) {
    return {
      pattern: "HAMMER",
      signal: "BULLISH",
      strength: "MEDIUM",
      description: "Long lower wick suggests rejection of lower prices."
    };
  }

  if (
    upperWick > body * 2 &&
    lowerWick < body &&
    body / Math.max(range, 0.00001) < 0.4
  ) {
    return {
      pattern: "SHOOTING STAR",
      signal: "BEARISH",
      strength: "MEDIUM",
      description: "Long upper wick suggests rejection of higher prices."
    };
  }

  if (body / Math.max(range, 0.00001) < 0.12) {
    return {
      pattern: "DOJI",
      signal: "NEUTRAL",
      strength: "MEDIUM",
      description: "Indecision candle with little separation between open and close."
    };
  }

  if (bullish && range > 0 && body / range > 0.75) {
    return {
      pattern: "STRONG BULLISH CANDLE",
      signal: "BULLISH",
      strength: "MEDIUM",
      description: "Strong bullish price expansion."
    };
  }

  if (bearish && range > 0 && body / range > 0.75) {
    return {
      pattern: "STRONG BEARISH CANDLE",
      signal: "BEARISH",
      strength: "MEDIUM",
      description: "Strong bearish price expansion."
    };
  }

  return {
    pattern: "NORMAL",
    signal: "NEUTRAL",
    strength: "LOW",
    description: "No major candlestick pattern detected."
  };
}

function findPivotHighs(bars, distance = 3) {
  const result = [];

  for (let i = distance; i < bars.length - distance; i++) {
    let isHigh = true;

    for (let j = 1; j <= distance; j++) {
      if (
        bars[i].high <= bars[i - j].high ||
        bars[i].high <= bars[i + j].high
      ) {
        isHigh = false;
        break;
      }
    }

    if (isHigh) result.push(i);
  }

  return result;
}

function findPivotLows(bars, distance = 3) {
  const result = [];

  for (let i = distance; i < bars.length - distance; i++) {
    let isLow = true;

    for (let j = 1; j <= distance; j++) {
      if (
        bars[i].low >= bars[i - j].low ||
        bars[i].low >= bars[i + j].low
      ) {
        isLow = false;
        break;
      }
    }

    if (isLow) result.push(i);
  }

  return result;
}

function detectChartPatterns(bars) {
  const patterns = [];

  if (bars.length < 50) return patterns;

  const highs = findPivotHighs(bars);
  const lows = findPivotLows(bars);

  const lastPrice = bars[bars.length - 1].close;

  // DOUBLE BOTTOM
  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];

    if (l2 - l1 >= 8 && l2 - l1 <= 60) {
      const low1 = bars[l1].low;
      const low2 = bars[l2].low;

      const similarity =
        Math.abs(low1 - low2) / ((low1 + low2) / 2);

      if (similarity <= 0.05) {
        let neckline = -Infinity;

        for (let i = l1; i <= l2; i++) {
          neckline = Math.max(neckline, bars[i].high);
        }

        patterns.push({
          name: "DOUBLE BOTTOM",
          type: "BULLISH",
          confidence: Math.round(82 - similarity * 100),
          status: lastPrice > neckline ? "CONFIRMED" : "FORMING",
          trigger: round(neckline),
          target: round(neckline + (neckline - Math.min(low1, low2))),
          description:
            "Two similar lows with a recovery between them. Confirmation comes on a breakout above the neckline."
        });
      }
    }
  }

  // DOUBLE TOP
  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];

    if (h2 - h1 >= 8 && h2 - h1 <= 60) {
      const high1 = bars[h1].high;
      const high2 = bars[h2].high;

      const similarity =
        Math.abs(high1 - high2) / ((high1 + high2) / 2);

      if (similarity <= 0.05) {
        let neckline = Infinity;

        for (let i = h1; i <= h2; i++) {
          neckline = Math.min(neckline, bars[i].low);
        }

        patterns.push({
          name: "DOUBLE TOP",
          type: "BEARISH",
          confidence: Math.round(82 - similarity * 100),
          status: lastPrice < neckline ? "CONFIRMED" : "FORMING",
          trigger: round(neckline),
          target: round(neckline - (Math.max(high1, high2) - neckline)),
          description:
            "Two similar highs. Confirmation comes when price breaks below the neckline."
        });
      }
    }
  }

  // ASCENDING TRIANGLE
  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);

    const highValues = recentHighs.map(i => bars[i].high);
    const lowValues = recentLows.map(i => bars[i].low);

    const highRange =
      (Math.max(...highValues) - Math.min(...highValues)) /
      Math.max(...highValues);

    const risingLows =
      lowValues[2] > lowValues[0] &&
      lowValues[1] >= lowValues[0];

    if (highRange < 0.035 && risingLows) {
      const trigger = Math.max(...highValues);

      patterns.push({
        name: "ASCENDING TRIANGLE",
        type: "BULLISH",
        confidence: 75,
        status: lastPrice > trigger ? "CONFIRMED" : "FORMING",
        trigger: round(trigger),
        target: round(
          trigger +
            (trigger - Math.min(...lowValues))
        ),
        description:
          "Flat resistance with rising lows. Usually bullish when resistance breaks."
      });
    }
  }

  // DESCENDING TRIANGLE
  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);

    const highValues = recentHighs.map(i => bars[i].high);
    const lowValues = recentLows.map(i => bars[i].low);

    const lowRange =
      (Math.max(...lowValues) - Math.min(...lowValues)) /
      Math.max(...lowValues);

    const fallingHighs =
      highValues[2] < highValues[0] &&
      highValues[1] <= highValues[0];

    if (lowRange < 0.035 && fallingHighs) {
      const trigger = Math.min(...lowValues);

      patterns.push({
        name: "DESCENDING TRIANGLE",
        type: "BEARISH",
        confidence: 75,
        status: lastPrice < trigger ? "CONFIRMED" : "FORMING",
        trigger: round(trigger),
        target: round(
          trigger -
            (Math.max(...highValues) - trigger)
        ),
        description:
          "Flat support with falling highs. Usually bearish when support breaks."
      });
    }
  }

  // CUP & HANDLE
  if (bars.length >= 90) {
    const start = bars.length - 90;
    const window = bars.slice(start);

    let minIndex = 0;

    for (let i = 1; i < window.length; i++) {
      if (window[i].low < window[minIndex].low) {
        minIndex = i;
      }
    }

    if (minIndex > 15 && minIndex < 70) {
      const leftHigh = Math.max(
        ...window.slice(0, minIndex).map(x => x.high)
      );

      const rightHigh = Math.max(
        ...window.slice(minIndex + 1).map(x => x.high)
      );

      const rim = Math.min(leftHigh, rightHigh);

      const handleLow = Math.min(
        ...window.slice(-15).map(x => x.low)
      );

      const handleDepth =
        (rim - handleLow) / rim;

      const rimSimilarity =
        Math.abs(leftHigh - rightHigh) /
        ((leftHigh + rightHigh) / 2);

      if (
        rimSimilarity < 0.12 &&
        handleDepth > 0.005 &&
        handleDepth < 0.18
      ) {
        patterns.push({
          name: "CUP & HANDLE",
          type: "BULLISH",
          confidence: 70,
          status: lastPrice > rim ? "CONFIRMED" : "FORMING",
          trigger: round(rim),
          target: round(rim + (rim - window[minIndex].low)),
          description:
            "Rounded base followed by a smaller pullback. Confirmation comes above the rim."
        });
      }
    }
  }

  return patterns;
}

function analyzeStructure(bars) {
  const highs = findPivotHighs(bars);
  const lows = findPivotLows(bars);

  if (highs.length < 2 || lows.length < 2) {
    return {
      structure: "UNDEFINED",
      direction: "NEUTRAL"
    };
  }

  const h1 = bars[highs[highs.length - 2]].high;
  const h2 = bars[highs[highs.length - 1]].high;

  const l1 = bars[lows[lows.length - 2]].low;
  const l2 = bars[lows[lows.length - 1]].low;

  if (h2 > h1 && l2 > l1) {
    return {
      structure: "HIGHER HIGH + HIGHER LOW",
      direction: "BULLISH"
    };
  }

  if (h2 < h1 && l2 < l1) {
    return {
      structure: "LOWER HIGH + LOWER LOW",
      direction: "BEARISH"
    };
  }

  if (h2 > h1 && l2 < l1) {
    return {
      structure: "EXPANDING RANGE",
      direction: "NEUTRAL"
    };
  }

  return {
    structure: "MIXED / SIDEWAYS",
    direction: "NEUTRAL"
  };
}

function calculateTrend(price, sma20, sma50) {
  if (sma20 === null || sma50 === null) {
    return {
      trend: "SIDEWAYS",
      score: 50,
      confidence: 50
    };
  }

  if (price > sma20 && sma20 > sma50) {
    const strength =
      Math.min(100, 65 + ((price - sma50) / sma50) * 250);

    return {
      trend: "BULLISH",
      score: Math.round(strength),
      confidence: Math.round(strength)
    };
  }

  if (price < sma20 && sma20 < sma50) {
    const strength =
      Math.min(100, 65 + ((sma50 - price) / sma50) * 250);

    return {
      trend: "BEARISH",
      score: Math.round(100 - strength),
      confidence: Math.round(strength)
    };
  }

  return {
    trend: "SIDEWAYS",
    score: 50,
    confidence: 60
  };
}

function getVolumeAnalysis(bars) {
  if (bars.length < 21) {
    return {
      relativeVolume: null,
      confirmation: false
    };
  }

  const current = bars[bars.length - 1].volume;

  const average =
    bars
      .slice(-21, -1)
      .reduce((sum, x) => sum + x.volume, 0) / 20;

  const relativeVolume = current / average;

  return {
    relativeVolume,
    confirmation: relativeVolume >= 1.2
  };
}

function calculateScore({
  price,
  sma20,
  sma50,
  rsi,
  macd,
  structure,
  candle,
  volume
}) {
  let score = 50;

  if (sma20 !== null) {
    score += price > sma20 ? 8 : -8;
  }

  if (sma50 !== null) {
    score += price > sma50 ? 10 : -10;
  }

  if (sma20 !== null && sma50 !== null) {
    score += sma20 > sma50 ? 8 : -8;
  }

  if (rsi !== null) {
    if (rsi >= 55 && rsi <= 70) score += 8;
    else if (rsi > 70) score += 2;
    else if (rsi < 40) score -= 8;
  }

  if (macd.macd !== null && macd.signal !== null) {
    score += macd.macd > macd.signal ? 8 : -8;
  }

  if (structure.direction === "BULLISH") score += 10;
  if (structure.direction === "BEARISH") score -= 10;

  if (candle.signal === "BULLISH") score += 5;
  if (candle.signal === "BEARISH") score -= 5;

  if (volume.confirmation) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildDecision({
  price,
  resistance,
  support,
  sma20,
  rsi,
  macd,
  structure,
  candle,
  volume,
  score,
  trend,
  chartPatterns
}) {
  const triggerPrice = resistance * 1.002;

  const pullbackHigh = Math.max(
    support,
    sma20 || support
  );

  const pullbackEntry =
    (support + pullbackHigh) / 2;

  const invalidation = support;

  const range =
    Math.max(
      resistance - support,
      price * 0.05
    );

  const breakoutTarget1 =
    resistance + range * 0.5;

  const breakoutTarget2 =
    resistance + range;

  const pullbackTarget1 =
    breakoutTarget1;

  const pullbackTarget2 =
    breakoutTarget2;

  const breakoutRisk =
    Math.max(0.01, triggerPrice - invalidation);

  const pullbackRisk =
    Math.max(0.01, pullbackEntry - invalidation);

  const breakoutRR1 =
    (breakoutTarget1 - triggerPrice) /
    breakoutRisk;

  const breakoutRR2 =
    (breakoutTarget2 - triggerPrice) /
    breakoutRisk;

  const pullbackRR1 =
    (pullbackTarget1 - pullbackEntry) /
    pullbackRisk;

  const pullbackRR2 =
    (pullbackTarget2 - pullbackEntry) /
    pullbackRisk;

  const bullishStructure =
    structure.direction === "BULLISH";

  const bullishMomentum =
    macd.macd !== null &&
    macd.signal !== null &&
    macd.macd > macd.signal;

  const healthyRSI =
    rsi !== null &&
    rsi >= 50 &&
    rsi < 75;

  const bullishCandle =
    candle.signal === "BULLISH";

  const aboveSMA20 =
    sma20 !== null && price > sma20;

  const nearPullback =
    price >= support &&
    price <= pullbackHigh * 1.02;

  const aboveResistance =
    price >= triggerPrice;

  const conditions = [
    {
      name: "Bullish structure",
      met: bullishStructure
    },
    {
      name: "Bullish momentum",
      met: bullishMomentum
    },
    {
      name: "RSI healthy",
      met: healthyRSI
    },
    {
      name: "Price above SMA20",
      met: aboveSMA20
    },
    {
      name: "Bullish candle",
      met: bullishCandle
    },
    {
      name: "Volume confirmation",
      met: volume.confirmation
    }
  ];

  const conditionsMet =
    conditions.filter(x => x.met).length;

  /*
   * IMPORTANT CHANGE:
   *
   * We no longer require ALL conditions to be true.
   *
   * Setup quality and trigger confirmation are separate.
   */

  let setupType = "NEUTRAL";

  if (
    score >= 70 &&
    bullishStructure &&
    bullishMomentum
  ) {
    setupType = "BULLISH";
  } else if (
    score >= 60 &&
    (bullishStructure || bullishMomentum)
  ) {
    setupType = "BULLISH";
  } else if (
    score <= 35 &&
    structure.direction === "BEARISH"
  ) {
    setupType = "BEARISH";
  } else {
    setupType = "NEUTRAL";
  }

  const breakoutConfirmed =
    aboveResistance &&
    bullishStructure &&
    bullishMomentum &&
    healthyRSI;

  const pullbackConfirmed =
    nearPullback &&
    bullishStructure &&
    bullishMomentum &&
    score >= 60;

  let signal = "WATCH";
  let signalReason = "";

  if (
    setupType === "BULLISH" &&
    breakoutConfirmed &&
    score >= 75 &&
    (breakoutRR1 >= 1.5 || pullbackRR1 >= 1.5)
  ) {
    signal = "STRONG BUY";
    signalReason =
      "Bullish setup with breakout and momentum confirmation.";
  } else if (
    setupType === "BULLISH" &&
    (
      pullbackRR1 >= 1.5 ||
      breakoutRR1 >= 1.5
    ) &&
    (
      conditionsMet >= 4 ||
      pullbackConfirmed
    )
  ) {
    signal = "BUY";
    signalReason =
      "Attractive bullish setup with sufficient confirmation. Exact entry still depends on breakout or pullback execution.";
  } else if (
    setupType === "BEARISH" &&
    score <= 35
  ) {
    signal = "SELL";
    signalReason =
      "Bearish structure and weak technical conditions.";
  } else if (
    setupType === "BULLISH"
  ) {
    signal = "WATCH";
    signalReason =
      `Bullish setup developing. Wait for confirmation above ${round(triggerPrice)} or an attractive pullback.`;
  } else {
    signal = "WATCH";
    signalReason =
      "No sufficiently strong directional setup.";
  }

  let strategy = "WAIT";

  if (pullbackRR1 >= 2 && setupType === "BULLISH") {
    strategy = "PULLBACK";
  } else if (breakoutRR1 >= 1.5 && setupType === "BULLISH") {
    strategy = "BREAKOUT";
  }

  return {
    signal,
    signalReason,

    setupType,

    buyTrigger:
      strategy === "PULLBACK"
        ? "BULLISH REACTION FROM PULLBACK ZONE"
        : "BREAKOUT ABOVE RESISTANCE",

    buyTriggerPrice:
      strategy === "PULLBACK"
        ? pullbackEntry
        : triggerPrice,

    triggerConfirmed:
      breakoutConfirmed || pullbackConfirmed,

    invalidation,

    invalidationReason:
      "Setup is invalidated if price closes below key structural support.",

    riskPerShare:
      strategy === "PULLBACK"
        ? pullbackRisk
        : breakoutRisk,

    target1:
      strategy === "PULLBACK"
        ? pullbackTarget1
        : breakoutTarget1,

    target2:
      strategy === "PULLBACK"
        ? pullbackTarget2
        : breakoutTarget2,

    riskRewardTarget1:
      strategy === "PULLBACK"
        ? pullbackRR1
        : breakoutRR1,

    riskRewardTarget2:
      strategy === "PULLBACK"
        ? pullbackRR2
        : breakoutRR2,

    riskRewardQuality:
      Math.max(
        strategy === "PULLBACK"
          ? pullbackRR1
          : breakoutRR1,
        0
      ) >= 2
        ? "ATTRACTIVE"
        : Math.max(
            strategy === "PULLBACK"
              ? pullbackRR1
              : breakoutRR1,
            0
          ) >= 1.5
        ? "ACCEPTABLE"
        : "NOT ATTRACTIVE",

    strategy,

    pullbackZoneLow: support,
    pullbackZoneHigh: pullbackHigh,
    pullbackEntry,

    breakoutTrigger: triggerPrice,

    breakoutConfirmed,
    pullbackConfirmed,

    conditions,
    conditionsMet,
    conditionsTotal: conditions.length,

    chartPatterns
  };
}

module.exports = async function handler(req, res) {
  try {
    const ticker = String(
      req.query.ticker || req.query.symbol || ""
    )
      .trim()
      .toUpperCase();

    if (!ticker) {
      return res.status(400).json({
        error: "Missing ticker"
      });
    }

    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Missing Alpha Vantage API key"
      });
    }

    const url =
      `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY` +
      `&symbol=${encodeURIComponent(ticker)}` +
      `&outputsize=compact` +
      `&apikey=${encodeURIComponent(apiKey)}`;

    const data = await fetchJSON(url);

    if (data.Note) {
      return res.status(429).json({
        error: "Alpha Vantage API limit reached",
        details: data.Note
      });
    }

    if (data["Error Message"]) {
      return res.status(400).json({
        error: "Invalid ticker",
        details: data["Error Message"]
      });
    }

    const series =
      data["Time Series (Daily)"];

    if (!series) {
      return res.status(500).json({
        error: "No daily price data returned"
      });
    }

    const dates = Object.keys(series).sort();

    const bars = dates
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

    if (bars.length < 30) {
      return res.status(500).json({
        error: "Not enough historical data"
      });
    }

    const closes = bars.map(x => x.close);

    for (let i = 0; i < bars.length; i++) {
      const slice = closes.slice(0, i + 1);

      bars[i].sma20 = sma(slice, 20);
      bars[i].sma50 = sma(slice, 50);
      bars[i].rsi14 = calculateRSI(slice, 14);

      const macd = calculateMACD(slice);

      bars[i].macd = macd.macd;
      bars[i].macdSignal = macd.signal;
      bars[i].macdHistogram = macd.histogram;
    }

    const latest = bars[bars.length - 1];

    const price = latest.close;

    const sma20 = latest.sma20;
    const sma50 = latest.sma50;
    const rsi = latest.rsi14;

    const macd = {
      macd: latest.macd,
      signal: latest.macdSignal,
      histogram: latest.macdHistogram
    };

    const recent20 =
      bars.slice(-20);

    const support =
      Math.min(...recent20.map(x => x.low));

    const resistance =
      Math.max(...recent20.map(x => x.high));

    const structure =
      analyzeStructure(bars);

    const trend =
      calculateTrend(
        price,
        sma20,
        sma50
      );

    const candle =
      detectCandlePattern(bars);

    const volume =
      getVolumeAnalysis(bars);

    const chartPatterns =
      detectChartPatterns(bars);

    const score =
      calculateScore({
        price,
        sma20,
        sma50,
        rsi,
        macd,
        structure,
        candle,
        volume
      });

    const shortTermTrend =
      price > (sma20 || price)
        ? "BULLISH"
        : price < (sma20 || price)
        ? "BEARISH"
        : "SIDEWAYS";

    const decision =
      buildDecision({
        price,
        resistance,
        support,
        sma20,
        rsi,
        macd,
        structure,
        candle,
        volume,
        score,
        trend,
        chartPatterns
      });

    const reasons = [];

    if (price > sma20) {
      reasons.push("Price above SMA20");
    }

    if (sma20 && sma50 && sma20 > sma50) {
      reasons.push("SMA20 above SMA50");
    }

    if (structure.direction === "BULLISH") {
      reasons.push("Higher highs and higher lows");
    }

    if (
      macd.macd !== null &&
      macd.signal !== null &&
      macd.macd > macd.signal
    ) {
      reasons.push("MACD bullish");
    }

    if (rsi !== null && rsi >= 50) {
      reasons.push("RSI supports bullish momentum");
    }

    if (candle.signal === "BULLISH") {
      reasons.push(candle.pattern);
    }

    if (volume.confirmation) {
      reasons.push("Volume confirmation");
    }

    const risks = [];

    if (price < sma20) {
      risks.push("Price below SMA20");
    }

    if (
      sma20 &&
      sma50 &&
      sma20 < sma50
    ) {
      risks.push("SMA20 below SMA50");
    }

    if (structure.direction === "BEARISH") {
      risks.push("Bearish market structure");
    }

    if (
      rsi !== null &&
      rsi > 75
    ) {
      risks.push("RSI elevated");
    }

    if (candle.signal === "BEARISH") {
      risks.push(candle.pattern);
    }

    if (
      decision.riskRewardQuality ===
      "NOT ATTRACTIVE"
    ) {
      risks.push("Risk/reward not attractive");
    }

    return res.status(200).json({
      ticker,

      price: round(price),

      changePercent: null,

      score,

      signal: decision.signal,

      signalReason:
        decision.signalReason,

      trend: trend.trend,
      trendScore: trend.score,
      trendConfidence: trend.confidence,

      shortTermTrend,

      structure:
        structure.structure,

      structureDirection:
        structure.direction,

      sma20: round(sma20),
      sma50: round(sma50),

      rsi14: round(rsi),

      macd: round(macd.macd, 4),
      macdSignal: round(macd.signal, 4),
      macdHistogram:
        round(macd.histogram, 4),

      support: round(support),
      resistance: round(resistance),

      candlePattern:
        candle.pattern,

      candleSignal:
        candle.signal,

      candleStrength:
        candle.strength,

      candleDescription:
        candle.description,

      volume:
        latest.volume,

      relativeVolume:
        round(volume.relativeVolume, 2),

      volumeConfirmation:
        volume.confirmation,

      chartPatterns,

      primaryChartPattern:
        chartPatterns.length
          ? chartPatterns[0]
          : null,

      setup:
        decision.setupType,

      buyTrigger:
        decision.buyTrigger,

      buyTriggerPrice:
        round(decision.buyTriggerPrice),

      triggerConfirmed:
        decision.triggerConfirmed,

      breakoutTrigger:
        round(decision.breakoutTrigger),

      breakoutConfirmed:
        decision.breakoutConfirmed,

      pullbackConfirmed:
        decision.pullbackConfirmed,

      pullbackZoneLow:
        round(decision.pullbackZoneLow),

      pullbackZoneHigh:
        round(decision.pullbackZoneHigh),

      pullbackEntry:
        round(decision.pullbackEntry),

      invalidation:
        round(decision.invalidation),

      invalidationReason:
        decision.invalidationReason,

      riskPerShare:
        round(decision.riskPerShare),

      target1:
        round(decision.target1),

      target2:
        round(decision.target2),

      riskRewardTarget1:
        round(decision.riskRewardTarget1, 2),

      riskRewardTarget2:
        round(decision.riskRewardTarget2, 2),

      riskRewardQuality:
        decision.riskRewardQuality,

      strategy:
        decision.strategy,

      conditions:
        decision.conditions,

      conditionsMet:
        decision.conditionsMet,

      conditionsTotal:
        decision.conditionsTotal,

      reasons,

      risks,

      history:
        bars.slice(-100).map(x => ({
          date: x.date,
          open: round(x.open),
          high: round(x.high),
          low: round(x.low),
          close: round(x.close),
          volume: x.volume,
          sma20: round(x.sma20),
          sma50: round(x.sma50),
          rsi: round(x.rsi14),
          macd: round(x.macd, 4),
          macdSignal:
            round(x.macdSignal, 4),
          macdHistogram:
            round(x.macdHistogram, 4)
        }))
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
};
