const https = require("https");

/* =========================================================
   HELPERS
========================================================= */

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
          } catch (error) {
            reject(new Error("Invalid API response"));
          }
        });
      })
      .on("error", reject);
  });
}

function round(value, decimals = 2) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  return Number(Number(value).toFixed(decimals));
}

/* =========================================================
   MOVING AVERAGES
========================================================= */

function sma(values, period) {
  if (values.length < period) {
    return null;
  }

  const slice = values.slice(-period);

  return (
    slice.reduce((sum, value) => sum + value, 0) /
    period
  );
}

function ema(values, period) {
  if (values.length < period) {
    return null;
  }

  const multiplier = 2 / (period + 1);

  let result =
    values
      .slice(0, period)
      .reduce((sum, value) => sum + value, 0) /
    period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier +
      result;
  }

  return result;
}

/* =========================================================
   RSI
========================================================= */

function calculateRSI(values, period = 14) {
  if (values.length < period + 1) {
    return null;
  }

  let gains = 0;
  let losses = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {
    const change =
      values[i] - values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs = gains / losses;

  return 100 - 100 / (1 + rs);
}

/* =========================================================
   MACD
========================================================= */

function calculateMACD(values) {
  if (values.length < 35) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);

  if (
    ema12 === null ||
    ema26 === null
  ) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const currentMACD =
    ema12 - ema26;

  const macdSeries = [];

  for (
    let i = 26;
    i <= values.length;
    i++
  ) {
    const slice =
      values.slice(0, i);

    const e12 =
      ema(slice, 12);

    const e26 =
      ema(slice, 26);

    if (
      e12 !== null &&
      e26 !== null
    ) {
      macdSeries.push(
        e12 - e26
      );
    }
  }

  const signal =
    ema(macdSeries, 9);

  return {
    macd: currentMACD,
    signal,
    histogram:
      signal === null
        ? null
        : currentMACD - signal
  };
}

/* =========================================================
   PIVOTS
========================================================= */

