const https = require("https");

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("Invalid API response"));
        }
      });
    }).on("error", reject);
  });
}

function round(v, d = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return null;
  }
  return Number(v.toFixed(d));
}

function sma(values, period) {
  if (values.length < period) return null;

  const arr = values.slice(-period);

  return arr.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  let result =
    values
      .slice(0, period)
      .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier +
      result;
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {
    const change =
      values[i] - values[i - 1];

    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  if (losses === 0) return 100;

  const rs = gains / losses;

  return 100 - 100 / (1 + rs);
}

function macd(values) {
  if (values.length < 35) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const e12 = ema(values, 12);
  const e26 = ema(values, 26);

  if (e12 === null || e26 === null) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const currentMACD = e12 - e26;

  const macdSeries = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);

    const a = ema(slice, 12);
    const b = ema(slice, 26);

    if (a !== null && b !== null) {
      macdSeries.push(a - b);
    }
  }

  const signal = ema(macdSeries, 9);

  return {
    macd: currentMACD,
    signal,
    histogram:
      signal === null
        ? null
        : currentMACD - signal
  };
}

function findPivotHighs(bars, distance = 3) {
  const result = [];

  for (
    let i = distance;
    i < bars.length - distance;
    i++
  ) {
    let valid = true;

    for (let j = 1; j <= distance; j++) {
      if (
        bars[i].high <= bars[i - j].high ||
        bars[i].high <= bars[i + j].high
      ) {
        valid = false;
        break;
      }
    }

    if (valid) result.push(i);
  }

  return result;
}

function findPivotLows(bars, distance = 3) {
  const result = [];

  for (
    let i = distance;
    i < bars.length - distance;
    i++
  ) {
    let valid = true;

    for (let j = 1; j <= distance; j++) {
      if (
        bars[i].low >= bars[i - j].low ||
        bars[i].low >= bars[i + j].low
      ) {
        valid = false;
        break;
      }
    }

    if (valid) result.push(i);
  }

  return result;
}

function candleAnalysis(bars) {
  if (bars.length < 3) {
    return {
      pattern: "NONE",
      signal: "NEUTRAL",
      strength: "LOW",
      description: "Insufficient candle data."
    };
  }

  const a = bars[bars.length - 2];
  const b = bars[bars.length - 1];

  const body =
    Math.abs(b.close - b.open);

  const range =
    b.high - b.low;

  const upper =
    b.high -
    Math.max(b.open, b.close);

  const lower =
    Math.min(b.open, b.close) -
    b.low;

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
      description:
        "Strong bullish reversal candle."
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
      description:
        "Strong bearish reversal candle."
    };
  }

  if (
    lower > body * 2 &&
    upper < body
  ) {
    return {
      pattern: "HAMMER",
      signal: "BULLISH",
      strength: "MEDIUM",
      description:
        "Lower-price rejection suggests buying interest."
    };
  }

  if (
    upper > body * 2 &&
    lower < body
  ) {
    return {
      pattern: "SHOOTING STAR",
      signal: "BEARISH",
      strength: "MEDIUM",
      description:
        "Higher-price rejection suggests selling pressure."
    };
  }

  if (
    range > 0 &&
    body / range < 0.12
  ) {
    return {
      pattern: "DOJI",
      signal: "NEUTRAL",
      strength: "MEDIUM",
      description:
        "Market indecision."
    };
  }

  if (
    range > 0 &&
    body / range > 0.75 &&
    b.close > b.open
  ) {
    return {
      pattern: "STRONG BULLISH CANDLE",
      signal: "BULLISH",
      strength: "MEDIUM",
      description:
        "Strong bullish price expansion."
    };
  }

  if (
    range > 0 &&
    body / range > 0.75 &&
    b.close < b.open
  ) {
    return {
      pattern: "STRONG BEARISH CANDLE",
      signal: "BEARISH",
      strength: "MEDIUM",
      description:
        "Strong bearish price expansion."
    };
  }

  return {
    pattern: "NORMAL",
    signal: "NEUTRAL",
    strength: "LOW",
    description:
      "No major candlestick pattern detected."
  };
}

