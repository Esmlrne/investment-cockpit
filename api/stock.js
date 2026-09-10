const cache = globalThis.__investmentCockpitCache || new Map();
globalThis.__investmentCockpitCache = cache;

const AV_BASE = "https://www.alphavantage.co/query";
const CACHE_TTL = {
  daily: 10 * 60 * 1000,
  overview: 24 * 60 * 60 * 1000,
  income: 24 * 60 * 60 * 1000,
  news: 20 * 60 * 1000,
  result: 5 * 60 * 1000
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCached(key, ttl) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() - item.timestamp > ttl) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function setCached(key, value) {
  cache.set(key, {
    timestamp: Date.now(),
    value
  });
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value) {
  const n = num(value);
  return n === null ? null : n * 100;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function avg(values) {
  const clean = values.filter(v => Number.isFinite(v));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

async function alphaVantage(params) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_API_KEY is not configured");
  }

  const url = new URL(AV_BASE);

  Object.entries({
    ...params,
    apikey: apiKey
  }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Alpha Vantage HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data["Error Message"]) {
    throw new Error(data["Error Message"]);
  }

  if (data["Note"]) {
    const error = new Error(data["Note"]);
    error.rateLimited = true;
    throw error;
  }

  if (data["Information"]) {
    const error = new Error(data["Information"]);
    error.rateLimited = true;
    throw error;
  }

  return data;
}

async function safeAlphaVantage(params, cacheKey, ttl) {
  const cached = getCached(cacheKey, ttl);

  if (cached) {
    return {
      data: cached,
      fromCache: true
    };
  }

  try {
    const data = await alphaVantage(params);
    setCached(cacheKey, data);

    return {
      data,
      fromCache: false
    };
  } catch (error) {
    return {
      data: null,
      fromCache: false,
      error: error.message,
      rateLimited: !!error.rateLimited
    };
  }
}

/* ---------------------------------------------------------
   TECHNICAL INDICATORS
--------------------------------------------------------- */

function sma(values, period) {
  if (values.length < period) return null;

  const slice = values.slice(-period);
  return avg(slice);
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];

    if (change > 0) gains += change;
    if (change < 0) losses += Math.abs(change);
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;

  if (averageLoss === 0) return 100;

  const rs = averageGain / averageLoss;

  return 100 - (100 / (1 + rs));
}

function emaSeries(values, period) {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);

  let ema = avg(values.slice(0, period));
  const result = new Array(period - 1).fill(null);

  result.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    result.push(ema);
  }

  return result;
}

function calculateMACD(closes) {
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);

  if (!ema12.length || !ema26.length) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macdSeries = [];

  for (let i = 0; i < closes.length; i++) {
    if (
      ema12[i] !== null &&
      ema26[i] !== null
    ) {
      macdSeries.push(ema12[i] - ema26[i]);
    }
  }

  if (macdSeries.length < 9) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const signalSeries = emaSeries(macdSeries, 9);

  const macd = macdSeries[macdSeries.length - 1];
  const signal = signalSeries[signalSeries.length - 1];

  return {
    macd,
    signal,
    histogram:
      macd !== null && signal !== null
        ? macd - signal
        : null
  };
}

/* ---------------------------------------------------------
   CANDLE PATTERNS
--------------------------------------------------------- */