function findPivotHighs(
  bars,
  distance = 3
) {
  const result = [];

  for (
    let i = distance;
    i < bars.length - distance;
    i++
  ) {
    let valid = true;

    for (
      let j = 1;
      j <= distance;
      j++
    ) {
      if (
        bars[i].high <=
          bars[i - j].high ||
        bars[i].high <=
          bars[i + j].high
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      result.push(i);
    }
  }

  return result;
}

function findPivotLows(
  bars,
  distance = 3
) {
  const result = [];

  for (
    let i = distance;
    i < bars.length - distance;
    i++
  ) {
    let valid = true;

    for (
      let j = 1;
      j <= distance;
      j++
    ) {
      if (
        bars[i].low >=
          bars[i - j].low ||
        bars[i].low >=
          bars[i + j].low
      ) {
        valid = false;
        break;
      }
    }

    if (valid) {
      result.push(i);
    }
  }

  return result;
}

/* =========================================================
   CANDLE ANALYSIS
========================================================= */

function candleAnalysis(bars) {
  if (bars.length < 3) {
    return {
      pattern: "NONE",
      signal: "NEUTRAL",
      strength: "LOW",
      description:
        "Insufficient candle data."
    };
  }

  const previous =
    bars[bars.length - 2];

  const current =
    bars[bars.length - 1];

  const body =
    Math.abs(
      current.close -
      current.open
    );

  const range =
    current.high -
    current.low;

  const upperWick =
    current.high -
    Math.max(
      current.open,
      current.close
    );

  const lowerWick =
    Math.min(
      current.open,
      current.close
    ) -
    current.low;

  /* BULLISH ENGULFING */

  if (
    previous.close <
      previous.open &&
    current.close >
      current.open &&
    current.open <=
      previous.close &&
    current.close >=
      previous.open
  ) {
    return {
      pattern:
        "BULLISH ENGULFING",
      signal: "BULLISH",
      strength: "HIGH",
      description:
        "Strong bullish reversal candle."
    };
  }

  /* BEARISH ENGULFING */

  if (
    previous.close >
      previous.open &&
    current.close <
      current.open &&
    current.open >=
      previous.close &&
    current.close <=
      previous.open
  ) {
    return {
      pattern:
        "BEARISH ENGULFING",
      signal: "BEARISH",
      strength: "HIGH",
      description:
        "Strong bearish reversal candle."
    };
  }

  /* HAMMER */

  if (
    lowerWick >
      body * 2 &&
    upperWick <
      body
  ) {
    return {
      pattern: "HAMMER",
      signal: "BULLISH",
      strength: "MEDIUM",
      description:
        "Lower-price rejection suggests buying interest."
    };
  }

  /* SHOOTING STAR */

  if (
    upperWick >
      body * 2 &&
    lowerWick <
      body
  ) {
    return {
      pattern:
        "SHOOTING STAR",
      signal: "BEARISH",
      strength: "MEDIUM",
      description:
        "Higher-price rejection suggests selling pressure."
    };
  }

  /* DOJI */

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

  /* STRONG BULLISH */

  if (
    range > 0 &&
    body / range > 0.75 &&
    current.close >
      current.open
  ) {
    return {
      pattern:
        "STRONG BULLISH CANDLE",
      signal: "BULLISH",
      strength: "MEDIUM",
      description:
        "Strong bullish price expansion."
    };
  }

  /* STRONG BEARISH */

  if (
    range > 0 &&
    body / range > 0.75 &&
    current.close <
      current.open
  ) {
    return {
      pattern:
        "STRONG BEARISH CANDLE",
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

  const highs =
    findPivotHighs(bars);

  const lows =
    findPivotLows(bars);

  const price =
    bars[bars.length - 1].close;

  /* =======================================================
     DOUBLE BOTTOM
  ======================================================= */

  if (lows.length >= 2) {
    const first =
      lows[lows.length - 2];

    const second =
      lows[lows.length - 1];

    if (
      second - first >= 8 &&
      second - first <= 60
    ) {
      const low1 =
        bars[first].low;

      const low2 =
        bars[second].low;

      const similarity =
        Math.abs(low1 - low2) /
        ((low1 + low2) / 2);

      if (similarity <= 0.06) {
        let neckline =
          -Infinity;

        for (
          let i = first;
          i <= second;
          i++
        ) {
          neckline =
            Math.max(
              neckline,
              bars[i].high
            );
        }

        patterns.push({
          name:
            "DOUBLE BOTTOM",

          type:
            "BULLISH",

          confidence:
            Math.round(
              85 -
              similarity * 100
            ),

          status:
            price > neckline
              ? "CONFIRMED"
              : "FORMING",

          trigger:
            round(neckline),

          target:
            round(
              neckline +
              (
                neckline -
                Math.min(
                  low1,
                  low2
                )
              )
            ),

          description:
            "Two similar lows followed by a recovery. Breakout above the neckline confirms the pattern."
        });
      }
    }
  }

  /* =======================================================
     DOUBLE TOP
  ======================================================= */

  if (highs.length >= 2) {
    const first =
      highs[highs.length - 2];

    const second =
      highs[highs.length - 1];

    if (
      second - first >= 8 &&
      second - first <= 60
    ) {
      const high1 =
        bars[first].high;

      const high2 =
        bars[second].high;

      const similarity =
        Math.abs(
          high1 - high2
        ) /
        ((high1 + high2) / 2);

      if (similarity <= 0.06) {
        let neckline =
          Infinity;

        for (
          let i = first;
          i <= second;
          i++
        ) {
          neckline =
            Math.min(
              neckline,
              bars[i].low
            );
        }

        patterns.push({
          name:
            "DOUBLE TOP",

          type:
            "BEARISH",

          confidence:
            Math.round(
              85 -
              similarity * 100
            ),

          status:
            price < neckline
              ? "CONFIRMED"
              : "FORMING",

          trigger:
            round(neckline),

          target:
            round(
              neckline -
              (
                Math.max(
                  high1,
                  high2
                ) -
                neckline
              )
            ),

          description:
            "Two similar highs. A break below the neckline confirms the bearish formation."
        });
      }
    }
  }

  /* =======================================================
     ASCENDING TRIANGLE
  ======================================================= */

  if (
    highs.length >= 3 &&
    lows.length >= 3
  ) {
    const recentHighs =
      highs.slice(-3);

    const recentLows =
      lows.slice(-3);

    const highValues =
      recentHighs.map(
        i => bars[i].high
      );

    const lowValues =
      recentLows.map(
        i => bars[i].low
      );

    const highRange =
      (
        Math.max(
          ...highValues
        ) -
        Math.min(
          ...highValues
        )
      ) /
      Math.max(
        ...highValues
      );

    const risingLows =
      lowValues[2] >
      lowValues[0];

    if (
      highRange < 0.04 &&
      risingLows
    ) {
      const trigger =
        Math.max(
          ...highValues
        );

      patterns.push({
        name:
          "ASCENDING TRIANGLE",

        type:
          "BULLISH",

        confidence:
          76,

        status:
          price > trigger
            ? "CONFIRMED"
            : "FORMING",

        trigger:
          round(trigger),

        target:
          round(
            trigger +
            (
              trigger -
              Math.min(
                ...lowValues
              )
            )
          ),

        description:
          "Flat resistance with rising lows. Bullish bias if resistance breaks."
      });
    }
  }

  /* =======================================================
     DESCENDING TRIANGLE
  ======================================================= */

  if (
    highs.length >= 3 &&
    lows.length >= 3
  ) {
    const recentHighs =
      highs.slice(-3);

    const recentLows =
      lows.slice(-3);

    const highValues =
      recentHighs.map(
        i => bars[i].high
      );

    const lowValues =
      recentLows.map(
        i => bars[i].low
      );

    const lowRange =
      (
        Math.max(
          ...lowValues
        ) -
        Math.min(
          ...lowValues
        )
      ) /
      Math.max(
        ...lowValues
      );

    const fallingHighs =
      highValues[2] <
      highValues[0];

    if (
      lowRange < 0.04 &&
      fallingHighs
    ) {
      const trigger =
        Math.min(
          ...lowValues
        );

      patterns.push({
        name:
          "DESCENDING TRIANGLE",

        type:
          "BEARISH",

        confidence:
          76,

        status:
          price < trigger
            ? "CONFIRMED"
            : "FORMING",

        trigger:
          round(trigger),

        target:
          round(
            trigger -
            (
              Math.max(
                ...highValues
              ) -
              trigger
            )
          ),

        description:
          "Flat support with falling highs. Bearish bias if support breaks."
      });
    }
  }

  /* =======================================================
     CUP & HANDLE
  ======================================================= */

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
            .map(
              x => x.high
            )
        );

      const rightHigh =
        Math.max(
          ...window
            .slice(bottom + 1)
            .map(
              x => x.high
            )
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
            .map(
              x => x.low
            )
        );

      const handleDepth =
        (rim - handleLow) /
        rim;

      const rimDifference =
        Math.abs(
          leftHigh -
          rightHigh
        ) /
        (
          (leftHigh +
            rightHigh) /
          2
        );

      if (
        rimDifference < 0.12 &&
        handleDepth > 0.005 &&
        handleDepth < 0.18
      ) {
        patterns.push({
          name:
            "CUP & HANDLE",

          type:
            "BULLISH",

          confidence:
            70,

          status:
            price > rim
              ? "CONFIRMED"
              : "FORMING",

          trigger:
            round(rim),

          target:
            round(
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
   MARKET STRUCTURE
========================================================= */

function analyzeStructure(bars) {
  const highs =
    findPivotHighs(bars);

  const lows =
    findPivotLows(bars);

  if (
    highs.length < 2 ||
    lows.length < 2
  ) {
    return {
      structure:
        "UNDEFINED",

      direction:
        "NEUTRAL"
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
    latestHigh >
      previousHigh &&
    latestLow >
      previousLow
  ) {
    return {
      structure:
        "HIGHER HIGH + HIGHER LOW",

      direction:
        "BULLISH"
    };
  }

  if (
    latestHigh <
      previousHigh &&
    latestLow <
      previousLow
  ) {
    return {
      structure:
        "LOWER HIGH + LOWER LOW",

      direction:
        "BEARISH"
    };
  }

  return {
    structure:
      "MIXED / SIDEWAYS",

    direction:
      "NEUTRAL"
  };
}

/* =========================================================
   TREND
========================================================= */

function analyzeTrend(
  price,
  sma20,
  sma50
) {
  if (
    sma20 === null ||
    sma50 === null
  ) {
    return {
      trend:
        "SIDEWAYS",

      score:
        50,

      confidence:
        50
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
          ) *
          250
        )
      );

    return {
      trend:
        "BULLISH",

      score:
        confidence,

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
          ) *
          250
        )
      );

    return {
      trend:
        "BEARISH",

      score:
        100 - confidence,

      confidence
    };
  }

  return {
    trend:
      "SIDEWAYS",

    score:
      50,

    confidence:
      60
  };
}

/* =========================================================
   VOLUME
========================================================= */

function analyzeVolume(bars) {
  if (bars.length < 21) {
    return {
      relativeVolume:
        null,

      confirmation:
        false
    };
  }

  const current =
    bars[
      bars.length - 1
    ].volume;

  const average =
    bars
      .slice(-21, -1)
      .reduce(
        (sum, bar) =>
          sum + bar.volume,
        0
      ) / 20;

  const relativeVolume =
    current / average;

  return {
    relativeVolume,

    confirmation:
      relativeVolume >=
      1.15
  };
}

/* =========================================================
   SCORE
========================================================= */

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

  if (rsi !== null) {
    if (
      rsi >= 52 &&
      rsi <= 70
    ) {
      score += 8;
    } else if (
      rsi > 70
    ) {
      score += 2;
    } else if (
      rsi < 40
    ) {
      score -= 8;
    }
  }

  if (
    macd.macd !== null &&
    macd.signal !== null
  ) {
    score +=
      macd.macd >
      macd.signal
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
  rsi,
  macd,
  structure,
  candle,
  volume,
  score
}) {

  /*
   * BREAKOUT
   */

  const breakoutTrigger =
    resistance * 1.002;

  /*
   * PULLBACK
   */

  const pullbackZoneLow =
    support;

  const pullbackZoneHigh =
    Math.max(
      support,
      sma20 || support
    );

  const pullbackEntry =
    (
      pullbackZoneLow +
      pullbackZoneHigh
    ) / 2;

  /*
   * INVALIDATION
   */

  const invalidation =
    support;

  /*
   * TARGETS
   */

  const range =
    Math.max(
      resistance - support,
      price * 0.05
    );

  const target1 =
    resistance +
    range * 0.5;

  const target2 =
    resistance +
    range;

  /*
   * BREAKOUT R/R
   */

  const breakoutRisk =
    Math.max(
      0.01,
      breakoutTrigger -
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

  /*
   * PULLBACK R/R
   */

  const pullbackRisk =
    Math.max(
      0.01,
      pullbackEntry -
      invalidation
    );

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
   * BULLISH CONDITIONS
   */

  const bullishStructure =
    structure.direction ===
    "BULLISH";

  const bullishMACD =
    macd.macd !== null &&
    macd.signal !== null &&
    macd.macd >
      macd.signal;

  const healthyRSI =
    rsi !== null &&
    rsi >= 50 &&
    rsi < 75;

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
      name:
        "Bullish structure",

      met:
        bullishStructure
    },

    {
      name:
        "Bullish momentum",

      met:
        bullishMACD
    },

    {
      name:
        "RSI healthy",

      met:
        healthyRSI
    },

    {
      name:
        "Price above SMA20",

      met:
        aboveSMA20
    },

    {
      name:
        "Bullish candle",

      met:
        bullishCandle
    },

    {
      name:
        "Volume confirmation",

      met:
        volumeConfirmation
    }
  ];

  const conditionsMet =
    conditions.filter(
      condition =>
        condition.met
    ).length;

  /*
   * SETUP
   *
   * Important:
   * setup is NOT the same as trigger.
   */

  let setup =
    "NEUTRAL";

  if (
    score >= 68 &&
    (
      bullishStructure ||
      bullishMACD
    )
  ) {
    setup =
      "BULLISH";
  }

  if (
    score <= 35 &&
    structure.direction ===
      "BEARISH"
  ) {
    setup =
      "BEARISH";
  }

  /*
   * PULLBACK
   */

  const inPullbackZone =
    price >=
      pullbackZoneLow &&
    price <=
      pullbackZoneHigh *
        1.02;

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
   * BREAKOUT
   */

  const breakoutConfirmed =
    price >=
      breakoutTrigger &&
    bullishStructure &&
    bullishMACD &&
    healthyRSI;

  /*
   * SIGNAL
   */

  let signal =
    "WATCH";

  let signalReason =
    "No sufficiently strong directional setup.";

  let strategy =
    "WAIT";

  /*
   * STRONG BUY
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
    signal =
      "STRONG BUY";

    signalReason =
      "Strong bullish setup with breakout, momentum and acceptable risk/reward.";

    strategy =
      "BREAKOUT";
  }

  /*
   * BUY — PULLBACK
   */

  else if (
    setup === "BULLISH" &&
    pullbackConfirmed &&
    pullbackRR1 >= 1.8 &&
    score >= 60
  ) {
    signal =
      "BUY";

    signalReason =
      "Bullish setup has reached an attractive pullback zone with supportive momentum and risk/reward.";

    strategy =
      "PULLBACK";
  }

  /*
   * BUY — QUALITY SETUP
   *
   * This is the important change.
   *
   * Breakout is NOT mandatory.
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
    signal =
      "BUY";

    signalReason =
      "Bullish setup with attractive risk/reward. Use the preferred pullback or breakout strategy for execution.";

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
    signal =
      "WATCH";

    signalReason =
      `Bullish setup developing. Monitor ${
        pullbackRR1 >= 2
          ? "the pullback zone"
          : "the breakout level"
      } for a better entry.`;

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
    signal =
      "SELL";

    signalReason =
      "Bearish structure and weak technical conditions.";

    strategy =
      "WAIT";
  }

  /*
   * R/R QUALITY
   */

  const activeRR =
    strategy ===
      "PULLBACK"
      ? pullbackRR1
      : breakoutRR1;

  let riskRewardQuality =
    "NOT ATTRACTIVE";

  if (
    activeRR >= 2
  ) {
    riskRewardQuality =
      "ATTRACTIVE";
  } else if (
    activeRR >= 1.5
  ) {
    riskRewardQuality =
      "ACCEPTABLE";
  }

  /*
   * ACTIVE ENTRY
   */

  const activeEntry =
    strategy ===
      "PULLBACK"
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
      strategy ===
        "PULLBACK"
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

    pullbackZoneLow,

    pullbackZoneHigh,

    pullbackEntry,

    invalidation,

    invalidationReason:
      "Setup is invalidated if price closes below key structural support.",

    riskPerShare:
      activeRisk,

    target1,

    target2,

    riskRewardTarget1:
      activeRR,

    riskRewardTarget2:
      strategy ===
        "PULLBACK"
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

module.exports =
  async function handler(
    req,
    res
  ) {

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
          error:
            "Missing ticker"
        });
      }

      const apiKey =
        process.env
          .ALPHA_VANTAGE_API_KEY;

      if (!apiKey) {
        return res.status(500).json({
          error:
            "Missing Alpha Vantage API key"
        });
      }

      /*
       * ALPHA VANTAGE
       */

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

      /*
       * IMPORTANT:
       * Alpha Vantage may return
       * Note OR Information when
       * the API limit is reached.
       */

      if (data.Note) {

        return res.status(429).json({

          error:
            "Alpha Vantage API limit reached",

          details:
            data.Note
        });
      }

      if (data.Information) {

        return res.status(429).json({

          error:
            "Alpha Vantage API limit reached",

          details:
            data.Information
        });
      }

      if (
        data["Error Message"]
      ) {

        return res.status(400).json({

          error:
            "Invalid ticker",

          details:
            data["Error Message"]
        });
      }

      /*
       * DAILY SERIES
       */

      const series =
        data[
          "Time Series (Daily)"
        ];

      if (!series) {

        return res.status(500).json({

          error:
            "No daily market data returned.",

          details:
            JSON.stringify(data)
        });
      }

      /*
       * BUILD BARS
       */

      const dates =
        Object.keys(series)
          .sort();

      const bars =
        dates
          .map(
            date => ({

              date,

              open:
                Number(
                  series[date][
                    "1. open"
                  ]
                ),

              high:
                Number(
                  series[date][
                    "2. high"
                  ]
                ),

              low:
                Number(
                  series[date][
                    "3. low"
                  ]
                ),

              close:
                Number(
                  series[date][
                    "4. close"
                  ]
                ),

              volume:
                Number(
                  series[date][
                    "5. volume"
                  ]
                )
            })
          )
          .filter(
            bar =>
              Number.isFinite(
                bar.close
              )
          );

      if (bars.length < 30) {

        return res.status(500).json({

          error:
            "Not enough historical market data.",

          details:
            `Only ${bars.length} daily bars returned.`
        });
      }

      /*
       * INDICATORS
       */

      const closes =
        bars.map(
          bar => bar.close
        );

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
          sma(
            history,
            20
          );

        bars[i].sma50 =
          sma(
            history,
            50
          );

        bars[i].rsi14 =
          calculateRSI(
            history,
            14
          );

        const m =
          calculateMACD(
            history
          );

        bars[i].macd =
          m.macd;

        bars[i].macdSignal =
          m.signal;

        bars[i].macdHistogram =
          m.histogram;
      }

      /*
       * CURRENT DATA
       */

      const latest =
        bars[
          bars.length - 1
        ];

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
       * SUPPORT / RESISTANCE
       */

      const recent20 =
        bars.slice(-20);

      const support =
        Math.min(
          ...recent20.map(
            bar => bar.low
          )
        );

      const resistance =
        Math.max(
          ...recent20.map(
            bar => bar.high
          )
        );

      /*
       * ANALYSIS
       */

      const structure =
        analyzeStructure(
          bars
        );

      const trend =
        analyzeTrend(
          price,
          sma20,
          sma50
        );

      const candle =
        candleAnalysis(
          bars
        );

      const volume =
        analyzeVolume(
          bars
        );

      const chartPatterns =
        detectChartPatterns(
          bars
        );

      /*
       * SCORE
       */

      const score =
        calculateScore({

          price,

          sma20,

          sma50,

          rsi:
            rsiValue,

          macd:
            macdValue,

          structure,

          candle,

          volume
        });

      /*
       * DECISION
       */

      const decision =
        decisionEngine({

          price,

          support,

          resistance,

          sma20,

          rsi:
            rsiValue,

          macd:
            macdValue,

          structure,

          candle,

          volume,

          score
        });

      /*
       * REASONS
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
       * RISKS
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
            .map(
              bar => ({

                date:
                  bar.date,

                open:
                  round(
                    bar.open
                  ),

                high:
                  round(
                    bar.high
                  ),

                low:
                  round(
                    bar.low
                  ),

                close:
                  round(
                    bar.close
                  ),

                volume:
                  bar.volume,

                sma20:
                  round(
                    bar.sma20
                  ),

                sma50:
                  round(
                    bar.sma50
                  ),

                rsi:
                  round(
                    bar.rsi14
                  ),

                macd:
                  round(
                    bar.macd,
                    4
                  ),

                macdSignal:
                  round(
                    bar.macdSignal,
                    4
                  ),

                macdHistogram:
                  round(
                    bar.macdHistogram,
                    4
                  )
              })
            )
      });

    } catch (error) {

      console.error(
        "Investment Cockpit error:",
        error
      );

      return res.status(500).json({

        error:
          "Server error",

        details:
          error.message
      });
    }
  };