/* =========================================================
   CHART FORMATIONS
   ========================================================= */

function detectChartPatterns(bars) {
  const patterns = [];

  if (bars.length < 50) {
    return patterns;
  }

  const highs = findPivotHighs(bars);
  const lows = findPivotLows(bars);

  const price =
    bars[bars.length - 1].close;

  /* DOUBLE BOTTOM */

  if (lows.length >= 2) {
    const i1 = lows[lows.length - 2];
    const i2 = lows[lows.length - 1];

    if (
      i2 - i1 >= 8 &&
      i2 - i1 <= 60
    ) {
      const low1 = bars[i1].low;
      const low2 = bars[i2].low;

      const similarity =
        Math.abs(low1 - low2) /
        ((low1 + low2) / 2);

      if (similarity <= 0.06) {
        let neckline = -Infinity;

        for (let i = i1; i <= i2; i++) {
          neckline =
            Math.max(
              neckline,
              bars[i].high
            );
        }

        patterns.push({
          name: "DOUBLE BOTTOM",
          type: "BULLISH",
          confidence: Math.round(
            85 - similarity * 100
          ),
          status:
            price > neckline
              ? "CONFIRMED"
              : "FORMING",
          trigger: round(neckline),
          target: round(
            neckline +
            (
              neckline -
              Math.min(low1, low2)
            )
          ),
          description:
            "Two similar lows followed by a recovery. A breakout above the neckline confirms the pattern."
        });
      }
    }
  }

  /* DOUBLE TOP */

  if (highs.length >= 2) {
    const i1 = highs[highs.length - 2];
    const i2 = highs[highs.length - 1];

    if (
      i2 - i1 >= 8 &&
      i2 - i1 <= 60
    ) {
      const high1 = bars[i1].high;
      const high2 = bars[i2].high;

      const similarity =
        Math.abs(high1 - high2) /
        ((high1 + high2) / 2);

      if (similarity <= 0.06) {
        let neckline = Infinity;

        for (let i = i1; i <= i2; i++) {
          neckline =
            Math.min(
              neckline,
              bars[i].low
            );
        }

        patterns.push({
          name: "DOUBLE TOP",
          type: "BEARISH",
          confidence: Math.round(
            85 - similarity * 100
          ),
          status:
            price < neckline
              ? "CONFIRMED"
              : "FORMING",
          trigger: round(neckline),
          target: round(
            neckline -
            (
              Math.max(high1, high2) -
              neckline
            )
          ),
          description:
            "Two similar highs. A break below the neckline confirms the bearish formation."
        });
      }
    }
  }

  /* ASCENDING TRIANGLE */

  if (
    highs.length >= 3 &&
    lows.length >= 3
  ) {
    const hs = highs.slice(-3);
    const ls = lows.slice(-3);

    const highValues =
      hs.map(i => bars[i].high);

    const lowValues =
      ls.map(i => bars[i].low);

    const highRange =
      (
        Math.max(...highValues) -
        Math.min(...highValues)
      ) /
      Math.max(...highValues);

    const risingLows =
      lowValues[2] > lowValues[0];

    if (
      highRange < 0.04 &&
      risingLows
    ) {
      const trigger =
        Math.max(...highValues);

      patterns.push({
        name: "ASCENDING TRIANGLE",
        type: "BULLISH",
        confidence: 76,
        status:
          price > trigger
            ? "CONFIRMED"
            : "FORMING",
        trigger: round(trigger),
        target: round(
          trigger +
          (
            trigger -
            Math.min(...lowValues)
          )
        ),
        description:
          "Flat resistance with rising lows. Bullish bias if resistance breaks."
      });
    }
  }

  /* DESCENDING TRIANGLE */

  if (
    highs.length >= 3 &&
    lows.length >= 3
  ) {
    const hs = highs.slice(-3);
    const ls = lows.slice(-3);

    const highValues =
      hs.map(i => bars[i].high);

    const lowValues =
      ls.map(i => bars[i].low);

    const lowRange =
      (
        Math.max(...lowValues) -
        Math.min(...lowValues)
      ) /
      Math.max(...lowValues);

    const fallingHighs =
      highValues[2] < highValues[0];

    if (
      lowRange < 0.04 &&
      fallingHighs
    ) {
      const trigger =
        Math.min(...lowValues);

      patterns.push({
        name: "DESCENDING TRIANGLE",
        type: "BEARISH",
        confidence: 76,
        status:
          price < trigger
            ? "CONFIRMED"
            : "FORMING",
        trigger: round(trigger),
        target: round(
          trigger -
          (
            Math.max(...highValues) -
            trigger
          )
        ),
        description:
          "Flat support with falling highs. Bearish bias if support breaks."
      });
    }
  }

  /* CUP & HANDLE */

  if (bars.length >= 90) {
    const window =
      bars.slice(-90);

    let bottom = 0;

    for (
      let i = 1;
      i < window.length;
      i++
    ) {
      if (
        window[i].low <
        window[bottom].low
      ) {
        bottom = i;
      }
    }

    if (
      bottom > 15 &&
      bottom < 70
    ) {
      const leftHigh =
        Math.max(
          ...window
            .slice(0, bottom)
            .map(x => x.high)
        );

      const rightHigh =
        Math.max(
          ...window
            .slice(bottom + 1)
            .map(x => x.high)
        );

      const rim =
        Math.min(
          leftHigh,
          rightHigh
        );

      const handleLow =
        Math.min(
          ...window
            .slice(-15)
            .map(x => x.low)
        );

      const handleDepth =
        (rim - handleLow) /
        rim;

      const rimDifference =
        Math.abs(
          leftHigh - rightHigh
        ) /
        (
          (leftHigh + rightHigh) / 2
        );

      if (
        rimDifference < 0.12 &&
        handleDepth > 0.005 &&
        handleDepth < 0.18
      ) {
        patterns.push({
          name: "CUP & HANDLE",
          type: "BULLISH",
          confidence: 70,
          status:
            price > rim
              ? "CONFIRMED"
              : "FORMING",
          trigger: round(rim),
          target: round(
            rim +
            (
              rim -
              window[bottom].low
            )
          ),
          description:
            "Rounded base followed by a smaller pullback. Breakout above the rim confirms the setup."
        });
      }
    }
  }

  return patterns;
}

