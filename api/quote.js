// api/quote.js
// Portfolio market-price endpoint
// Uses TigZig YFIN (Yahoo Finance data) instead of Yahoo directly.

const CACHE = new Map();
const CACHE_MS = 5 * 60 * 1000;

const YFIN_BASE = "https://yfin-h.tigzig.com/v1/get-market-data/";

function cleanTicker(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isValidTicker(ticker) {
  return /^[A-Z0-9.^_-]{1,20}$/.test(ticker);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function findPrice(data) {
  if (!data) return null;

  // Direct fields
  const possibleFields = [
    "regularMarketPrice",
    "regular_market_price",
    "currentPrice",
    "current_price",
    "price",
    "lastPrice",
    "last_price",
    "close",
    "Close"
  ];

  for (const field of possibleFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const value = toNumber(data[field]);

      if (value !== null) {
        return value;
      }
    }
  }

  // Sometimes the API may return nested market data.
  const nestedCandidates = [
    data.market,
    data.market_data,
    data.quote,
    data.data,
    data.result
  ];

  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object") {
      const price = findPrice(nested);

      if (price !== null) {
        return price;
      }
    }
  }

  return null;
}

function findPreviousClose(data) {
  if (!data) return null;

  const possibleFields = [
    "regularMarketPreviousClose",
    "regular_market_previous_close",
    "previousClose",
    "previous_close",
    "prevClose",
    "prev_close"
  ];

  for (const field of possibleFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const value = toNumber(data[field]);

      if (value !== null) {
        return value;
      }
    }
  }

  const nestedCandidates = [
    data.market,
    data.market_data,
    data.quote,
    data.data,
    data.result
  ];

  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object") {
      const value = findPreviousClose(nested);

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function findCurrency(data) {
  if (!data || typeof data !== "object") return null;

  const fields = [
    "currency",
    "Currency",
    "financialCurrency",
    "financial_currency"
  ];

  for (const field of fields) {
    if (data[field]) {
      return String(data[field]);
    }
  }

  const nestedCandidates = [
    data.market,
    data.market_data,
    data.quote,
    data.data,
    data.result
  ];

  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object") {
      const value = findCurrency(nested);

      if (value) {
        return value;
      }
    }
  }

  return null;
}

async function fetchMarketData(ticker) {
  const url =
    `${YFIN_BASE}?tickers=${encodeURIComponent(ticker)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "User-Agent": "Investment-Cockpit/1.0"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Market data service returned ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(
      "Market data service returned an unexpected response"
    );
  }

  return data;
}

function extractTickerData(payload, ticker) {
  if (!payload) return null;

  // Case 1:
  // { "NVDA": {...} }
  if (
    payload[ticker] &&
    typeof payload[ticker] === "object"
  ) {
    return payload[ticker];
  }

  // Case 2:
  // { "data": { "NVDA": {...} } }
  if (
    payload.data &&
    payload.data[ticker] &&
    typeof payload.data[ticker] === "object"
  ) {
    return payload.data[ticker];
  }

  // Case 3:
  // { "results": [{ "ticker": "NVDA", ... }] }
  const arrays = [
    payload.results,
    payload.data,
    payload.quotes,
    payload.items
  ];

  for (const arr of arrays) {
    if (Array.isArray(arr)) {
      const match = arr.find((item) => {
        if (!item || typeof item !== "object") return false;

        const symbol =
          item.ticker ||
          item.symbol ||
          item.Ticker ||
          item.Symbol;

        return String(symbol || "").toUpperCase() === ticker;
      });

      if (match) {
        return match;
      }
    }
  }

  // Case 4:
  // The API may return one direct object for one ticker.
  if (
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    const symbol =
      payload.ticker ||
      payload.symbol ||
      payload.Ticker ||
      payload.Symbol;

    if (
      !symbol ||
      String(symbol).toUpperCase() === ticker
    ) {
      return payload;
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(
      req.query?.ticker || req.query?.symbol
    );

    if (!ticker) {
      return res.status(400).json({
        error: "Missing ticker"
      });
    }

    if (!isValidTicker(ticker)) {
      return res.status(400).json({
        error: "Invalid ticker"
      });
    }

    // Use short server-side cache so repeated refreshes
    // don't unnecessarily hit the external service.
    const cached = CACHE.get(ticker);

    if (
      cached &&
      Date.now() - cached.timestamp < CACHE_MS
    ) {
      return res.status(200).json({
        ...cached.data,
        cached: true
      });
    }

    const payload = await fetchMarketData(ticker);

    const marketData =
      extractTickerData(payload, ticker);

    if (!marketData) {
      return res.status(404).json({
        error: `No market data found for ${ticker}`
      });
    }

    const price = findPrice(marketData);

    if (price === null) {
      return res.status(502).json({
        error: `No current price found for ${ticker}`
      });
    }

    const previousClose =
      findPreviousClose(marketData);

    let changePct = null;

    if (
      previousClose !== null &&
      previousClose !== 0
    ) {
      changePct =
        ((price - previousClose) /
          previousClose) *
        100;
    }

    const result = {
      symbol: ticker,
      price,
      previous_close: previousClose,
      change_pct: changePct,
      currency: findCurrency(marketData),
      source: "TigZig YFIN / Yahoo Finance",
      last_updated: new Date().toISOString(),
      cached: false
    };

    CACHE.set(ticker, {
      timestamp: Date.now(),
      data: result
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error("Quote API error:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Unable to retrieve market data"
    });
  }
}
