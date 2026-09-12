// api/quote.js
// Current portfolio price endpoint
// Uses TigZig YFIN detailed company/market data.

const CACHE = new Map();
const CACHE_MS = 5 * 60 * 1000;

const YFIN_BASE =
  "https://yfin-h.tigzig.com/v1/get-detailed-info/";

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

  if (typeof value === "object") {
    if (value.raw !== undefined) {
      return toNumber(value.raw);
    }

    if (value.value !== undefined) {
      return toNumber(value.value);
    }
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function getField(data, fields) {
  if (!data || typeof data !== "object") {
    return null;
  }

  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      const value = data[field];

      if (value !== null && value !== undefined) {
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
      Accept: "application/json",
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
      "Market data service returned invalid JSON"
    );
  }

  return data;
}

function extractTickerData(payload, ticker) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  // Expected format:
  // {
  //   "NVDA": {
  //     "main_info": {
  //       ...
  //     }
  //   }
  // }

  if (
    payload[ticker] &&
    typeof payload[ticker] === "object"
  ) {
    return payload[ticker];
  }

  // Case-insensitive fallback
  for (const key of Object.keys(payload)) {
    if (String(key).toUpperCase() === ticker) {
      return payload[key];
    }
  }

  return null;
}

function findPrice(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const priceFields = [
    "regularMarketPrice",
    "currentPrice",
    "current_price",
    "price",
    "lastPrice",
    "last_price"
  ];

  // First check directly on the object.
  const direct = getField(data, priceFields);

  const directNumber = toNumber(direct);

  if (directNumber !== null) {
    return directNumber;
  }

  // Then check main_info.
  if (
    data.main_info &&
    typeof data.main_info === "object"
  ) {
    const mainPrice = getField(
      data.main_info,
      priceFields
    );

    const mainNumber = toNumber(mainPrice);

    if (mainNumber !== null) {
      return mainNumber;
    }
  }

  // Then check common nested objects.
  const nestedObjects = [
    data.market,
    data.market_data,
    data.quote,
    data.data,
    data.info
  ];

  for (const nested of nestedObjects) {
    if (
      nested &&
      typeof nested === "object"
    ) {
      const nestedPrice = findPrice(nested);

      if (nestedPrice !== null) {
        return nestedPrice;
      }
    }
  }

  return null;
}

function findPreviousClose(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const fields = [
    "regularMarketPreviousClose",
    "previousClose",
    "previous_close",
    "chartPreviousClose"
  ];

  const direct = toNumber(
    getField(data, fields)
  );

  if (direct !== null) {
    return direct;
  }

  if (
    data.main_info &&
    typeof data.main_info === "object"
  ) {
    const mainValue = toNumber(
      getField(data.main_info, fields)
    );

    if (mainValue !== null) {
      return mainValue;
    }
  }

  return null;
}

function findCurrency(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const fields = [
    "currency",
    "financialCurrency",
    "financial_currency"
  ];

  const direct = getField(data, fields);

  if (direct) {
    return String(direct);
  }

  if (
    data.main_info &&
    typeof data.main_info === "object"
  ) {
    const mainCurrency = getField(
      data.main_info,
      fields
    );

    if (mainCurrency) {
      return String(mainCurrency);
    }
  }

  return null;
}

function findMarketState(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const direct = getField(data, [
    "marketState",
    "market_state"
  ]);

  if (direct) {
    return String(direct);
  }

  if (
    data.main_info &&
    typeof data.main_info === "object"
  ) {
    const mainState = getField(
      data.main_info,
      [
        "marketState",
        "market_state"
      ]
    );

    if (mainState) {
      return String(mainState);
    }
  }

  return null;
}

function findExchange(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const direct = getField(data, [
    "exchange",
    "fullExchangeName"
  ]);

  if (direct) {
    return String(direct);
  }

  if (
    data.main_info &&
    typeof data.main_info === "object"
  ) {
    const mainExchange = getField(
      data.main_info,
      [
        "exchange",
        "fullExchangeName"
      ]
    );

    if (mainExchange) {
      return String(mainExchange);
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    const ticker = cleanTicker(
      req.query?.ticker ||
      req.query?.symbol
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

    // Server-side cache.
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

    const payload =
      await fetchMarketData(ticker);

    const tickerData =
      extractTickerData(
        payload,
        ticker
      );

    if (!tickerData) {
      return res.status(404).json({
        error:
          `No market data found for ${ticker}`
      });
    }

    const price =
      findPrice(tickerData);

    if (price === null) {
      return res.status(502).json({
        error:
          `No current price found for ${ticker}`
      });
    }

    const previousClose =
      findPreviousClose(tickerData);

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
      currency:
        findCurrency(tickerData),
      exchange:
        findExchange(tickerData),
      market_state:
        findMarketState(tickerData),
      source:
        "TigZig YFIN / Yahoo Finance",
      last_updated:
        new Date().toISOString(),
      cached: false
    };

    CACHE.set(ticker, {
      timestamp: Date.now(),
      data: result
    });

    return res.status(200).json(result);

  } catch (error) {
    console.error(
      "Quote API error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Unable to retrieve market data"
    });
  }
}