function candlePattern(history) {
  if (history.length < 3) {
    return {
      pattern: "None",
      bullish: false,
      bearish: false,
      strength: "LOW"
    };
  }

  const c = history[history.length - 1];
  const p = history[history.length - 2];
  const pp = history[history.length - 3];

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  // Doji
  if (range > 0 && body / range < 0.1) {
    return {
      pattern: "Doji",
      bullish: false,
      bearish: false,
      strength: "NEUTRAL"
    };
  }

  // Bullish engulfing
  if (
    p.close < p.open &&
    c.close > c.open &&
    c.open <= p.close &&
    c.close >= p.open
  ) {
    return {
      pattern: "Bullish Engulfing",
      bullish: true,
      bearish: false,
      strength: "HIGH"
    };
  }

  // Bearish engulfing
  if (
    p.close > p.open &&
    c.close < c.open &&
    c.open >= p.close &&
    c.close <= p.open
  ) {
    return {
      pattern: "Bearish Engulfing",
      bullish: false,
      bearish: true,
      strength: "HIGH"
    };
  }

  // Hammer
  if (
    range > 0 &&
    lowerWick >= body * 2 &&
    upperWick <= body * 0.6
  ) {
    return {
      pattern: "Hammer",
      bullish: true,
      bearish: false,
      strength: "MEDIUM"
    };
  }

  // Shooting star
  if (
    range > 0 &&
    upperWick >= body * 2 &&
    lowerWick <= body * 0.6
  ) {
    return {
      pattern: "Shooting Star",
      bullish: false,
      bearish: true,
      strength: "MEDIUM"
    };
  }

  // Morning star
  const firstBearish = pp.close < pp.open;
  const middleSmall =
    Math.abs(p.close - p.open) <
    Math.abs(pp.close - pp.open) * 0.5;

  const finalBullish = c.close > c.open;

  if (
    firstBearish &&
    middleSmall &&
    finalBullish &&
    c.close > (pp.open + pp.close) / 2
  ) {
    return {
      pattern: "Morning Star",
      bullish: true,
      bearish: false,
      strength: "HIGH"
    };
  }

  // Evening star
  const firstBullish = pp.close > pp.open;
  const finalBearish = c.close < c.open;

  if (
    firstBullish &&
    middleSmall &&
    finalBearish &&
    c.close < (pp.open + pp.close) / 2
  ) {
    return {
      pattern: "Evening Star",
      bullish: false,
      bearish: true,
      strength: "HIGH"
    };
  }

  // Strong candle
  if (range > 0 && body / range > 0.7) {
    if (c.close > c.open) {
      return {
        pattern: "Strong Bullish Candle",
        bullish: true,
        bearish: false,
        strength: "MEDIUM"
      };
    }

    if (c.close < c.open) {
      return {
        pattern: "Strong Bearish Candle",
        bullish: false,
        bearish: true,
        strength: "MEDIUM"
      };
    }
  }

  return {
    pattern: "None",
    bullish: false,
    bearish: false,
    strength: "LOW"
  };
}

/* ---------------------------------------------------------
   CHART FORMATIONS
--------------------------------------------------------- */

function detectFormations(history) {
  const results = [];

  if (history.length < 30) return results;

  const closes = history.map(x => x.close);

  const recent = closes.slice(-40);

  const min = Math.min(...recent);
  const max = Math.max(...recent);

  const minIndex = recent.indexOf(min);
  const maxIndex = recent.indexOf(max);

  // Double Bottom
  const secondHalf = recent.slice(Math.floor(recent.length / 2));

  const low1 = Math.min(
    ...recent.slice(0, Math.floor(recent.length / 2))
  );

  const low2 = Math.min(...secondHalf);

  const doubleBottomDistance =
    Math.abs(low1 - low2) / Math.max(low1, low2);

  if (
    doubleBottomDistance < 0.04 &&
    minIndex < Math.floor(recent.length * 0.75) &&
    recent[recent.length - 1] > Math.min(low1, low2) * 1.03
  ) {
    results.push({
      name: "Double Bottom",
      direction: "BULLISH",
      confidence: 72
    });
  }

  // Double Top
  const firstTop = Math.max(
    ...recent.slice(0, Math.floor(recent.length / 2))
  );

  const secondTop = Math.max(...secondHalf);

  const doubleTopDistance =
    Math.abs(firstTop - secondTop) /
    Math.max(firstTop, secondTop);

  if (
    doubleTopDistance < 0.04 &&
    recent[recent.length - 1] <
      Math.max(firstTop, secondTop) * 0.97
  ) {
    results.push({
      name: "Double Top",
      direction: "BEARISH",
      confidence: 70
    });
  }

  // Ascending triangle
  const last20 = recent.slice(-20);

  const resistanceHigh = Math.max(...last20);

  const firstLow = Math.min(...last20.slice(0, 8));
  const lastLow = Math.min(...last20.slice(-8));

  if (
    Math.abs(
      resistanceHigh -
      Math.max(...last20.slice(0, 8))
    ) / resistanceHigh < 0.025 &&
    lastLow > firstLow
  ) {
    results.push({
      name: "Ascending Triangle",
      direction: "BULLISH",
      confidence: 68
    });
  }

  // Descending triangle
  if (
    lastLow > 0 &&
    Math.abs(firstLow - lastLow) /
      Math.max(firstLow, lastLow) < 0.025 &&
    Math.max(...last20.slice(-8)) <
      Math.max(...last20.slice(0, 8))
  ) {
    results.push({
      name: "Descending Triangle",
      direction: "BEARISH",
      confidence: 66
    });
  }

  // Cup & Handle approximation
  if (recent.length >= 35) {
    const left = recent.slice(0, 10);
    const middle = recent.slice(10, 28);
    const right = recent.slice(28);

    const leftHigh = Math.max(...left);
    const middleLow = Math.min(...middle);
    const rightHigh = Math.max(...right);

    const recovery =
      rightHigh / leftHigh;

    if (
      middleLow < leftHigh * 0.92 &&
      recovery > 0.94 &&
      recent[recent.length - 1] >=
        rightHigh * 0.97
    ) {
      results.push({
        name: "Cup & Handle",
        direction: "BULLISH",
        confidence: 64
      });
    }
  }

  return results;
}

