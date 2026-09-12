const cache =
  globalThis.__investmentCockpitQuoteCache ||
  new Map();

globalThis.__investmentCockpitQuoteCache = cache;

const CACHE_TTL = 15 * 60 * 1000;

const YAHOO_BASE =
  "https://query1.finance.yahoo.com/v8/finance/chart";


function validTicker(ticker) {
  return /^[A-Z0-9.^_-]{1,15}$/.test(ticker);
}


function getCached(key) {

  const item = cache.get(key);

  if (!item) {
    return null;
  }

  if (
    Date.now() - item.timestamp >
    CACHE_TTL
  ) {

    cache.delete(key);

    return null;
  }

  return item.data;
}


function setCached(key, data) {

  cache.set(key, {
    timestamp: Date.now(),
    data
  });

}


export default async function handler(req, res) {

  const ticker =
    String(
      req.query.ticker || ""
    )
      .trim()
      .toUpperCase();


  if (!validTicker(ticker)) {

    return res.status(400).json({
      error: "Invalid ticker"
    });

  }


  const cacheKey =
    `quote:${ticker}`;


  const cached =
    getCached(cacheKey);


  if (cached) {

    return res.status(200).json({
      ...cached,
      cached: true
    });

  }


  try {

    const url =
      `${YAHOO_BASE}/${encodeURIComponent(
        ticker
      )}?range=1d&interval=1d&includePrePost=false`;


    const response =
      await fetch(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
            "Accept":
              "application/json,text/plain,*/*"
          }
        }
      );


    if (!response.ok) {

      return res.status(
        response.status
      ).json({

        error:
          `Market data service returned ${response.status}`

      });

    }


    const data =
      await response.json();


    const result =
      data?.chart?.result?.[0];


    if (!result) {

      return res.status(404).json({

        error:
          `No market data found for ${ticker}`

      });

    }


    const meta =
      result.meta || {};


    /*
      Yahoo normally provides the
      current/latest available market
      price here.
    */

    let price =
      Number(
        meta.regularMarketPrice
      );


    /*
      Fallback to the latest close
      if regularMarketPrice is absent.
    */

    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {

      const closes =
        result
          ?.indicators
          ?.quote?.[0]
          ?.close || [];


      for (
        let i = closes.length - 1;
        i >= 0;
        i--
      ) {

        const candidate =
          Number(closes[i]);


        if (
          Number.isFinite(candidate) &&
          candidate > 0
        ) {

          price =
            candidate;

          break;

        }

      }

    }


    if (
      !Number.isFinite(price) ||
      price <= 0
    ) {

      return res.status(404).json({

        error:
          `No valid price found for ${ticker}`

      });

    }


    const previousClose =
      Number(
        meta.previousClose ??
        meta.chartPreviousClose
      );


    let changePct = null;


    if (
      Number.isFinite(previousClose) &&
      previousClose > 0
    ) {

      changePct =
        (
          (price - previousClose) /
          previousClose
        ) * 100;

    }


    const marketTime =
      Number(
        meta.regularMarketTime
      );


    const resultData = {

      symbol:
        meta.symbol ||
        ticker,

      price,

      previous_close:
        Number.isFinite(previousClose)
          ? previousClose
          : null,

      change_pct:
        Number.isFinite(changePct)
          ? changePct
          : null,

      currency:
        meta.currency ||
        "USD",

      exchange:
        meta.exchangeName ||
        meta.fullExchangeName ||
        null,

      market_state:
        meta.marketState ||
        null,

      regular_market_time:
        Number.isFinite(marketTime)
          ? new Date(
              marketTime * 1000
            ).toISOString()
          : null,

      last_updated:
        new Date().toISOString(),

      source:
        "Yahoo Finance",

      cached:
        false

    };


    setCached(
      cacheKey,
      resultData
    );


    return res.status(200).json(
      resultData
    );


  } catch (error) {

    console.error(
      "Quote error:",
      error
    );


    return res.status(500).json({

      error:
        "Unable to retrieve market price",

      message:
        error?.message ||
        "Unknown error"

    });

  }

}
