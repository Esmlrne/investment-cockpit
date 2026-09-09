const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

function response(body, status = 200) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600"
    },
    body: JSON.stringify(body)
  };
}

function round(v, d = 2) {
  if (!Number.isFinite(v)) return null;
  return Number(v.toFixed(d));
}

function avg(arr) {
  const x = arr.filter(Number.isFinite);
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
}

function std(arr) {
  const x = arr.filter(Number.isFinite);
  if (x.length < 2) return null;
  const m = avg(x);
  return Math.sqrt(
    x.reduce((s, v) => s + Math.pow(v - m, 2), 0) / x.length
  );
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/* ============================================================
   INDICATORS
   ============================================================ */

function sma(values, period) {
  const out = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let valid = true;

    for (let j = i - period + 1; j <= i; j++) {
      if (!Number.isFinite(values[j])) {
        valid = false;
        break;
      }
      sum += values[j];
    }

    if (valid) out[i] = sum / period;
  }

  return out;
}

function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);

  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];

    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  out[period] =
    avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {

    const diff = values[i] - values[i - 1];

    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? Math.abs(diff) : 0;

    avgGain =
      (avgGain * (period - 1) + currentGain) / period;

    avgLoss =
      (avgLoss * (period - 1) + currentLoss) / period;

    out[i] =
      avgLoss === 0
        ? 100
        : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function ema(values, period) {

  const out = new Array(values.length).fill(null);

  if (values.length < period) return out;

  const start = period - 1;

  let initial = 0;

  for (let i = 0; i < period; i++) {
    initial += values[i];
  }

  initial /= period;

  out[start] = initial;

  const multiplier = 2 / (period + 1);

  for (let i = start + 1; i < values.length; i++) {

    out[i] =
      (values[i] - out[i - 1]) * multiplier +
      out[i - 1];

  }

  return out;
}

function calculateMACD(values) {

  const e12 = ema(values, 12);
  const e26 = ema(values, 26);

  const macd = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {

    if (
      Number.isFinite(e12[i]) &&
      Number.isFinite(e26[i])
    ) {
      macd[i] = e12[i] - e26[i];
    }

  }

  const valid = macd
    .map((v, i) => ({ v, i }))
    .filter(x => Number.isFinite(x.v));

  const signalValues = valid.map(x => x.v);
  const signal = ema(signalValues, 9);

  const macdSignal = new Array(values.length).fill(null);
  const histogram = new Array(values.length).fill(null);

  valid.forEach((x, k) => {

    if (Number.isFinite(signal[k])) {
      macdSignal[x.i] = signal[k];
      histogram[x.i] =
        macd[x.i] - signal[k];
    }

  });

  return {
    macd,
    signal: macdSignal,
    histogram
  };
}

/* ============================================================
   PIVOTS
   ============================================================ */

function pivotHighs(bars, strength = 2) {

  const pivots = [];

  for (
    let i = strength;
    i < bars.length - strength;
    i++
  ) {

    let isPivot = true;

    for (let j = 1; j <= strength; j++) {

      if (
        bars[i].high <= bars[i - j].high ||
        bars[i].high < bars[i + j].high
      ) {
        isPivot = false;
        break;
      }

    }

    if (isPivot) {

      pivots.push({
        index: i,
        value: bars[i].high
      });

    }

  }

  return pivots;
}

function pivotLows(bars, strength = 2) {

  const pivots = [];

  for (
    let i = strength;
    i < bars.length - strength;
    i++
  ) {

    let isPivot = true;

    for (let j = 1; j <= strength; j++) {

      if (
        bars[i].low >= bars[i - j].low ||
        bars[i].low > bars[i + j].low
      ) {
        isPivot = false;
        break;
      }

    }

    if (isPivot) {

      pivots.push({
        index: i,
        value: bars[i].low
      });

    }

  }

  return pivots;
}

/* ============================================================
   CANDLESTICKS
   ============================================================ */

function candleAnalysis(bars) {

  const n = bars.length;

  if (n < 5) {
    return {
      pattern: "NONE",
      signal: "NEUTRAL",
      strength: "WEAK",
      context: "INSUFFICIENT DATA",
      description: "Not enough candles for pattern analysis."
    };
  }

  const a = bars[n - 1];
  const b = bars[n - 2];
  const c = bars[n - 3];

  const range = Math.max(a.high - a.low, 0.000001);

  const body = Math.abs(a.close - a.open);
  const upper = a.high - Math.max(a.open, a.close);
  const lower = Math.min(a.open, a.close) - a.low;

  const bodyPct = body / range;

  let pattern = "NONE";
  let signal = "NEUTRAL";
  let strength = "WEAK";
  let description = "No major candlestick pattern detected.";

  /* Bullish engulfing */

  const bullishEngulfing =
    b.close < b.open &&
    a.close > a.open &&
    a.open <= b.close &&
    a.close >= b.open;

  /* Bearish engulfing */

  const bearishEngulfing =
    b.close > b.open &&
    a.close < a.open &&
    a.open >= b.close &&
    a.close <= b.open;

  /* Hammer */

  const hammer =
    lower >= body * 2 &&
    upper <= body * 0.8 &&
    bodyPct < 0.45;

  /* Shooting star */

  const shootingStar =
    upper >= body * 2 &&
    lower <= body * 0.8 &&
    bodyPct < 0.45;

  /* Doji */

  const doji =
    bodyPct <= 0.10;

  /* Morning star */

  const morningStar =
    c.close < c.open &&
    Math.abs(b.close - b.open) <
      (c.open - c.close) * 0.45 &&
    a.close > a.open &&
    a.close >
      (c.open + c.close) / 2;

  /* Evening star */

  const eveningStar =
    c.close > c.open &&
    Math.abs(b.close - b.open) <
      (c.close - c.open) * 0.45 &&
    a.close < a.open &&
    a.close <
      (c.open + c.close) / 2;

  if (bullishEngulfing) {

    pattern = "BULLISH ENGULFING";
    signal = "BULLISH";
    strength = "STRONG";
    description =
      "Bullish engulfing suggests buyers have taken control of the latest session.";

  } else if (bearishEngulfing) {

    pattern = "BEARISH ENGULFING";
    signal = "BEARISH";
    strength = "STRONG";
    description =
      "Bearish engulfing suggests sellers have taken control of the latest session.";

  } else if (morningStar) {

    pattern = "MORNING STAR";
    signal = "BULLISH";
    strength = "STRONG";
    description =
      "Morning star can indicate a bullish reversal after weakness.";

  } else if (eveningStar) {

    pattern = "EVENING STAR";
    signal = "BEARISH";
    strength = "STRONG";
    description =
      "Evening star can indicate a bearish reversal after strength.";

  } else if (hammer) {

    pattern = "HAMMER";
    signal = "BULLISH";
    strength = "MEDIUM";
    description =
      "Hammer shows rejection of lower prices and can support a bullish reversal.";

  } else if (shootingStar) {

    pattern = "SHOOTING STAR";
    signal = "BEARISH";
    strength = "MEDIUM";
    description =
      "Shooting star shows rejection of higher prices and can warn of weakness.";

  } else if (doji) {

    pattern = "DOJI";
    signal = "NEUTRAL";
    strength = "WEAK";
    description =
      "Doji indicates indecision. Confirmation from subsequent candles is important.";

  } else if (a.close > a.open && bodyPct > 0.65) {

    pattern = "STRONG BULLISH CANDLE";
    signal = "BULLISH";
    strength = "MEDIUM";
    description =
      "Large bullish body indicates strong buying pressure.";

  } else if (a.close < a.open && bodyPct > 0.65) {

    pattern = "STRONG BEARISH CANDLE";
    signal = "BEARISH";
    strength = "MEDIUM";
    description =
      "Large bearish body indicates strong selling pressure.";

  }

  return {
    pattern,
    signal,
    strength,
    context: "LATEST SESSION",
    description
  };
}

/* ============================================================
   CHART FORMATION ENGINE
   ============================================================ */

function makePattern(
  name,
  type,
  confidence,
  status,
  trigger,
  target,
  description
) {

  return {
    name,
    type,
    confidence: Math.round(clamp(confidence, 50, 95)),
    status,
    trigger: round(trigger),
    target: round(target),
    description
  };
}

/* ---------- DOUBLE BOTTOM ---------- */

function detectDoubleBottom(
  bars,
  lows,
  highs,
  price
) {

  if (lows.length < 2) return null;

  const recentLows =
    lows.filter(x => x.index >= bars.length - 65);

  if (recentLows.length < 2) return null;

  const second =
    recentLows[recentLows.length - 1];

  const candidates =
    recentLows.slice(0, -1);

  let best = null;

  for (const first of candidates) {

    const distance =
      second.index - first.index;

    if (distance < 8 || distance > 55) continue;

    const similarity =
      Math.abs(second.value - first.value) /
      Math.max(first.value, second.value);

    if (similarity > 0.045) continue;

    const betweenHighs =
      highs.filter(
        h =>
          h.index > first.index &&
          h.index < second.index
      );

    if (!betweenHighs.length) continue;

    const neckline =
      Math.max(
        ...betweenHighs.map(x => x.value)
      );

    if (neckline <= second.value * 1.03) continue;

    const latest =
      bars[bars.length - 1].close;

    let status = "FORMING";

    if (latest > neckline) {
      status = "BREAKOUT CONFIRMED";
    } else if (
      latest >= neckline * 0.97
    ) {
      status = "APPROACHING BREAKOUT";
    } else {
      status = "FORMING";
    }

    const target =
      neckline +
      (neckline -
        Math.min(first.value, second.value));

    const confidence =
      68 +
      (1 - similarity / 0.045) * 12 +
      (distance >= 15 ? 5 : 0) +
      (latest >= neckline * 0.97 ? 5 : 0);

    best = makePattern(
      "DOUBLE BOTTOM",
      "REVERSAL",
      confidence,
      status,
      neckline,
      target,
      "Two similar lows with a neckline between them. A daily close above the neckline confirms the pattern."
    );
  }

  return best;
}

/* ---------- DOUBLE TOP ---------- */

function detectDoubleTop(
  bars,
  highs,
  lows
) {

  if (highs.length < 2) return null;

  const recentHighs =
    highs.filter(x => x.index >= bars.length - 65);

  if (recentHighs.length < 2) return null;

  const second =
    recentHighs[recentHighs.length - 1];

  for (
    let k = recentHighs.length - 2;
    k >= 0;
    k--
  ) {

    const first = recentHighs[k];

    const distance =
      second.index - first.index;

    if (distance < 8 || distance > 55) continue;

    const similarity =
      Math.abs(second.value - first.value) /
      Math.max(first.value, second.value);

    if (similarity > 0.045) continue;

    const betweenLows =
      lows.filter(
        l =>
          l.index > first.index &&
          l.index < second.index
      );

    if (!betweenLows.length) continue;

    const neckline =
      Math.min(
        ...betweenLows.map(x => x.value)
      );

    if (neckline >= first.value * 0.97) continue;

    const price =
      bars[bars.length - 1].close;

    let status = "FORMING";

    if (price < neckline) {
      status = "BREAKDOWN CONFIRMED";
    } else if (
      price <= neckline * 1.03
    ) {
      status = "APPROACHING BREAKDOWN";
    }

    const target =
      neckline -
      (Math.max(first.value, second.value) -
        neckline);

    const confidence =
      68 +
      (1 - similarity / 0.045) * 12 +
      (distance >= 15 ? 5 : 0) +
      (price <= neckline * 1.03 ? 5 : 0);

    return makePattern(
      "DOUBLE TOP",
      "REVERSAL",
      confidence,
      status,
      neckline,
      target,
      "Two similar highs with a neckline between them. A daily close below the neckline confirms the bearish pattern."
    );
  }

  return null;
}

/* ---------- HEAD & SHOULDERS ---------- */

function detectHeadShoulders(
  bars,
  highs,
  lows,
  inverse = false
) {

  const pivots = inverse ? lows : highs;

  if (pivots.length < 3) return null;

  const recent =
    pivots.filter(
      p => p.index >= bars.length - 80
    );

  if (recent.length < 3) return null;

  for (
    let i = 0;
    i < recent.length - 2;
    i++
  ) {

    const left = recent[i];
    const head = recent[i + 1];
    const right = recent[i + 2];

    if (
      head.index - left.index < 5 ||
      right.index - head.index < 5
    ) continue;

    const shoulderSimilarity =
      Math.abs(left.value - right.value) /
      Math.max(left.value, right.value);

    if (shoulderSimilarity > 0.08) continue;

    if (!inverse) {

      if (
        head.value <= left.value ||
        head.value <= right.value
      ) continue;

    } else {

      if (
        head.value >= left.value ||
        head.value >= right.value
      ) continue;

    }

    const between1 = inverse
      ? highs.filter(
          x =>
            x.index > left.index &&
            x.index < head.index
        )
      : lows.filter(
          x =>
            x.index > left.index &&
            x.index < head.index
        );

    const between2 = inverse
      ? highs.filter(
          x =>
            x.index > head.index &&
            x.index < right.index
        )
      : lows.filter(
          x =>
            x.index > head.index &&
            x.index < right.index
        );

    if (
      !between1.length ||
      !between2.length
    ) continue;

    const neckline = inverse
      ? (
          Math.max(...between1.map(x => x.value)) +
          Math.max(...between2.map(x => x.value))
        ) / 2
      : (
          Math.min(...between1.map(x => x.value)) +
          Math.min(...between2.map(x => x.value))
        ) / 2;

    const price =
      bars[bars.length - 1].close;

    let status = "FORMING";

    if (!inverse && price < neckline) {
      status = "BREAKDOWN CONFIRMED";
    }

    if (inverse && price > neckline) {
      status = "BREAKOUT CONFIRMED";
    }

    if (
      status === "FORMING" &&
      (
        (!inverse && price <= neckline * 1.04) ||
        (inverse && price >= neckline * 0.96)
      )
    ) {
      status = inverse
        ? "APPROACHING BREAKOUT"
        : "APPROACHING BREAKDOWN";
    }

    const height = Math.abs(
      head.value - neckline
    );

    const target = inverse
      ? neckline + height
      : neckline - height;

    const confidence =
      70 +
      (1 - shoulderSimilarity / 0.08) * 10 +
      (Math.abs(head.value - left.value) /
        Math.max(left.value, right.value) > 0.05
        ? 5
        : 0);

    return makePattern(
      inverse
        ? "INVERSE HEAD & SHOULDERS"
        : "HEAD & SHOULDERS",
      "REVERSAL",
      confidence,
      status,
      neckline,
      target,
      inverse
        ? "Potential bullish reversal with a head below two shoulders. Neckline breakout is the confirmation."
        : "Potential bearish reversal with a central head above two shoulders. Neckline breakdown is the confirmation."
    );
  }

  return null;
}

/* ---------- CUP & HANDLE ---------- */

function detectCupHandle(
  bars,
  highs,
  lows
) {

  if (bars.length < 45) return null;

  const start =
    Math.max(0, bars.length - 90);

  const window =
    bars.slice(start);

  if (window.length < 40) return null;

  const leftIndexLocal =
    window.reduce(
      (best, b, i) =>
        b.high > window[best].high ? i : best,
      0
    );

  const left =
    window[leftIndexLocal];

  const leftGlobal =
    start + leftIndexLocal;

  const troughIndexLocal =
    window.reduce(
      (best, b, i) =>
        i > leftIndexLocal &&
        b.low < window[best].low
          ? i
          : best,
      Math.min(
        leftIndexLocal + 1,
        window.length - 1
      )
    );

  if (
    troughIndexLocal <= leftIndexLocal + 5 ||
    troughIndexLocal >= window.length - 8
  ) {
    return null;
  }

  const trough =
    window[troughIndexLocal];

  const rightSlice =
    window.slice(troughIndexLocal + 1);

  if (rightSlice.length < 8) return null;

  const rightPeakLocal =
    rightSlice.reduce(
      (best, b, i) =>
        b.high > rightSlice[best].high
          ? i
          : best,
      0
    );

  const rightPeak =
    rightSlice[rightPeakLocal];

  const rightGlobal =
    start +
    troughIndexLocal +
    1 +
    rightPeakLocal;

  if (rightGlobal <= troughIndexLocal) return null;

  const rim =
    Math.min(left.high, rightPeak.high);

  const depth =
    (rim - trough.low) / rim;

  if (depth < 0.08 || depth > 0.45) return null;

  const rimSimilarity =
    Math.abs(left.high - rightPeak.high) /
    Math.max(left.high, rightPeak.high);

  if (rimSimilarity > 0.12) return null;

  const handleStart =
    rightGlobal + 1;

  if (handleStart >= bars.length) return null;

  const handleBars =
    bars.slice(handleStart);

  const handleLow =
    Math.min(
      ...handleBars.map(x => x.low)
    );

  const handlePullback =
    (rightPeak.high - handleLow) /
    rightPeak.high;

  if (
    handlePullback > 0.18 ||
    handlePullback < 0.005
  ) {
    return null;
  }

  const price =
    bars[bars.length - 1].close;

  let status = "FORMING";

  if (price > rim) {
    status = "BREAKOUT CONFIRMED";
  } else if (
    price >= rim * 0.97
  ) {
    status = "APPROACHING BREAKOUT";
  } else {
    status = "HANDLE / WAIT";
  }

  const target =
    rim + depth * rim;

  const confidence =
    70 +
    (1 - rimSimilarity / 0.12) * 8 +
    (handlePullback < 0.12 ? 7 : 0) +
    (price >= rim * 0.97 ? 5 : 0);

  return makePattern(
    "CUP & HANDLE",
    "CONTINUATION",
    confidence,
    status,
    rim,
    target,
    "Rounded recovery toward the prior high followed by a controlled handle. A close above the rim confirms the bullish formation."
  );
}

/* ---------- FLAGS ---------- */

function detectFlag(
  bars,
  bullish = true
) {

  if (bars.length < 35) return null;

  const impulseStart =
    Math.max(0, bars.length - 35);

  const impulseEnd =
    Math.max(5, bars.length - 15);

  const before =
    bars.slice(
      impulseStart,
      impulseEnd
    );

  const flag =
    bars.slice(impulseEnd);

  if (
    before.length < 8 ||
    flag.length < 6
  ) {
    return null;
  }

  const impulseStartPrice =
    before[0].close;

  const impulseEndPrice =
    before[before.length - 1].close;

  const impulseReturn =
    (impulseEndPrice -
      impulseStartPrice) /
    impulseStartPrice;

  if (
    bullish &&
    impulseReturn < 0.08
  ) return null;

  if (
    !bullish &&
    impulseReturn > -0.08
  ) return null;

  const flagStart =
    flag[0].close;

  const flagEnd =
    flag[flag.length - 1].close;

  const flagReturn =
    (flagEnd - flagStart) /
    flagStart;

  if (
    bullish &&
    (
      flagReturn > 0.06 ||
      flagReturn < -0.18
    )
  ) return null;

  if (
    !bullish &&
    (
      flagReturn < -0.06 ||
      flagReturn > 0.18
    )
  ) return null;

  const resistance =
    Math.max(
      ...flag.map(x => x.high)
    );

  const support =
    Math.min(
      ...flag.map(x => x.low)
    );

  const price =
    bars[bars.length - 1].close;

  const trigger =
    bullish
      ? resistance
      : support;

  let status;

  if (bullish) {

    status =
      price > trigger
        ? "BREAKOUT CONFIRMED"
        : "WAIT FOR BREAKOUT";

  } else {

    status =
      price < trigger
        ? "BREAKDOWN CONFIRMED"
        : "WAIT FOR BREAKDOWN";

  }

  const target =
    bullish
      ? trigger + Math.abs(
          impulseEndPrice -
          impulseStartPrice
        )
      : trigger - Math.abs(
          impulseEndPrice -
          impulseStartPrice
        );

  return makePattern(
    bullish ? "BULL FLAG" : "BEAR FLAG",
    "CONTINUATION",
    70 + (Math.abs(flagReturn) < 0.08 ? 8 : 3),
    status,
    trigger,
    target,
    bullish
      ? "Strong upward impulse followed by controlled consolidation. Breakout above the flag confirms continuation."
      : "Strong downward impulse followed by controlled consolidation. Breakdown below the flag confirms continuation."
  );
}

/* ---------- TRIANGLES ---------- */

function detectTriangles(
  bars,
  highs,
  lows
) {

  const recentHighs =
    highs.filter(
      x => x.index >= bars.length - 50
    );

  const recentLows =
    lows.filter(
      x => x.index >= bars.length - 50
    );

  if (
    recentHighs.length < 3 ||
    recentLows.length < 3
  ) {
    return [];
  }

  const h1 =
    recentHighs[0];

  const h2 =
    recentHighs[recentHighs.length - 1];

  const l1 =
    recentLows[0];

  const l2 =
    recentLows[recentLows.length - 1];

  const highSlope =
    (h2.value - h1.value) /
    Math.max(1, h2.index - h1.index);

  const lowSlope =
    (l2.value - l1.value) /
    Math.max(1, l2.index - l1.index);

  const price =
    bars[bars.length - 1].close;

  const results = [];

  const averagePrice =
    price;

  /*
    Normalize slopes so they can be compared
    across different stock prices.
  */

  const hs =
    highSlope / averagePrice;

  const ls =
    lowSlope / averagePrice;

  /* Ascending triangle */

  if (
    Math.abs(hs) < 0.0008 &&
    ls > 0.0008
  ) {

    const trigger =
      Math.max(
        ...recentHighs.map(x => x.value)
      );

    results.push(
      makePattern(
        "ASCENDING TRIANGLE",
        "BREAKOUT",
        74,
        price > trigger
          ? "BREAKOUT CONFIRMED"
          : "WAIT FOR BREAKOUT",
        trigger,
        trigger +
          (trigger -
            Math.min(
              ...recentLows.map(x => x.value)
            )),
        "Flat resistance combined with rising lows suggests buyers are becoming more aggressive."
      )
    );

  }

  /* Descending triangle */

  if (
    Math.abs(ls) < 0.0008 &&
    hs < -0.0008
  ) {

    const trigger =
      Math.min(
        ...recentLows.map(x => x.value)
      );

    results.push(
      makePattern(
        "DESCENDING TRIANGLE",
        "BREAKDOWN",
        74,
        price < trigger
          ? "BREAKDOWN CONFIRMED"
          : "WAIT FOR BREAKDOWN",
        trigger,
        trigger -
          (
            Math.max(
              ...recentHighs.map(x => x.value)
            ) -
            trigger
          ),
        "Flat support combined with falling highs suggests increasing selling pressure."
      )
    );

  }

  /* Symmetrical triangle */

  if (
    hs < -0.0005 &&
    ls > 0.0005
  ) {

    const upper =
      Math.max(
        ...recentHighs.map(x => x.value)
      );

    const lower =
      Math.min(
        ...recentLows.map(x => x.value)
      );

    results.push(
      makePattern(
        "SYMMETRICAL TRIANGLE",
        "BREAKOUT",
        72,
        "WAIT FOR DIRECTION",
        (upper + lower) / 2,
        upper,
        "Converging highs and lows indicate compression. Directional confirmation is required."
      )
    );

  }

  return results;
}

/* ============================================================
   FORMATION ENGINE
   ============================================================ */

function analyzeChartPatterns(bars) {

  const highs =
    pivotHighs(bars, 2);

  const lows =
    pivotLows(bars, 2);

  const price =
    bars[bars.length - 1].close;

  const patterns = [];

  const db =
    detectDoubleBottom(
      bars,
      lows,
      highs,
      price
    );

  if (db) patterns.push(db);

  const dt =
    detectDoubleTop(
      bars,
      highs,
      lows
    );

  if (dt) patterns.push(dt);

  const hs =
    detectHeadShoulders(
      bars,
      highs,
      lows,
      false
    );

  if (hs) patterns.push(hs);

  const ihs =
    detectHeadShoulders(
      bars,
      highs,
      lows,
      true
    );

  if (ihs) patterns.push(ihs);

  const cup =
    detectCupHandle(
      bars,
      highs,
      lows
    );

  if (cup) patterns.push(cup);

  const bullFlag =
    detectFlag(
      bars,
      true
    );

  if (bullFlag) patterns.push(bullFlag);

  const bearFlag =
    detectFlag(
      bars,
      false
    );

  if (bearFlag) patterns.push(bearFlag);

  patterns.push(
    ...detectTriangles(
      bars,
      highs,
      lows
    )
  );

  patterns.sort(
    (a, b) =>
      b.confidence - a.confidence
  );

  return {
    patterns: patterns.slice(0, 5),
    primary: patterns[0] || null
  };
}

/* ============================================================
   MARKET STRUCTURE
   ============================================================ */

function structureAnalysis(
  bars,
  highs,
  lows
) {

  const recentHighs =
    highs.filter(
      x => x.index >= bars.length - 45
    );

  const recentLows =
    lows.filter(
      x => x.index >= bars.length - 45
    );

  if (
    recentHighs.length < 2 ||
    recentLows.length < 2
  ) {

    return {
      structure: "UNDEFINED",
      direction: "NEUTRAL"
    };

  }

  const h1 =
    recentHighs[recentHighs.length - 2];

  const h2 =
    recentHighs[recentHighs.length - 1];

  const l1 =
    recentLows[recentLows.length - 2];

  const l2 =
    recentLows[recentLows.length - 1];

  if (
    h2.value > h1.value &&
    l2.value > l1.value
  ) {

    return {
      structure:
        "HIGHER HIGH + HIGHER LOW",
      direction: "BULLISH"
    };

  }

  if (
    h2.value < h1.value &&
    l2.value < l1.value
  ) {

    return {
      structure:
        "LOWER HIGH + LOWER LOW",
      direction: "BEARISH"
    };

  }

  if (h2.value > h1.value) {

    return {
      structure:
        "HIGHER HIGH + LOWER LOW",
      direction: "VOLATILE"
    };

  }

  return {
    structure:
      "LOWER HIGH + HIGHER LOW",
    direction: "COMPRESSING"
  };
}

/* ============================================================
   TREND
   ============================================================ */

function trendAnalysis(
  price,
  sma20,
  sma50,
  macd,
  macdSignal,
  rsiValue,
  structureDirection
) {

  let score = 50;

  if (Number.isFinite(sma20)) {

    score +=
      price > sma20 ? 10 : -10;

  }

  if (Number.isFinite(sma50)) {

    score +=
      price > sma50 ? 10 : -10;

  }

  if (
    Number.isFinite(sma20) &&
    Number.isFinite(sma50)
  ) {

    score +=
      sma20 > sma50 ? 10 : -10;

  }

  if (Number.isFinite(macd)) {

    score +=
      macd > macdSignal ? 8 : -8;

  }

  if (Number.isFinite(rsiValue)) {

    if (rsiValue > 55) score += 6;
    else if (rsiValue < 45) score -= 6;

  }

  if (structureDirection === "BULLISH") {
    score += 8;
  }

  if (structureDirection === "BEARISH") {
    score -= 8;
  }

  score = clamp(score, 0, 100);

  let trend = "SIDEWAYS";

  if (score >= 65) {
    trend = "BULLISH";
  } else if (score <= 35) {
    trend = "BEARISH";
  }

  return {
    trend,
    score: Math.round(score),
    confidence:
      Math.round(
        50 + Math.abs(score - 50) * 0.9
      )
  };
}

/* ============================================================
   MAIN HANDLER
   ============================================================ */

module.exports = async function handler(req, res) {

  try {

    const ticker =
      String(
        req.query?.ticker ||
        req.query?.symbol ||
        ""
      )
      .trim()
      .toUpperCase();

    if (!ticker) {
      return res
        .status(400)
        .json({
          error: "Missing ticker."
        });
    }

    if (!API_KEY) {
      return res
        .status(500)
        .json({
          error:
            "ALPHA_VANTAGE_API_KEY is not configured."
        });
    }

    const url =
      "https://www.alphavantage.co/query" +
      "?function=TIME_SERIES_DAILY" +
      "&symbol=" +
      encodeURIComponent(ticker) +
      "&outputsize=compact" +
      "&apikey=" +
      encodeURIComponent(API_KEY);

    const apiResponse =
      await fetch(url);

    const raw =
      await apiResponse.json();

    if (raw["Error Message"]) {

      return res
        .status(404)
        .json({
          error:
            "Ticker not found or Alpha Vantage rejected the symbol."
        });

    }

    if (raw["Note"]) {

      return res
        .status(429)
        .json({
          error:
            "Alpha Vantage API limit reached. Please try again later."
        });

    }

    const series =
      raw["Time Series (Daily)"];

    if (!series) {

      return res
        .status(502)
        .json({
          error:
            "No daily market data returned."
        });

    }

    const dates =
      Object.keys(series)
        .sort()
        .slice(-100);

    const bars =
      dates.map(date => {

        const x = series[date];

        return {
          date,
          open: Number(x["1. open"]),
          high: Number(x["2. high"]),
          low: Number(x["3. low"]),
          close: Number(x["4. close"]),
          volume: Number(x["5. volume"])
        };

      });

    if (bars.length < 30) {

      return res
        .status(502)
        .json({
          error:
            "Not enough historical data."
        });

    }

    const closes =
      bars.map(x => x.close);

    const sma20Array =
      sma(closes, 20);

    const sma50Array =
      sma(closes, 50);

    const rsiArray =
      rsi(closes, 14);

    const macdData =
      calculateMACD(closes);

    bars.forEach((bar, i) => {

      bar.sma20 =
        Number.isFinite(sma20Array[i])
          ? round(sma20Array[i])
          : null;

      bar.sma50 =
        Number.isFinite(sma50Array[i])
          ? round(sma50Array[i])
          : null;

      bar.rsi =
        Number.isFinite(rsiArray[i])
          ? round(rsiArray[i])
          : null;

      bar.macd =
        Number.isFinite(macdData.macd[i])
          ? round(macdData.macd[i], 4)
          : null;

      bar.macdSignal =
        Number.isFinite(macdData.signal[i])
          ? round(macdData.signal[i], 4)
          : null;

      bar.macdHistogram =
        Number.isFinite(macdData.histogram[i])
          ? round(macdData.histogram[i], 4)
          : null;

    });

    const last =
      bars[bars.length - 1];

    const previous =
      bars[bars.length - 2];

    const price =
      last.close;

    const changePct =
      previous.close
        ? ((price - previous.close) /
            previous.close) * 100
        : 0;

    const sma20 =
      sma20Array[sma20Array.length - 1];

    const sma50 =
      sma50Array[sma50Array.length - 1];

    const rsiValue =
      rsiArray[rsiArray.length - 1];

    const macd =
      macdData.macd[
        macdData.macd.length - 1
      ];

    const macdSignal =
      macdData.signal[
        macdData.signal.length - 1
      ];

    const macdHistogram =
      macdData.histogram[
        macdData.histogram.length - 1
      ];

    const highs =
      pivotHighs(bars, 2);

    const lows =
      pivotLows(bars, 2);

    const recent20 =
      bars.slice(-20);

    const support =
      Math.min(
        ...recent20.map(x => x.low)
      );

    const resistance =
      Math.max(
        ...recent20.map(x => x.high)
      );

    const structure =
      structureAnalysis(
        bars,
        highs,
        lows
      );

    const trend =
      trendAnalysis(
        price,
        sma20,
        sma50,
        macd,
        macdSignal,
        rsiValue,
        structure.direction
      );

    const candle =
      candleAnalysis(bars);

    const chartPatterns =
      analyzeChartPatterns(bars);

    /* ----------------------------------------------------------
       Relative volume
       ---------------------------------------------------------- */

    const previousVolumes =
      bars
        .slice(-21, -1)
        .map(x => x.volume);

    const averageVolume =
      avg(previousVolumes);

    const relativeVolume =
      averageVolume
        ? last.volume / averageVolume
        : null;

    const volumeConfirmation =
      Number.isFinite(relativeVolume) &&
      relativeVolume >= 1.2;

    /* ----------------------------------------------------------
       Breakout
       ---------------------------------------------------------- */

    const breakoutTrigger =
      resistance * 1.002;

    const breakout =
      price > breakoutTrigger
        ? "BREAKOUT"
        : price < support * 0.998
        ? "BREAKDOWN"
        : "NONE";

    /* ----------------------------------------------------------
       Score
       ---------------------------------------------------------- */

    let score = 50;

    if (Number.isFinite(sma20)) {
      score += price > sma20 ? 7 : -7;
    }

    if (Number.isFinite(sma50)) {
      score += price > sma50 ? 8 : -8;
    }

    if (
      Number.isFinite(sma20) &&
      Number.isFinite(sma50)
    ) {
      score +=
        sma20 > sma50
          ? 8
          : -8;
    }

    if (Number.isFinite(rsiValue)) {

      if (rsiValue >= 55 && rsiValue <= 70) {
        score += 7;
      }

      if (rsiValue < 40) {
        score -= 5;
      }

      if (rsiValue > 75) {
        score -= 4;
      }

    }

    if (
      Number.isFinite(macd) &&
      Number.isFinite(macdSignal)
    ) {

      score +=
        macd > macdSignal
          ? 7
          : -7;

    }

    if (structure.direction === "BULLISH") {
      score += 8;
    }

    if (structure.direction === "BEARISH") {
      score -= 8;
    }

    if (candle.signal === "BULLISH") {
      score +=
        candle.strength === "STRONG"
          ? 6
          : 3;
    }

    if (candle.signal === "BEARISH") {
      score -=
        candle.strength === "STRONG"
          ? 6
          : 3;
    }

    if (breakout === "BREAKOUT") {
      score += 10;
    }

    if (breakout === "BREAKDOWN") {
      score -= 10;
    }

    score =
      Math.round(
        clamp(score, 0, 100)
      );

    /* ----------------------------------------------------------
       Setup
       ---------------------------------------------------------- */

    let setup =
      "RANGE / WAIT";

    if (
      breakout === "BREAKOUT" &&
      trend.trend === "BULLISH"
    ) {

      setup =
        "BREAKOUT CONFIRMATION";

    } else if (
      breakout === "BREAKDOWN" &&
      trend.trend === "BEARISH"
    ) {

      setup =
        "BEARISH BREAKDOWN";

    } else if (
      chartPatterns.primary &&
      chartPatterns.primary.type === "REVERSAL"
    ) {

      setup =
        "REVERSAL WATCH";

    } else if (
      trend.trend === "BULLISH" &&
      structure.direction === "BULLISH"
    ) {

      setup =
        "BULLISH SETUP — WAIT FOR CONFIRMATION";

    } else if (
      trend.trend === "BEARISH" &&
      structure.direction === "BEARISH"
    ) {

      setup =
        "BEARISH SETUP — WAIT FOR CONFIRMATION";
    }

    /* ----------------------------------------------------------
       Entry / risk engine
       ---------------------------------------------------------- */

    const entryLow =
      support;

    const entryHigh =
      Number.isFinite(sma20)
        ? Math.max(
            sma20,
            support
          )
        : support;

    const invalidation =
      lows.length
        ? Math.min(
            support,
            lows[lows.length - 1].value
          )
        : support;

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
      target1 =
        price * 1.08;
    }

    if (target2 <= target1) {
      target2 =
        target1 * 1.10;
    }

    const trigger =
      chartPatterns.primary &&
      chartPatterns.primary.trigger
        ? chartPatterns.primary.trigger
        : breakoutTrigger;

    const riskPerShare =
      trigger > invalidation
        ? trigger - invalidation
        : null;

    const reward1 =
      riskPerShare
        ? target1 - trigger
        : null;

    const reward2 =
      riskPerShare
        ? target2 - trigger
        : null;

    const rr1 =
      riskPerShare > 0
        ? reward1 / riskPerShare
        : null;

    const rr2 =
      riskPerShare > 0
        ? reward2 / riskPerShare
        : null;

    let rrQuality =
      "NOT ATTRACTIVE";

    if (rr1 >= 2) {
      rrQuality =
        "ATTRACTIVE";
    } else if (rr1 >= 1.5) {
      rrQuality =
        "ACCEPTABLE";
    }

    /* ----------------------------------------------------------
       Confirmation conditions
       ---------------------------------------------------------- */

    const conditions = [

      {
        label:
          "Price above resistance",
        met:
          price > resistance
      },

      {
        label:
          "Bullish market structure",
        met:
          structure.direction === "BULLISH"
      },

      {
        label:
          "Short-term trend bullish",
        met:
          trend.trend === "BULLISH"
      },

      {
        label:
          "MACD bullish",
        met:
          Number.isFinite(macd) &&
          Number.isFinite(macdSignal) &&
          macd > macdSignal
      },

      {
        label:
          "RSI above 50",
        met:
          Number.isFinite(rsiValue) &&
          rsiValue > 50
      },

      {
        label:
          "Bullish candle confirmation",
        met:
          candle.signal === "BULLISH"
      },

      {
        label:
          "Volume confirmation",
        met:
          volumeConfirmation
      }

    ];

    const requiredConditions =
      conditions.slice(0, 6);

    const conditionsMet =
      requiredConditions.filter(
        x => x.met
      ).length;

    const triggerConfirmed =
      requiredConditions.every(
        x => x.met
      ) &&
      price > resistance;

    /* ----------------------------------------------------------
       Buy trigger text
       ---------------------------------------------------------- */

    let buyTrigger =
      "WAIT FOR CONFIRMATION";

    if (
      chartPatterns.primary
    ) {

      const p =
        chartPatterns.primary;

      if (
        p.status ===
        "BREAKOUT CONFIRMED"
      ) {

        buyTrigger =
          "BREAKOUT CONFIRMED";

      } else if (
        p.name === "DOUBLE BOTTOM" ||
        p.name === "INVERSE HEAD & SHOULDERS"
      ) {

        buyTrigger =
          "REVERSAL / NECKLINE BREAKOUT";

      } else if (
        p.name === "CUP & HANDLE"
      ) {

        buyTrigger =
          "CUP & HANDLE BREAKOUT";

      } else {

        buyTrigger =
          "CLOSE ABOVE RESISTANCE";
      }

    } else {

      buyTrigger =
        "CLOSE ABOVE RESISTANCE";

    }

    let signal =
      "WATCH";

    if (
      triggerConfirmed &&
      score >= 75
    ) {

      signal =
        "STRONG BUY";

    } else if (
      triggerConfirmed &&
      score >= 60
    ) {

      signal =
        "BUY";

    } else if (
      breakout === "BREAKDOWN" &&
      score < 40
    ) {

      signal =
        "SELL";
    }

    /* ----------------------------------------------------------
       Reasons
       ---------------------------------------------------------- */

    const reasons = [];
    const risks = [];

    if (
      trend.trend === "BULLISH"
    ) {
      reasons.push(
        "Bullish trend conditions."
      );
    }

    if (
      structure.direction === "BULLISH"
    ) {
      reasons.push(
        "Higher highs and higher lows indicate bullish structure."
      );
    }

    if (
      Number.isFinite(macd) &&
      macd > macdSignal
    ) {
      reasons.push(
        "MACD is bullish."
      );
    }

    if (
      Number.isFinite(rsiValue) &&
      rsiValue > 50
    ) {
      reasons.push(
        "RSI is above 50."
      );
    }

    if (
      candle.signal === "BULLISH"
    ) {
      reasons.push(
        `${candle.pattern} provides bullish candle confirmation.`
      );
    }

    if (
      chartPatterns.primary
    ) {

      reasons.push(
        `${chartPatterns.primary.name} detected with ${chartPatterns.primary.confidence}% confidence.`
      );

    }

    if (
      trend.trend === "BEARISH"
    ) {
      risks.push(
        "Bearish trend conditions."
      );
    }

    if (
      structure.direction === "BEARISH"
    ) {
      risks.push(
        "Lower highs and lower lows indicate bearish structure."
      );
    }

    if (
      candle.signal === "BEARISH"
    ) {
      risks.push(
        `${candle.pattern} indicates selling pressure.`
      );
    }

    if (
      !volumeConfirmation
    ) {
      risks.push(
        "Volume has not provided strong confirmation."
      );
    }

    if (
      chartPatterns.primary &&
      chartPatterns.primary.status !==
        "BREAKOUT CONFIRMED"
    ) {
      risks.push(
        "Chart formation still requires price confirmation."
      );
    }

    /* ----------------------------------------------------------
       Response
       ---------------------------------------------------------- */

    return res
      .status(200)
      .json({

        symbol: ticker,
        name: ticker,

        price: round(price),
        change_pct: round(changePct),

        score,
        signal,

        trend:
          trend.trend,

        trend_score:
          trend.score,

        trend_confidence:
          trend.confidence,

        short_term_trend:
          price > sma20
            ? "BULLISH"
            : "BEARISH",

        structure:
          structure.structure,

        structure_direction:
          structure.direction,

        reversal:
          chartPatterns.primary &&
          chartPatterns.primary.type ===
            "REVERSAL"
            ? chartPatterns.primary.name
            : "NONE",

        reversal_confidence:
          chartPatterns.primary &&
          chartPatterns.primary.type ===
            "REVERSAL"
            ? chartPatterns.primary.confidence
            : 0,

        setup,

        /* Candlestick */

        candle_pattern:
          candle.pattern,

        candle_signal:
          candle.signal,

        candle_strength:
          candle.strength,

        candle_context:
          candle.context,

        candle_description:
          candle.description,

        /* Chart formations */

        chart_pattern:
          chartPatterns.primary
            ? chartPatterns.primary.name
            : "NONE",

        chart_pattern_type:
          chartPatterns.primary
            ? chartPatterns.primary.type
            : "NONE",

        chart_pattern_confidence:
          chartPatterns.primary
            ? chartPatterns.primary.confidence
            : 0,

        chart_pattern_status:
          chartPatterns.primary
            ? chartPatterns.primary.status
            : "NONE",

        chart_pattern_trigger:
          chartPatterns.primary
            ? chartPatterns.primary.trigger
            : null,

        chart_pattern_target:
          chartPatterns.primary
            ? chartPatterns.primary.target
            : null,

        chart_pattern_description:
          chartPatterns.primary
            ? chartPatterns.primary.description
            : "No major chart formation detected.",

        chart_patterns:
          chartPatterns.patterns,

        /* Breakout */

        breakout,

        breakout_level:
          round(breakoutTrigger),

        /* Levels */

        rsi:
          round(rsiValue),

        entry_low:
          round(entryLow),

        entry_high:
          round(entryHigh),

        stop:
          round(invalidation),

        invalidation:
          round(invalidation),

        target1:
          round(target1),

        target2:
          round(target2),

        /* Decision */

        buy_trigger:
          buyTrigger,

        buy_trigger_price:
          round(trigger),

        buy_trigger_confirmed:
          triggerConfirmed,

        trigger_reason:
          triggerConfirmed
            ? "All required confirmation conditions are met."
            : "Wait for price, structure, momentum and candle confirmation.",

        invalidation_reason:
          "Setup is invalidated if price closes below the key structural support.",

        risk_per_share:
          round(riskPerShare),

        reward_to_target1:
          round(reward1),

        reward_to_target2:
          round(reward2),

        risk_reward_target1:
          round(rr1),

        risk_reward_target2:
          round(rr2),

        risk_reward_quality:
          rrQuality,

        buy_conditions:
          conditions.map(x => x.met),

        buy_condition_labels:
          conditions.map(x => x.label),

        conditions_met:
          conditionsMet,

        conditions_total:
          requiredConditions.length,

        relative_volume:
          round(relativeVolume, 2),

        volume_confirmation:
          volumeConfirmation,

        reasons,

        risks,

        fundamentals: {

          sma20:
            round(sma20),

          sma50:
            round(sma50),

          support:
            round(support),

          resistance:
            round(resistance),

          macd:
            round(macd, 4),

          macd_signal:
            round(macdSignal, 4),

          macd_histogram:
            round(macdHistogram, 4)

        },

        history:
          bars

      });

  } catch (error) {

    console.error(error);

    return res
      .status(500)
      .json({
        error:
          "Unexpected server error."
      });

  }

};