/* ---------------------------------------------------------
   TECHNICAL ANALYSIS
--------------------------------------------------------- */

function calculateTechnical(rawSeries) {
  const dates = Object.keys(rawSeries).sort();

  const history = dates.map(date => {
    const x = rawSeries[date];

    return {
      date,
      open: num(x["1. open"]),
      high: num(x["2. high"]),
      low: num(x["3. low"]),
      close: num(x["4. close"]),
      volume: num(x["5. volume"])
    };
  }).filter(x =>
    x.close !== null &&
    x.high !== null &&
    x.low !== null
  );

  const closes = history.map(x => x.close);
  const volumes = history.map(x => x.volume);

  const current = history[history.length - 1];
  const previous = history[history.length - 2];

  const price = current.close;

  const changePct =
    previous && previous.close
      ? ((price - previous.close) / previous.close) * 100
      : null;

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);

  const recent20 = history.slice(-20);

  const support = Math.min(
    ...recent20.map(x => x.low)
  );

  const resistance = Math.max(
    ...recent20.map(x => x.high)
  );

  const recentVolumes = volumes.slice(-20, -1);

  const averageVolume = avg(recentVolumes);

  const relativeVolume =
    averageVolume && current.volume
      ? current.volume / averageVolume
      : null;

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
      trendScore += 25;
    } else if (
      price < sma20 &&
      sma20 < sma50
    ) {
      trend = "BEARISH";
      trendScore -= 25;
    } else {
      trend = "SIDEWAYS";
    }
  }

  if (rsi !== null) {
    if (rsi > 55) trendScore += 8;
    if (rsi < 45) trendScore -= 8;
  }

  if (macd.macd !== null && macd.signal !== null) {
    if (macd.macd > macd.signal) {
      trendScore += 10;
    } else {
      trendScore -= 10;
    }
  }

  trendScore = clamp(trendScore, 0, 100);

  let structure = "NEUTRAL";
  let structureDirection = "NEUTRAL";

  if (history.length >= 12) {
    const old = history.slice(-12, -6);
    const recent = history.slice(-6);

    const oldHigh = Math.max(...old.map(x => x.high));
    const recentHigh = Math.max(...recent.map(x => x.high));

    const oldLow = Math.min(...old.map(x => x.low));
    const recentLow = Math.min(...recent.map(x => x.low));

    if (
      recentHigh > oldHigh &&
      recentLow > oldLow
    ) {
      structure = "HIGHER HIGH + HIGHER LOW";
      structureDirection = "BULLISH";
    } else if (
      recentHigh < oldHigh &&
      recentLow < oldLow
    ) {
      structure = "LOWER HIGH + LOWER LOW";
      structureDirection = "BEARISH";
    }
  }

  const candle = candlePattern(history);

  const formations = detectFormations(history);

  const bullishFormation =
    formations.some(x => x.direction === "BULLISH");

  const bearishFormation =
    formations.some(x => x.direction === "BEARISH");

  let technicalScore = 50;

  if (trend === "BULLISH") technicalScore += 15;
  if (trend === "BEARISH") technicalScore -= 15;

  if (structureDirection === "BULLISH") {
    technicalScore += 15;
  }

  if (structureDirection === "BEARISH") {
    technicalScore -= 15;
  }

  if (rsi !== null) {
    if (rsi >= 50 && rsi <= 70) {
      technicalScore += 8;
    }

    if (rsi < 35) {
      technicalScore += 3;
    }

    if (rsi > 75) {
      technicalScore -= 8;
    }
  }

  if (macd.macd !== null) {
    if (macd.macd > macd.signal) {
      technicalScore += 7;
    } else {
      technicalScore -= 7;
    }
  }

  if (candle.bullish) technicalScore += 6;
  if (candle.bearish) technicalScore -= 6;

  if (bullishFormation) technicalScore += 5;
  if (bearishFormation) technicalScore -= 5;

  technicalScore = clamp(
    Math.round(technicalScore),
    0,
    100
  );

  const breakoutLevel = resistance * 1.002;

  const breakoutConfirmed =
    price > breakoutLevel;

  const entryLow = support;

  const entryHigh =
    sma20 !== null
      ? Math.max(support, Math.min(sma20, resistance))
      : support;

  const preferredEntry =
    (entryLow + entryHigh) / 2;

  const invalidation = support;

  const range =
    Math.max(
      resistance - support,
      price * 0.05
    );

  const target1 =
    resistance + range * 0.5;

  const target2 =
    resistance + range;

  const riskPerShare =
    preferredEntry - invalidation;

  const reward1 =
    target1 - preferredEntry;

  const reward2 =
    target2 - preferredEntry;

  const rr1 =
    riskPerShare > 0
      ? reward1 / riskPerShare
      : null;

  const rr2 =
    riskPerShare > 0
      ? reward2 / riskPerShare
      : null;

  let riskRewardQuality = "WEAK";

  if (rr1 !== null) {
    if (rr1 >= 3) {
      riskRewardQuality = "EXCELLENT";
    } else if (rr1 >= 2) {
      riskRewardQuality = "ATTRACTIVE";
    } else if (rr1 >= 1.5) {
      riskRewardQuality = "FAIR";
    }
  }

  const inPullbackZone =
    price >= entryLow &&
    price <= entryHigh;

  const bullishSetup =
    trend !== "BEARISH" &&
    structureDirection !== "BEARISH" &&
    technicalScore >= 58;

  const pullbackConfirmed =
    bullishSetup &&
    inPullbackZone &&
    rr1 !== null &&
    rr1 >= 1.8;

  const buyConditions = {
    bullishTrend:
      trend === "BULLISH",

    bullishStructure:
      structureDirection === "BULLISH",

    macdBullish:
      macd.macd !== null &&
      macd.signal !== null &&
      macd.macd > macd.signal,

    healthyRSI:
      rsi !== null &&
      rsi >= 45 &&
      rsi <= 72,

    bullishCandle:
      candle.bullish,

    goodRiskReward:
      rr1 !== null &&
      rr1 >= 1.5
  };

  const conditionsMet =
    Object.values(buyConditions)
      .filter(Boolean).length;

  const conditionsTotal =
    Object.keys(buyConditions).length;

  return {
    history,
    price,
    changePct,

    sma20,
    sma50,
    rsi,

    macd: macd.macd,
    macdSignal: macd.signal,
    macdHistogram: macd.histogram,

    support,
    resistance,

    trend,
    trendScore,

    trendConfidence:
      trend === "SIDEWAYS"
        ? 80
        : clamp(
            55 +
            Math.abs(trendScore - 50),
            55,
            95
          ),

    shortTermTrend:
      price > (sma20 || price)
        ? "BULLISH"
        : price < (sma20 || price)
          ? "BEARISH"
          : "SIDEWAYS",

    structure,
    structureDirection,

    candle,
    formations,

    relativeVolume,
    volumeConfirmation:
      relativeVolume !== null &&
      relativeVolume >= 1.2,

    breakoutLevel,
    breakoutConfirmed,

    entryLow,
    entryHigh,
    preferredEntry,
    invalidation,
    target1,
    target2,

    riskPerShare,
    rewardToTarget1: reward1,
    rewardToTarget2: reward2,

    riskRewardTarget1: rr1,
    riskRewardTarget2: rr2,
    riskRewardQuality,

    inPullbackZone,

    bullishSetup,
    pullbackConfirmed,

    technicalScore,

    conditions: buyConditions,
    conditionsMet,
    conditionsTotal
  };
}

