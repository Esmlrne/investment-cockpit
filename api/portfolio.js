// api/portfolio.js
//
// Portfolio fundamentals endpoint for Investment Cockpit.
// Uses TigZig YFIN's detailed-info endpoint so we can analyze
// multiple portfolio holdings without consuming Alpha Vantage quota.

export default async function handler(req, res) {
  try {
    const rawTickers =
      req.query?.tickers ||
      req.body?.tickers ||
      "";

    const tickers = String(rawTickers)
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
      .filter((ticker, index, arr) => arr.indexOf(ticker) === index);

    if (!tickers.length) {
      return res.status(400).json({
        error: "Missing tickers parameter."
      });
    }

    // TigZig supports up to 25 tickers per request.
    if (tickers.length > 25) {
      return res.status(400).json({
        error: "Maximum 25 tickers per request."
      });
    }

    const url =
      "https://yfin-h.tigzig.com/v1/get-detailed-info/?tickers=" +
      encodeURIComponent(tickers.join(","));

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text().catch(() => "");

      return res.status(response.status).json({
        error: "Portfolio data provider returned an error.",
        status: response.status,
        details: text.slice(0, 500)
      });
    }

    const payload = await response.json();

    const result = {};

    for (const ticker of tickers) {
      const raw =
        payload?.[ticker] ||
        payload?.[ticker.toUpperCase()] ||
        payload?.[ticker.toLowerCase()] ||
        {};

      const info = raw?.main_info || raw?.mainInfo || raw || {};

      const number = (...values) => {
        for (const value of values) {
          if (
            value !== undefined &&
            value !== null &&
            value !== "" &&
            Number.isFinite(Number(value))
          ) {
            return Number(value);
          }
        }
        return null;
      };

      const stringValue = (...values) => {
        for (const value of values) {
          if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
          ) {
            return String(value);
          }
        }
        return null;
      };

      result[ticker] = {
        symbol: ticker,

        name: stringValue(
          info.longName,
          info.shortName,
          info.displayName,
          info.name
        ),

        sector: stringValue(
          info.sector,
          info.sectorDisp
        ),

        industry: stringValue(
          info.industry,
          info.industryDisp
        ),

        price: number(
          info.regularMarketPrice,
          info.currentPrice,
          info.price
        ),

        previousClose: number(
          info.regularMarketPreviousClose,
          info.previousClose
        ),

        marketCap: number(
          info.marketCap
        ),

        enterpriseValue: number(
          info.enterpriseValue
        ),

        trailingPE: number(
          info.trailingPE,
          info.peRatio,
          info.pe
        ),

        forwardPE: number(
          info.forwardPE
        ),

        pegRatio: number(
          info.pegRatio,
          info.trailingPegRatio
        ),

        priceToBook: number(
          info.priceToBook
        ),

        priceToSales: number(
          info.priceToSalesTrailing12Months,
          info.priceToSales
        ),

        earningsGrowth: number(
          info.earningsGrowth,
          info.earningsQuarterlyGrowth
        ),

        revenueGrowth: number(
          info.revenueGrowth
        ),

        profitMargin: number(
          info.profitMargins,
          info.profitMargin
        ),

        operatingMargin: number(
          info.operatingMargins,
          info.operatingMargin
        ),

        grossMargin: number(
          info.grossMargins,
          info.grossMargin
        ),

        roe: number(
          info.returnOnEquity,
          info.roe
        ),

        roa: number(
          info.returnOnAssets,
          info.roa
        ),

        debtToEquity: number(
          info.debtToEquity
        ),

        currentRatio: number(
          info.currentRatio
        ),

        freeCashFlow: number(
          info.freeCashflow,
          info.freeCashFlow
        ),

        operatingCashFlow: number(
          info.operatingCashflow,
          info.operatingCashFlow
        ),

        totalRevenue: number(
          info.totalRevenue
        ),

        totalCash: number(
          info.totalCash
        ),

        totalDebt: number(
          info.totalDebt
        ),

        dividendYield: number(
          info.dividendYield,
          info.trailingAnnualDividendYield
        ),

        beta: number(
          info.beta
        ),

        fiftyTwoWeekHigh: number(
          info.fiftyTwoWeekHigh
        ),

        fiftyTwoWeekLow: number(
          info.fiftyTwoWeekLow
        ),

        recommendationKey: stringValue(
          info.recommendationKey
        ),

        analystRating: stringValue(
          info.recommendationMean
        ),

        currency: stringValue(
          info.currency,
          info.financialCurrency
        ),

        exchange: stringValue(
          info.exchange,
          info.fullExchangeName
        )
      };
    }

    return res.status(200).json({
      success: true,
      source: "TigZig YFIN",
      count: tickers.length,
      data: result,
      updated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error("Portfolio API error:", error);

    return res.status(500).json({
      error: "Unable to retrieve portfolio data.",
      message: error?.message || "Unknown error"
    });
  }
}