/* =========================================================
   STRUCTURE
   ========================================================= */

function structureAnalysis(bars) {
  const highs =
    findPivotHighs(bars);

  const lows =
    findPivotLows(bars);

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return {
      structure: "UNDEFINED",
      direction: "NEUTRAL"
    };
  }

  const previousHigh =
    bars[
      highs[highs.length - 2]
    ].high;

  const latestHigh =
    bars[
      highs[highs.length - 1]
    ].high;

  const previousLow =
    bars[
      lows[lows.length - 2]
    ].low;

  const latestLow =
    bars[
      lows[lows.length - 1]
    ].low;

  if (
    latestHigh > previousHigh &&
    latestLow > previousLow
  ) {
    return {
      structure:
        "HIGHER HIGH + HIGHER LOW",
      direction: "BULLISH"
    };
  }

  if (
    latestHigh < previousHigh &&
    latestLow < previousLow
  ) {
    return {
      structure:
        "LOWER HIGH + LOWER LOW",
      direction: "BEARISH"
    };
  }

  return {
    structure:
      "MIXED / SIDEWAYS",
    direction: "NEUTRAL"
  };
}

/* =========================================================
   TREND
   ========================================================= */

function trendAnalysis(
  price,
  sma20,
  sma50
) {
  if (
    sma20 === null ||
    sma50 === null
  ) {
    return {
      trend: "SIDEWAYS",
      score: 50,
      confidence: 50
    };
  }

  if (
    price > sma20 &&
    sma20 > sma50
  ) {
    const confidence =
      Math.min(
        95,
        Math.round(
          65 +
          (
            (price - sma50) /
            sma50
          ) * 250
        )
      );

    return {
      trend: "BULLISH",
      score: confidence,
      confidence
    };
  }

  if (
    price < sma20 &&
    sma20 < sma50
  ) {
    const confidence =
      Math.min(
        95,
        Math.round(
          65 +
          (
            (sma50 - price) /
            sma50
          ) * 250
        )
      );

    return {
      trend: "BEARISH",
      score: 100 - confidence,
      confidence
    };
  }

  return {
    trend: "SIDEWAYS",
    score: 50,
    confidence: 60
  };
}