/* ---------------------------------------------------------
   FUNDAMENTALS
--------------------------------------------------------- */

function calculateGrowth(overview, income) {
  const annual =
    income &&
    Array.isArray(income.annualReports)
      ? income.annualReports
      : [];

  let revenueGrowth = null;
  let profitGrowth = null;
  let epsGrowth = null;

  if (annual.length >= 2) {
    const latest = annual[0];
    const previous = annual[1];

    const latestRevenue = num(latest.totalRevenue);
    const previousRevenue = num(previous.totalRevenue);

    const latestProfit = num(latest.netIncome);
    const previousProfit = num(previous.netIncome);

    const latestEPS = num(latest.eps);
    const previousEPS = num(previous.eps);

    if (
      latestRevenue !== null &&
      previousRevenue !== null &&
      previousRevenue !== 0
    ) {
      revenueGrowth =
        (latestRevenue / previousRevenue - 1) * 100;
    }

    if (
      latestProfit !== null &&
      previousProfit !== null &&
      previousProfit !== 0
    ) {
      profitGrowth =
        (latestProfit / previousProfit - 1) * 100;
    }

    if (
      latestEPS !== null &&
      previousEPS !== null &&
      previousEPS !== 0
    ) {
      epsGrowth =
        (latestEPS / previousEPS - 1) * 100;
    }
  }

  if (revenueGrowth === null) {
    revenueGrowth =
      pct(overview?.QuarterlyRevenueGrowthYOY);
  }

  if (profitGrowth === null) {
    profitGrowth =
      pct(overview?.QuarterlyEarningsGrowthYOY);
  }

  let score = 50;

  if (revenueGrowth !== null) {
    if (revenueGrowth > 10) score += 20;
    else if (revenueGrowth > 0) score += 10;
    else if (revenueGrowth < -10) score -= 20;
    else score -= 8;
  }

  if (profitGrowth !== null) {
    if (profitGrowth > 10) score += 20;
    else if (profitGrowth > 0) score += 10;
    else if (profitGrowth < -10) score -= 20;
    else score -= 8;
  }

  if (epsGrowth !== null) {
    if (epsGrowth > 10) score += 10;
    else if (epsGrowth > 0) score += 5;
    else if (epsGrowth < 0) score -= 10;
  }

  score = clamp(Math.round(score), 0, 100);

  let trend = "STABLE";

  if (score >= 70) trend = "IMPROVING";
  if (score <= 40) trend = "DECLINING";

  return {
    trend,
    score,

    revenue_growth:
      revenueGrowth === null
        ? null
        : round(revenueGrowth, 1),

    profit_growth:
      profitGrowth === null
        ? null
        : round(profitGrowth, 1),

    eps_growth:
      epsGrowth === null
        ? null
        : round(epsGrowth, 1)
  };
}

function calculateProfitability(overview) {
  const profitMargin =
    pct(overview?.ProfitMargin);

  const operatingMargin =
    pct(overview?.OperatingMarginTTM);

  const roe =
    pct(overview?.ReturnOnEquityTTM);

  let score = 50;

  if (profitMargin !== null) {
    if (profitMargin >= 20) score += 20;
    else if (profitMargin >= 10) score += 10;
    else if (profitMargin < 0) score -= 20;
  }

  if (operatingMargin !== null) {
    if (operatingMargin >= 20) score += 15;
    else if (operatingMargin >= 10) score += 8;
    else if (operatingMargin < 0) score -= 15;
  }

  if (roe !== null) {
    if (roe >= 20) score += 15;
    else if (roe >= 10) score += 8;
    else if (roe < 0) score -= 15;
  }

  score = clamp(Math.round(score), 0, 100);

  let trend = "STABLE";

  if (score >= 70) trend = "STRONG";
  if (score <= 40) trend = "WEAK";

  return {
    trend,
    score,

    profit_margin:
      profitMargin === null
        ? null
        : round(profitMargin, 1),

    operating_margin:
      operatingMargin === null
        ? null
        : round(operatingMargin, 1),

    roe:
      roe === null
        ? null
        : round(roe, 1)
  };
}