/* =========================================================
   VOLUME
   ========================================================= */

function volumeAnalysis(bars) {
  if (bars.length < 21) {
    return {
      relativeVolume: null,
      confirmation: false
    };
  }

  const current =
    bars[bars.length - 1].volume;

  const average =
    bars
      .slice(-21, -1)
      .reduce(
        (sum, x) =>
          sum + x.volume,
        0
      ) / 20;

  const relativeVolume =
    current / average;

  return {
    relativeVolume,
    confirmation:
      relativeVolume >= 1.15
  };
}

/* =========================================================
   SCORE
   ========================================================= */

function calculateScore({
  price,
  sma20,
  sma50,
  rsiValue,
  macdValue,
  structure,
  candle,
  volume
}) {
  let score = 50;

  if (sma20 !== null) {
    score +=
      price > sma20
        ? 8
        : -8;
  }

  if (sma50 !== null) {
    score +=
      price > sma50
        ? 10
        : -10;
  }

  if (
    sma20 !== null &&
    sma50 !== null
  ) {
    score +=
      sma20 > sma50
        ? 8
        : -8;
  }

  if (rsiValue !== null) {
    if (
      rsiValue >= 52 &&
      rsiValue <= 70
    ) {
      score += 8;
    } else if (
      rsiValue > 70
    ) {
      score += 2;
    } else if (
      rsiValue < 40
    ) {
      score -= 8;
    }
  }

  if (
    macdValue.macd !== null &&
    macdValue.signal !== null
  ) {
    score +=
      macdValue.macd >
      macdValue.signal
        ? 8
        : -8;
  }

  if (
    structure.direction ===
    "BULLISH"
  ) {
    score += 10;
  }

  if (
    structure.direction ===
    "BEARISH"
  ) {
    score -= 10;
  }

  if (
    candle.signal ===
    "BULLISH"
  ) {
    score += 5;
  }

  if (
    candle.signal ===
    "BEARISH"
  ) {
    score -= 5;
  }

  if (
    volume.confirmation
  ) {
    score += 4;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score)
    )
  );
}

/* =========================================================
   DECISION ENGINE
   ========================================================= */