function calculateValuation(overview) {
  const pe = num(overview?.PERatio);
  const peg = num(overview?.PEGRatio);
  const eps = num(overview?.EPS);

  let score = 50;

  if (pe !== null) {
    if (pe > 0 && pe < 20) score += 20;
    else if (pe < 30) score += 10;
    else if (pe > 60) score -= 15;
  }

  if (peg !== null) {
    if (peg > 0 && peg < 1.5) score += 20;
    else if (peg < 2.5) score += 10;
    else if (peg > 3) score -= 15;
  }

  score = clamp(Math.round(score), 0, 100);

  let view = "FAIR";

  if (score >= 70) view = "ATTRACTIVE";
  else if (score <= 40) view = "EXPENSIVE";

  return {
    view,
    score,
    pe,
    peg,
    eps
  };
}

function calculateCompanyHealth(
  growth,
  profitability,
  valuation,
  technicalScore
) {
  const score = Math.round(
    growth.score * 0.35 +
    profitability.score * 0.35 +
    valuation.score * 0.20 +
    technicalScore * 0.10
  );

  let status = "MIXED";

  if (score >= 80) status = "EXCELLENT";
  else if (score >= 65) status = "HEALTHY";
  else if (score < 50) status = "WEAK";

  return {
    score: clamp(score, 0, 100),
    status
  };
}

/* ---------------------------------------------------------
   NEWS
--------------------------------------------------------- */

function parseNews(data, ticker) {
  const feed =
    data &&
    Array.isArray(data.feed)
      ? data.feed
      : [];

  const items = feed
    .slice(0, 5)
    .map(item => {
      let sentiment = item.overall_sentiment_label || "Neutral";

      if (
        Array.isArray(item.ticker_sentiment)
      ) {
        const match =
          item.ticker_sentiment.find(
            x =>
              String(x.ticker).toUpperCase() ===
              ticker
          );

        if (match?.ticker_sentiment_label) {
          sentiment =
            match.ticker_sentiment_label;
        }
      }

      return {
        title: item.title || "News",
        source: item.source || "Unknown",
        url: item.url || null,
        sentiment
      };
    });

  const scores = feed
    .slice(0, 10)
    .map(x => num(x.overall_sentiment_score))
    .filter(x => x !== null);

  const average = avg(scores);

  let overall = "NEUTRAL";

  if (average !== null) {
    if (average > 0.15) overall = "POSITIVE";
    else if (average < -0.15) overall = "NEGATIVE";
  }

  return {
    overall,
    average:
      average === null
        ? null
        : round(average, 3),
    items
  };
}

/* ---------------------------------------------------------
   DECISION ENGINE
--------------------------------------------------------- */