function decisionEngine({
  price,
  support,
  resistance,
  sma20,
  rsiValue,
  macdValue,
  structure,
  candle,
  volume,
  score
}) {

  const breakoutTrigger =
    resistance * 1.002;

  /*
   * Pullback zone
   */

  const pullbackHigh =
    Math.max(
      support,
      sma20 || support
    );

  const pullbackEntry =
    (
      support +
      pullbackHigh
    ) / 2;

  /*
   * Risk
   */

  const invalidation =
    support;

  const range =
    Math.max(
      resistance - support,
      price * 0.05
    );

  /*
   * Targets
   */

  const target1 =
    resistance +
    range * 0.5;

  const target2 =
    resistance +
    range;

  /*
   * R/R
   */

  const breakoutRisk =
    Math.max(
      0.01,
      breakoutTrigger -
      invalidation
    );

  const pullbackRisk =
    Math.max(
      0.01,
      pullbackEntry -
      invalidation
    );

  const breakoutRR1 =
    (
      target1 -
      breakoutTrigger
    ) /
    breakoutRisk;

  const breakoutRR2 =
    (
      target2 -
      breakoutTrigger
    ) /
    breakoutRisk;

  const pullbackRR1 =
    (
      target1 -
      pullbackEntry
    ) /
    pullbackRisk;

  const pullbackRR2 =
    (
      target2 -
      pullbackEntry
    ) /
    pullbackRisk;

  /*
   * Conditions
   */

  const bullishStructure =
    structure.direction ===
    "BULLISH";

  const bullishMACD =
    macdValue.macd !== null &&
    macdValue.signal !== null &&
    macdValue.macd >
    macdValue.signal;

  const positiveRSI =
    rsiValue !== null &&
    rsiValue >= 50 &&
    rsiValue < 75;

  const aboveSMA20 =
    sma20 !== null &&
    price > sma20;

  const bullishCandle =
    candle.signal ===
    "BULLISH";

  const volumeConfirmation =
    volume.confirmation;

  const conditions = [
    {
      name: "Bullish structure",
      met: bullishStructure
    },
    {
      name: "Bullish momentum",
      met: bullishMACD
    },
    {
      name: "RSI healthy",
      met: positiveRSI
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
      met: volumeConfirmation
    }
  ];

  const conditionsMet =
    conditions.filter(
      x => x.met
    ).length;

  /*
   * ---------------------------------------------------------
   * SETUP QUALITY
   * ---------------------------------------------------------
   *
   * This is deliberately independent from breakout confirmation.
   */

  let setup = "NEUTRAL";

  if (
    score >= 70 &&
    (
      bullishStructure ||
      bullishMACD
    )
  ) {
    setup = "BULLISH";
  } else if (
    score >= 60 &&
    (
      bullishStructure &&
      bullishMACD
    )
  ) {
    setup = "BULLISH";
  } else if (
    score <= 35 &&
    structure.direction ===
    "BEARISH"
  ) {
    setup = "BEARISH";
  }

  /*
   * ---------------------------------------------------------
   * PULLBACK
   * ---------------------------------------------------------
   */

  const inPullbackZone =
    price >= support &&
    price <=
      pullbackHigh * 1.02;

  const pullbackSetup =
    setup === "BULLISH" &&
    pullbackRR1 >= 1.8;

  const pullbackConfirmed =
    pullbackSetup &&
    inPullbackZone &&
    (
      bullishMACD ||
      bullishCandle
    );

  /*
   * ---------------------------------------------------------
   * BREAKOUT
   * ---------------------------------------------------------
   */

  const breakoutConfirmed =
    price >= breakoutTrigger &&
    bullishStructure &&
    bullishMACD &&
    positiveRSI;

  /*
   * ---------------------------------------------------------
   * SIGNAL
   * ---------------------------------------------------------
   */

  let signal = "WATCH";
  let signalReason = "";
  let strategy = "WAIT";

  /*
   * STRONG BUY
   *
   * We need a genuinely strong setup.
   */

  if (
    setup === "BULLISH" &&
    breakoutConfirmed &&
    score >= 75 &&
    (
      breakoutRR1 >= 1.5 ||
      pullbackRR1 >= 1.5
    )
  ) {

    signal = "STRONG BUY";

    signalReason =
      "Strong bullish setup with breakout, momentum and acceptable risk/reward.";

    strategy =
      "BREAKOUT";

  }

  /*
   * BUY FROM PULLBACK
   */

  else if (
    pullbackConfirmed &&
    pullbackRR1 >= 1.8 &&
    score >= 60
  ) {

    signal = "BUY";

    signalReason =
      "Bullish setup has reached an attractive pullback zone with supportive momentum and risk/reward.";

    strategy =
      "PULLBACK";

  }

  /*
   * BUY — QUALITY SETUP
   *
   * This is the major change.
   *
   * No breakout required.
   * No 4/6 requirement.
   */

  else if (
    setup === "BULLISH" &&
    score >= 68 &&
    (
      pullbackRR1 >= 2 ||
      breakoutRR1 >= 1.5
    ) &&
    (
      bullishStructure ||
      bullishMACD
    )
  ) {

    signal = "BUY";

    signalReason =
      "Bullish setup with attractive risk/reward. Entry should be executed using the preferred pullback or breakout strategy.";

    strategy =
      pullbackRR1 >= 2
        ? "PULLBACK"
        : "BREAKOUT";

  }

  /*
   * BULLISH WATCH
   */

  else if (
    setup === "BULLISH" &&
    score >= 58
  ) {

    signal = "WATCH";

    signalReason =
      `Bullish setup developing. Preferred trigger is ${round(
        pullbackRR1 >= 2
          ? pullbackEntry
          : breakoutTrigger
      )}.`;

    strategy =
      pullbackRR1 >= 2
        ? "PULLBACK"
        : "BREAKOUT";

  }

  /*
   * SELL
   */

  else if (
    setup === "BEARISH" &&
    score <= 35
  ) {

    signal = "SELL";

    signalReason =
      "Bearish structure and weak technical conditions.";

    strategy =
      "WAIT";

  }

  else {

    signal = "WATCH";

    signalReason =
      "No sufficiently strong directional setup.";

    strategy =
      "WAIT";
  }

  /*
   * Risk/reward quality
   */

  const activeRR =
    strategy === "PULLBACK"
      ? pullbackRR1
      : breakoutRR1;

  let riskRewardQuality =
    "NOT ATTRACTIVE";

  if (activeRR >= 2) {
    riskRewardQuality =
      "ATTRACTIVE";
  } else if (activeRR >= 1.5) {
    riskRewardQuality =
      "ACCEPTABLE";
  }

  /*
   * Active entry
   */

  const activeEntry =
    strategy === "PULLBACK"
      ? pullbackEntry
      : breakoutTrigger;

  const activeRisk =
    Math.max(
      0.01,
      activeEntry -
      invalidation
    );

  return {

    signal,

    signalReason,

    setup,

    strategy,

    buyTrigger:
      strategy === "PULLBACK"
        ? "PULLBACK ENTRY"
        : "BREAKOUT ABOVE RESISTANCE",

    buyTriggerPrice:
      activeEntry,

    triggerConfirmed:
      breakoutConfirmed ||
      pullbackConfirmed,

    breakoutTrigger,

    breakoutConfirmed,

    pullbackConfirmed,

    pullbackZoneLow:
      support,

    pullbackZoneHigh:
      pullbackHigh,

    pullbackEntry,

    invalidation,

    invalidationReason:
      "Setup is invalidated if price closes below key structural support.",

    riskPerShare:
      activeRisk,

    target1,

    target2,

    riskRewardTarget1:
      strategy === "PULLBACK"
        ? pullbackRR1
        : breakoutRR1,

    riskRewardTarget2:
      strategy === "PULLBACK"
        ? pullbackRR2
        : breakoutRR2,

    riskRewardQuality,

    conditions,

    conditionsMet,

    conditionsTotal:
      conditions.length
  };
}

/* =========================================================
   MAIN API
   ========================================================= */

module.exports = async function handler(req, res) {

  try {

    const ticker =
      String(
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

    const apiKey =
      process.env.ALPHA_VANTAGE_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error:
          "Missing Alpha Vantage API key"
      });
    }

    const url =
      "https://www.alphavantage.co/query" +
      "?function=TIME_SERIES_DAILY" +
      "&symbol=" +
      encodeURIComponent(ticker) +
      "&outputsize=compact" +
      "&apikey=" +
      encodeURIComponent(apiKey);

    const data =
      await fetchJSON(url);

    if (data.Note) {
      return res.status(429).json({
        error:
          "Alpha Vantage API limit reached"
      });
    }

    if (data["Error Message"]) {
      return res.status(400).json({
        error:
          "Invalid ticker"
      });
    }

    const series =
      data["Time Series (Daily)"];

    if (!series) {
      return res.status(500).json({
        error:
          "No daily price data returned"
      });
    }

    const dates =
      Object.keys(series)
        .sort();

    const bars =
      dates
        .map(date => ({
          date,

          open:
            Number(
              series[date]["1. open"]
            ),

          high:
            Number(
              series[date]["2. high"]
            ),

          low:
            Number(
              series[date]["3. low"]
            ),

          close:
            Number(
              series[date]["4. close"]
            ),

          volume:
            Number(
              series[date]["5. volume"]
            )
        }))
        .filter(
          x =>
            Number.isFinite(x.close)
        );

    if (bars.length < 30) {
      return res.status(500).json({
        error:
          "Not enough historical data"
      });
    }

    const closes =
      bars.map(
        x => x.close
      );

    /*
     * Indicators
     */

    for (
      let i = 0;
      i < bars.length;
      i++
    ) {

      const history =
        closes.slice(
          0,
          i + 1
        );

      bars[i].sma20 =
        sma(history, 20);

      bars[i].sma50 =
        sma(history, 50);

      bars[i].rsi14 =
        rsi(history, 14);

      const m =
        macd(history);

      bars[i].macd =
        m.macd;

      bars[i].macdSignal =
        m.signal;

      bars[i].macdHistogram =
        m.histogram;
    }

    const latest =
      bars[bars.length - 1];

    const price =
      latest.close;

    const sma20 =
      latest.sma20;

    const sma50 =
      latest.sma50;

    const rsiValue =
      latest.rsi14;

    const macdValue = {
      macd:
        latest.macd,

      signal:
        latest.macdSignal,

      histogram:
        latest.macdHistogram
    };

    /*
     * Support / resistance
     */

    const recent20 =
      bars.slice(-20);

    const support =
      Math.min(
        ...recent20.map(
          x => x.low
        )
      );

    const resistance =
      Math.max(
        ...recent20.map(
          x => x.high
        )
      );

    /*
     * Analysis
     */

    const structure =
      structureAnalysis(bars);

    const trend =
      trendAnalysis(
        price,
        sma20,
        sma50
      );

    const candle =
      candleAnalysis(bars);

    const volume =
      volumeAnalysis(bars);

    const chartPatterns =
      detectChartPatterns(bars);

    const score =
      calculateScore({
        price,
        sma20,
        sma50,
        rsiValue,
        macdValue,
        structure,
        candle,
        volume
      });

    const decision =
      decisionEngine({
        price,
        support,
        resistance,
        sma20,
        rsiValue,
        macdValue,
        structure,
        candle,
        volume,
        score
      });

    /*
     * Reasons
     */

    const reasons = [];

    if (
      sma20 !== null &&
      price > sma20
    ) {
      reasons.push(
        "Price above SMA20"
      );
    }

    if (
      sma20 !== null &&
      sma50 !== null &&
      sma20 > sma50
    ) {
      reasons.push(
        "SMA20 above SMA50"
      );
    }

    if (
      structure.direction ===
      "BULLISH"
    ) {
      reasons.push(
        "Higher highs and higher lows"
      );
    }

    if (
      macdValue.macd !== null &&
      macdValue.signal !== null &&
      macdValue.macd >
      macdValue.signal
    ) {
      reasons.push(
        "MACD bullish"
      );
    }

    if (
      rsiValue !== null &&
      rsiValue >= 50
    ) {
      reasons.push(
        "RSI supports bullish momentum"
      );
    }

    if (
      candle.signal ===
      "BULLISH"
    ) {
      reasons.push(
        candle.pattern
      );
    }

    if (
      volume.confirmation
    ) {
      reasons.push(
        "Volume confirmation"
      );
    }

    /*
     * Risks
     */

    const risks = [];

    if (
      sma20 !== null &&
      price < sma20
    ) {
      risks.push(
        "Price below SMA20"
      );
    }

    if (
      sma20 !== null &&
      sma50 !== null &&
      sma20 < sma50
    ) {
      risks.push(
        "SMA20 below SMA50"
      );
    }

    if (
      structure.direction ===
      "BEARISH"
    ) {
      risks.push(
        "Bearish market structure"
      );
    }

    if (
      rsiValue !== null &&
      rsiValue > 75
    ) {
      risks.push(
        "RSI elevated"
      );
    }

    if (
      candle.signal ===
      "BEARISH"
    ) {
      risks.push(
        candle.pattern
      );
    }

    if (
      decision.riskRewardQuality ===
      "NOT ATTRACTIVE"
    ) {
      risks.push(
        "Risk/reward not attractive"
      );
    }

    /*
     * RESPONSE
     */

    return res.status(200).json({

      ticker,

      price:
        round(price),

      score,

      signal:
        decision.signal,

      signalReason:
        decision.signalReason,

      trend:
        trend.trend,

      trendScore:
        trend.score,

      trendConfidence:
        trend.confidence,

      shortTermTrend:
        price >
        (sma20 || price)
          ? "BULLISH"
          : price <
            (sma20 || price)
          ? "BEARISH"
          : "SIDEWAYS",

      structure:
        structure.structure,

      structureDirection:
        structure.direction,

      sma20:
        round(sma20),

      sma50:
        round(sma50),

      rsi14:
        round(rsiValue),

      macd:
        round(
          macdValue.macd,
          4
        ),

      macdSignal:
        round(
          macdValue.signal,
          4
        ),

      macdHistogram:
        round(
          macdValue.histogram,
          4
        ),

      support:
        round(support),

      resistance:
        round(resistance),

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
        round(
          volume.relativeVolume,
          2
        ),

      volumeConfirmation:
        volume.confirmation,

      chartPatterns,

      primaryChartPattern:
        chartPatterns.length
          ? chartPatterns[0]
          : null,

      setup:
        decision.setup,

      strategy:
        decision.strategy,

      buyTrigger:
        decision.buyTrigger,

      buyTriggerPrice:
        round(
          decision.buyTriggerPrice
        ),

      triggerConfirmed:
        decision.triggerConfirmed,

      breakoutTrigger:
        round(
          decision.breakoutTrigger
        ),

      breakoutConfirmed:
        decision.breakoutConfirmed,

      pullbackConfirmed:
        decision.pullbackConfirmed,

      pullbackZoneLow:
        round(
          decision.pullbackZoneLow
        ),

      pullbackZoneHigh:
        round(
          decision.pullbackZoneHigh
        ),

      pullbackEntry:
        round(
          decision.pullbackEntry
        ),

      invalidation:
        round(
          decision.invalidation
        ),

      invalidationReason:
        decision.invalidationReason,

      riskPerShare:
        round(
          decision.riskPerShare
        ),

      target1:
        round(
          decision.target1
        ),

      target2:
        round(
          decision.target2
        ),

      riskRewardTarget1:
        round(
          decision.riskRewardTarget1,
          2
        ),

      riskRewardTarget2:
        round(
          decision.riskRewardTarget2,
          2
        ),

      riskRewardQuality:
        decision.riskRewardQuality,

      conditions:
        decision.conditions,

      conditionsMet:
        decision.conditionsMet,

      conditionsTotal:
        decision.conditionsTotal,

      reasons,

      risks,

      history:
        bars
          .slice(-100)
          .map(x => ({
            date:
              x.date,

            open:
              round(x.open),

            high:
              round(x.high),

            low:
              round(x.low),

            close:
              round(x.close),

            volume:
              x.volume,

            sma20:
              round(x.sma20),

            sma50:
              round(x.sma50),

            rsi:
              round(x.rsi14),

            macd:
              round(
                x.macd,
                4
              ),

            macdSignal:
              round(
                x.macdSignal,
                4
              ),

            macdHistogram:
              round(
                x.macdHistogram,
                4
              )
          }))
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        "Server error",
      details:
        error.message
    });
  }
};