function makeDecision(
  technical,
  health
) {
  const {
    technicalScore,
    bullishSetup,
    breakoutConfirmed,
    pullbackConfirmed,
    riskRewardTarget1,
    riskRewardQuality,
    trend
  } = technical;

  const healthScore = health.score;

  let decision = "WATCH";
  let score = technicalScore;

  score = Math.round(
    technicalScore * 0.65 +
    healthScore * 0.35
  );

  if (
    trend === "BEARISH" &&
    score <= 45
  ) {
    decision = "SELL";
  } else if (
    bullishSetup &&
    breakoutConfirmed &&
    technicalScore >= 75 &&
    healthScore >= 75 &&
    riskRewardTarget1 >= 1.8
  ) {
    decision = "STRONG BUY";
  } else if (
    bullishSetup &&
    healthScore >= 65 &&
    (
      pullbackConfirmed ||
      (
        technicalScore >= 68 &&
        riskRewardTarget1 >= 1.5
      )
    )
  ) {
    decision = "BUY";
  } else if (
    bullishSetup &&
    score >= 55
  ) {
    decision = "WATCH";
  } else if (
    score < 40
  ) {
    decision = "AVOID";
  }

  const reasons = [];
  const risks = [];

  if (healthScore >= 70) {
    reasons.push("Company fundamentals are healthy");
  }

  if (technical.trend === "BULLISH") {
    reasons.push("Price trend is bullish");
  }

  if (
    technical.structureDirection === "BULLISH"
  ) {
    reasons.push("Market structure is improving");
  }

  if (
    technical.macd !== null &&
    technical.macdSignal !== null &&
    technical.macd > technical.macdSignal
  ) {
    reasons.push("MACD is bullish");
  }

  if (
    technical.inPullbackZone
  ) {
    reasons.push("Price is inside the preferred pullback zone");
  }

  if (
    technical.breakoutConfirmed
  ) {
    reasons.push("Price has broken above resistance");
  }

  if (
    technical.riskRewardTarget1 !== null &&
    technical.riskRewardTarget1 >= 2
  ) {
    reasons.push("Risk/reward is attractive");
  }

  if (
    technical.rsi !== null &&
    technical.rsi > 75
  ) {
    risks.push("Momentum is potentially overbought");
  }

  if (
    technical.trend === "SIDEWAYS"
  ) {
    risks.push("Trend is not clearly established");
  }

  if (
    technical.riskRewardTarget1 !== null &&
    technical.riskRewardTarget1 < 1.5
  ) {
    risks.push("Risk/reward is not attractive");
  }

  if (
    technical.structureDirection === "BEARISH"
  ) {
    risks.push("Market structure is bearish");
  }

  if (healthScore < 50) {
    risks.push("Company fundamentals are weak");
  }

  return {
    decision,
    score: clamp(score, 0, 100),
    reasons,
    risks
  };
}

/* ---------------------------------------------------------
   MAIN HANDLER
--------------------------------------------------------- */

module.exports = async function handler(req, res) {
  try {
    const ticker = String(
      req.query.ticker ||
      req.query.symbol ||
      ""
    )
      .trim()
      .toUpperCase();

    if (!ticker) {
      return res.status(400).json({
        error: "Missing ticker"
      });
    }

    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
      return res.status(400).json({
        error: "Invalid ticker"
      });
    }

    const resultCacheKey = `result:${ticker}`;

    const cachedResult =
      getCached(
        resultCacheKey,
        CACHE_TTL.result
      );

    if (cachedResult) {
      return res.status(200).json({
        ...cachedResult,
        cached: true
      });
    }

    /*
      1. DAILY PRICE DATA

      This is the most important call.
      Technical indicators are calculated locally.
    */

    const dailyResult =
      await safeAlphaVantage(
        {
          function: "TIME_SERIES_DAILY",
          symbol: ticker,
          outputsize: "compact"
        },
        `daily:${ticker}`,
        CACHE_TTL.daily
      );

    if (!dailyResult.data) {
      return res.status(200).json({
        error:
          dailyResult.error ||
          "No daily market data returned.",
        rate_limited:
          dailyResult.rateLimited || false
      });
    }

    const rawSeries =
      dailyResult.data["Time Series (Daily)"];

    if (!rawSeries) {
      return res.status(200).json({
        error: "No daily market data returned."
      });
    }

    const technical =
      calculateTechnical(rawSeries);

    /*
      Important:
      We intentionally wait between Alpha Vantage
      requests to reduce the chance of hitting the
      free per-second request limit.
    */

    await sleep(1200);

    /*
      2. COMPANY OVERVIEW
    */

    const overviewResult =
      await safeAlphaVantage(
        {
          function: "OVERVIEW",
          symbol: ticker
        },
        `overview:${ticker}`,
        CACHE_TTL.overview
      );

    await sleep(1200);

    /*
      3. INCOME STATEMENT
    */

    const incomeResult =
      await safeAlphaVantage(
        {
          function: "INCOME_STATEMENT",
          symbol: ticker
        },
        `income:${ticker}`,
        CACHE_TTL.income
      );

    await sleep(1200);

    /*
      4. NEWS

      If the request is rate limited, we do NOT
      destroy the whole dashboard.
    */

    const newsResult =
      await safeAlphaVantage(
        {
          function: "NEWS_SENTIMENT",
          tickers: ticker,
          sort: "LATEST",
          limit: 5
        },
        `news:${ticker}`,
        CACHE_TTL.news
      );

    const overview =
      overviewResult.data || {};

    const income =
      incomeResult.data || null;

    const growth =
      calculateGrowth(
        overview,
        income
      );

    const profitability =
      calculateProfitability(
        overview
      );

    const valuation =
      calculateValuation(
        overview
      );

    const companyHealth =
      calculateCompanyHealth(
        growth,
        profitability,
        valuation,
        technical.technicalScore
      );

    const news =
      parseNews(
        newsResult.data,
        ticker
      );

    const decision =
      makeDecision(
        technical,
        companyHealth
      );

    const latestUpdated =
      technical.history[
        technical.history.length - 1
      ]?.date || null;

    const name =
      overview.Name ||
      ticker;

    const response = {
      symbol: ticker,

      name,

      price:
        round(technical.price, 2),

      change_pct:
        round(technical.changePct, 2),

      decision:
        decision.decision,

      score:
        decision.score,

      company_health:
        companyHealth,

      sector:
        overview.Sector ||
        "N/A",

      industry:
        overview.Industry ||
        "N/A",

      growth,

      profitability,

      valuation,

      news_sentiment:
        news.overall,

      news:
        news.items,

      entry_low:
        round(technical.entryLow, 2),

      entry_high:
        round(technical.entryHigh, 2),

      preferred_entry:
        round(technical.preferredEntry, 2),

      invalidation:
        round(technical.invalidation, 2),

      target1:
        round(technical.target1, 2),

      target2:
        round(technical.target2, 2),

      risk_reward_target1:
        round(
          technical.riskRewardTarget1,
          2
        ),

      risk_reward_target2:
        round(
          technical.riskRewardTarget2,
          2
        ),

      risk_reward_quality:
        technical.riskRewardQuality,

      in_pullback_zone:
        technical.inPullbackZone,

      technical_score:
        technical.technicalScore,

      trend:
        technical.trend,

      trend_confidence:
        technical.trendConfidence,

      short_term_trend:
        technical.shortTermTrend,

      structure:
        technical.structure,

      structure_direction:
        technical.structureDirection,

      sma20:
        round(technical.sma20, 2),

      sma50:
        round(technical.sma50, 2),

      rsi:
        round(technical.rsi, 2),

      macd:
        round(technical.macd, 4),

      macdSignal:
        round(technical.macdSignal, 4),

      macdHistogram:
        round(
          technical.macdHistogram,
          4
        ),

      support:
        round(technical.support, 2),

      resistance:
        round(technical.resistance, 2),

      formations:
        technical.formations,

      candle_pattern:
        technical.candle.pattern,

      candle_strength:
        technical.candle.strength,

      candle_bullish:
        technical.candle.bullish,

      candle_bearish:
        technical.candle.bearish,

      breakout_level:
        round(
          technical.breakoutLevel,
          2
        ),

      breakout_confirmed:
        technical.breakoutConfirmed,

      relative_volume:
        round(
          technical.relativeVolume,
          2
        ),

      volume_confirmation:
        technical.volumeConfirmation,

      conditions:
        technical.conditions,

      conditions_met:
        technical.conditionsMet,

      conditions_total:
        technical.conditionsTotal,

      reasons:
        decision.reasons,

      risks:
        decision.risks,

      history:
        technical.history.slice(-80).map(x => ({
          date: x.date,
          open: round(x.open, 2),
          high: round(x.high, 2),
          low: round(x.low, 2),
          close: round(x.close, 2),
          volume: x.volume,
          sma20: null,
          sma50: null,
          rsi: null,
          macd: null,
          macdSignal: null,
          macdHistogram: null
        })),

      last_updated:
        latestUpdated,

      data_status: {
        daily: !!dailyResult.data,
        overview: !!overviewResult.data,
        income: !!incomeResult.data,
        news: !!newsResult.data,

        news_rate_limited:
          newsResult.rateLimited || false,

        overview_rate_limited:
          overviewResult.rateLimited || false,

        income_rate_limited:
          incomeResult.rateLimited || false
      }
    };

    setCached(
      resultCacheKey,
      response
    );

    return res.status(200).json(response);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error.message ||
        "Internal server error"
    });
  }
};
