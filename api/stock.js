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
      error: "Missing Alpha Vantage API key"
    });
  }

  try {
    // ==========================================================
    // HELPERS
    // ==========================================================

    const av = async (params) => {
      const query = new URLSearchParams({
        ...params,
        apikey: apiKey
      });

      const response = await fetch(
        `https://www.alphavantage.co/query?${query.toString()}`
      );

      if (!response.ok) {
        throw new Error(
          `Alpha Vantage HTTP ${response.status}`
        );
      }

      const data = await response.json();

      if (data.Note) {
        throw new Error(
          "Alpha Vantage daily request limit reached."
        );
      }

      if (data.Information) {
        throw new Error(
          data.Information
        );
      }

      if (data["Error Message"]) {
        throw new Error(
          data["Error Message"]
        );
      }

      return data;
    };

    const round = (value, decimals = 2) => {
      const n = Number(value);

      if (!Number.isFinite(n)) {
        return null;
      }

      const factor = 10 ** decimals;

      return Math.round(n * factor) / factor;
    };

    const average = (values) => {
      const valid = values.filter(
        Number.isFinite
      );

      if (!valid.length) {
        return null;
      }

      return (
        valid.reduce(
          (a, b) => a + b,
          0
        ) / valid.length
      );
    };

    const growth = (current, previous) => {
      const c = Number(current);
      const p = Number(previous);

      if (
        !Number.isFinite(c) ||
        !Number.isFinite(p) ||
        p === 0
      ) {
        return null;
      }

      return ((c - p) / Math.abs(p)) * 100;
    };

    const firstNumber = (...values) => {
      for (const value of values) {
        const n = Number(value);

        if (Number.isFinite(n)) {
          return n;
        }
      }

      return null;
    };

    // ==========================================================
    // TECHNICAL DATA
    // ==========================================================

    const dailyPromise = av({
      function: "TIME_SERIES_DAILY",
      symbol,
      outputsize: "compact"
    });

    // ==========================================================
    // FUNDAMENTAL DATA
    // ==========================================================

    const overviewPromise = av({
      function: "OVERVIEW",
      symbol
    });

    const incomePromise = av({
      function: "INCOME_STATEMENT",
      symbol
    });

    // ==========================================================
    // NEWS
    // ==========================================================

    const newsPromise = av({
      function: "NEWS_SENTIMENT",
      tickers: symbol,
      sort: "LATEST",
      limit: "8"
    });

    const [
      dailyData,
      overviewData,
      incomeData,
      newsData
    ] = await Promise.all([
      dailyPromise,
      overviewPromise,
      incomePromise,
      newsPromise
    ]);

    // ==========================================================
    // DAILY PRICE DATA
    // ==========================================================

    const timeSeries =
      dailyData["Time Series (Daily)"];

    if (!timeSeries) {
      throw new Error(
        "No daily market data returned."
      );
    }

    const dates =
      Object.keys(timeSeries)
        .sort();

    if (dates.length < 30) {
      throw new Error(
        "Not enough daily market history returned."
      );
    }

    const history =
      dates
        .map((date) => ({
          date,

          open: Number(
            timeSeries[date]["1. open"]
          ),

          high: Number(
            timeSeries[date]["2. high"]
          ),

          low: Number(
            timeSeries[date]["3. low"]
          ),

          close: Number(
            timeSeries[date]["4. close"]
          ),

          volume: Number(
            timeSeries[date]["5. volume"]
          )
        }))
        .filter(
          (x) =>
            Number.isFinite(x.close)
        );

    const closes =
      history.map(
        (x) => x.close
      );

    const latest =
      history[history.length - 1];

    const previous =
      history[history.length - 2];

    const price =
      latest.close;

    const change =
      previous
        ? price - previous.close
        : 0;

    const changePct =
      previous && previous.close
        ? (
            change /
            previous.close
          ) * 100
        : 0;

    // ==========================================================
    // TECHNICAL INDICATORS
    // ==========================================================

    const sma = (values, period) => {
      if (values.length < period) {
        return null;
      }

      return average(
        values.slice(-period)
      );
    };

    const calculateRSI = (
      values,
      period = 14
    ) => {
      if (values.length <= period) {
        return null;
      }

      let gains = 0;
      let losses = 0;

      for (
        let i = 1;
        i <= period;
        i++
      ) {
        const change =
          values[i] -
          values[i - 1];

        if (change >= 0) {
          gains += change;
        } else {
          losses += Math.abs(change);
        }
      }

      let avgGain =
        gains / period;

      let avgLoss =
        losses / period;

      for (
        let i = period + 1;
        i < values.length;
        i++
      ) {
        const change =
          values[i] -
          values[i - 1];

        const gain =
          Math.max(change, 0);

        const loss =
          Math.max(-change, 0);

        avgGain =
          (
            avgGain *
            (period - 1) +
            gain
          ) / period;

        avgLoss =
          (
            avgLoss *
            (period - 1) +
            loss
          ) / period;
      }

      if (avgLoss === 0) {
        return 100;
      }

      const rs =
        avgGain / avgLoss;

      return (
        100 -
        100 / (1 + rs)
      );
    };

    const ema = (
      values,
      period
    ) => {
      if (values.length < period) {
        return null;
      }

      const multiplier =
        2 / (period + 1);

      let result =
        average(
          values.slice(0, period)
        );

      for (
        let i = period;
        i < values.length;
        i++
      ) {
        result =
          (
            values[i] -
            result
          ) *
          multiplier +
          result;
      }

      return result;
    };

    const calculateMACD =
      (values) => {
        if (values.length < 35) {
          return {
            macd: null,
            signal: null,
            histogram: null
          };
        }

        const macdValues = [];

        for (
          let i = 26;
          i <= values.length;
          i++
        ) {
          const slice =
            values.slice(0, i);

          const fast =
            ema(slice, 12);

          const slow =
            ema(slice, 26);

          if (
            fast !== null &&
            slow !== null
          ) {
            macdValues.push(
              fast - slow
            );
          }
        }

        const macd =
          macdValues[
            macdValues.length - 1
          ];

        const signal =
          macdValues.length >= 9
            ? ema(macdValues, 9)
            : null;

        return {
          macd,
          signal,

          histogram:
            macd !== null &&
            signal !== null
              ? macd - signal
              : null
        };
      };

    const sma20 =
      sma(closes, 20);

    const sma50 =
      sma(closes, 50);

    const rsi =
      calculateRSI(closes);

    const macd =
      calculateMACD(closes);

    // ==========================================================
    // INDICATORS PER HISTORY POINT
    // ==========================================================

    for (
      let i = 0;
      i < history.length;
      i++
    ) {
      const values =
        history
          .slice(0, i + 1)
          .map(
            (x) => x.close
          );

      history[i].sma20 =
        sma(values, 20);

      history[i].sma50 =
        sma(values, 50);

      history[i].rsi =
        calculateRSI(values);

      const m =
        calculateMACD(values);

      history[i].macd =
        m.macd;

      history[i].macdSignal =
        m.signal;

      history[i].macdHistogram =
        m.histogram;
    }

    // ==========================================================
    // SUPPORT / RESISTANCE
    // ==========================================================

    const recent20 =
      history.slice(-20);

    const support =
      Math.min(
        ...recent20.map(
          (x) => x.low
        )
      );

    const resistance =
      Math.max(
        ...recent20.map(
          (x) => x.high
        )
      );

    // ==========================================================
    // MARKET STRUCTURE
    // ==========================================================

    const firstHalf =
      history.slice(-20, -10);

    const secondHalf =
      history.slice(-10);

    const firstHigh =
      Math.max(
        ...firstHalf.map(
          (x) => x.high
        )
      );

    const secondHigh =
      Math.max(
        ...secondHalf.map(
          (x) => x.high
        )
      );

    const firstLow =
      Math.min(
        ...firstHalf.map(
          (x) => x.low
        )
      );

    const secondLow =
      Math.min(
        ...secondHalf.map(
          (x) => x.low
        )
      );

    const higherHigh =
      secondHigh > firstHigh;

    const higherLow =
      secondLow > firstLow;

    const lowerHigh =
      secondHigh < firstHigh;

    const lowerLow =
      secondLow < firstLow;

    let structure =
      "MIXED";

    let structureDirection =
      "NEUTRAL";

    if (
      higherHigh &&
      higherLow
    ) {
      structure =
        "HIGHER HIGH + HIGHER LOW";

      structureDirection =
        "BULLISH";
    }

    if (
      lowerHigh &&
      lowerLow
    ) {
      structure =
        "LOWER HIGH + LOWER LOW";

      structureDirection =
        "BEARISH";
    }

    // ==========================================================
    // TREND
    // ==========================================================

    let trend =
      "SIDEWAYS";

    let trendScore =
      50;

    if (
      sma20 !== null &&
      sma50 !== null
    ) {
      if (
        price > sma20 &&
        sma20 > sma50
      ) {
        trend =
          "BULLISH";

        trendScore =
          80;
      } else if (
        price < sma20 &&
        sma20 < sma50
      ) {
        trend =
          "BEARISH";

        trendScore =
          20;
      }
    }

    const shortTermTrend =
      price > sma20
        ? "BULLISH"
        : price < sma20
          ? "BEARISH"
          : "SIDEWAYS";

    // ==========================================================
    // VOLUME
    // ==========================================================

    const volumes =
      history.map(
        (x) => x.volume
      );

    const avgVolume20 =
      average(
        volumes.slice(-21, -1)
      );

    const relativeVolume =
      avgVolume20
        ? latest.volume /
          avgVolume20
        : null;

    let volumeConfirmation =
      "NEUTRAL";

    if (
      relativeVolume >= 1.5
    ) {
      volumeConfirmation =
        "STRONG";
    } else if (
      relativeVolume >= 1.1
    ) {
      volumeConfirmation =
        "POSITIVE";
    } else if (
      relativeVolume < 0.8
    ) {
      volumeConfirmation =
        "WEAK";
    }

    // ==========================================================
    // CANDLE
    // ==========================================================

    const body =
      Math.abs(
        latest.close -
        latest.open
      );

    const range =
      latest.high -
      latest.low;

    const upperWick =
      latest.high -
      Math.max(
        latest.open,
        latest.close
      );

    const lowerWick =
      Math.min(
        latest.open,
        latest.close
      ) -
      latest.low;

    let candlePattern =
      "NORMAL";

    let candleSignal =
      "NEUTRAL";

    let candleStrength =
      "NORMAL";

    if (
      range > 0 &&
      body / range < 0.1
    ) {
      candlePattern =
        "DOJI";

      candleStrength =
        "WEAK";
    }

    if (
      range > 0 &&
      lowerWick > body * 2 &&
      upperWick < body
    ) {
      candlePattern =
        "HAMMER";

      candleSignal =
        "BULLISH";

      candleStrength =
        "STRONG";
    }

    if (
      range > 0 &&
      upperWick > body * 2 &&
      lowerWick < body
    ) {
      candlePattern =
        "SHOOTING STAR";

      candleSignal =
        "BEARISH";

      candleStrength =
        "STRONG";
    }

    if (
      latest.close >
        latest.open &&
      previous &&
      previous.close <
        previous.open &&
      latest.open <=
        previous.close &&
      latest.close >=
        previous.open
    ) {
      candlePattern =
        "BULLISH ENGULFING";

      candleSignal =
        "BULLISH";

      candleStrength =
        "STRONG";
    }

    if (
      latest.close <
        latest.open &&
      previous &&
      previous.close >
        previous.open &&
      latest.open >=
        previous.close &&
      latest.close <=
        previous.open
    ) {
      candlePattern =
        "BEARISH ENGULFING";

      candleSignal =
        "BEARISH";

      candleStrength =
        "STRONG";
    }

    // ==========================================================
    // BREAKOUT / ENTRY
    // ==========================================================

    const breakoutLevel =
      resistance;

    const buyTriggerPrice =
      breakoutLevel * 1.002;

    const breakoutConfirmed =
      price >
      buyTriggerPrice;

    const entryLow =
      support;

    const entryHigh =
      Math.max(
        support,
        sma20 || support
      );

    const preferredEntry =
      (
        entryLow +
        entryHigh
      ) / 2;

    const inPullbackZone =
      price >= entryLow &&
      price <= entryHigh * 1.01;

    const riskRange =
      Math.max(
        resistance - support,
        price * 0.05
      );

    const target1 =
      resistance +
      riskRange * 0.5;

    const target2 =
      resistance +
      riskRange;

    const invalidation =
      support;

    const riskPerShare =
      Math.max(
        price -
        invalidation,
        0.01
      );

    const riskRewardTarget1 =
      Math.max(
        target1 - price,
        0
      ) /
      riskPerShare;

    const riskRewardTarget2 =
      Math.max(
        target2 - price,
        0
      ) /
      riskPerShare;

    let riskRewardQuality =
      "POOR";

    if (
      riskRewardTarget1 >= 3
    ) {
      riskRewardQuality =
        "EXCELLENT";
    } else if (
      riskRewardTarget1 >= 2
    ) {
      riskRewardQuality =
        "ATTRACTIVE";
    } else if (
      riskRewardTarget1 >= 1.5
    ) {
      riskRewardQuality =
        "ACCEPTABLE";
    }

    // ==========================================================
    // FUNDAMENTAL DATA
    // ==========================================================

    const companyName =
      overviewData.Name ||
      symbol;

    const sector =
      overviewData.Sector ||
      "—";

    const industry =
      overviewData.Industry ||
      "—";

    const marketCap =
      firstNumber(
        overviewData.MarketCapitalization
      );

    const pe =
      firstNumber(
        overviewData.PERatio
      );

    const peg =
      firstNumber(
        overviewData.PEGRatio
      );

    const eps =
      firstNumber(
        overviewData.EPS
      );

    const bookValue =
      firstNumber(
        overviewData.BookValue
      );

    const profitMargin =
      firstNumber(
        overviewData.ProfitMargin
      );

    const operatingMargin =
      firstNumber(
        overviewData.OperatingMarginTTM,
        overviewData.OperatingMargin
      );

    const returnOnAssets =
      firstNumber(
        overviewData.ReturnOnAssetsTTM
      );

    const returnOnEquity =
      firstNumber(
        overviewData.ReturnOnEquityTTM
      );

    const revenueTTM =
      firstNumber(
        overviewData.RevenueTTM
      );

    const quarterlyRevenueGrowth =
      firstNumber(
        overviewData.QuarterlyRevenueGrowthYOY
      );

    const quarterlyEarningsGrowth =
      firstNumber(
        overviewData.QuarterlyEarningsGrowthYOY
      );

    const dividendYield =
      firstNumber(
        overviewData.DividendYield
      );

    // ==========================================================
    // ANNUAL INCOME STATEMENTS
    // ==========================================================

    const annualReports =
      Array.isArray(
        incomeData.annualReports
      )
        ? incomeData.annualReports
        : [];

    const annualFinancials =
      annualReports
        .slice(0, 5)
        .map((report) => ({
          fiscalDateEnding:
            report.fiscalDateEnding,

          revenue:
            firstNumber(
              report.totalRevenue
            ),

          grossProfit:
            firstNumber(
              report.grossProfit
            ),

          operatingIncome:
            firstNumber(
              report.operatingIncome
            ),

          netIncome:
            firstNumber(
              report.netIncome,
              report.netIncomeApplicableToCommonShares
            ),

          eps:
            firstNumber(
              report.reportedEPS,
              report.eps
            ),

          ebitda:
            firstNumber(
              report.ebitda
            )
        }));

    const latestAnnual =
      annualFinancials[0];

    const previousAnnual =
      annualFinancials[1];

    const revenueGrowth =
      latestAnnual &&
      previousAnnual
        ? growth(
            latestAnnual.revenue,
            previousAnnual.revenue
          )
        : quarterlyRevenueGrowth;

    const profitGrowth =
      latestAnnual &&
      previousAnnual
        ? growth(
            latestAnnual.netIncome,
            previousAnnual.netIncome
          )
        : quarterlyEarningsGrowth;

    const epsGrowth =
      latestAnnual &&
      previousAnnual &&
      latestAnnual.eps !== null &&
      previousAnnual.eps !== null
        ? growth(
            latestAnnual.eps,
            previousAnnual.eps
          )
        : quarterlyEarningsGrowth;

    const latestProfitMargin =
      latestAnnual &&
      latestAnnual.revenue &&
      latestAnnual.netIncome !== null
        ? (
            latestAnnual.netIncome /
            latestAnnual.revenue
          ) * 100
        : profitMargin !== null
          ? profitMargin * 100
          : null;

    // ==========================================================
    // GROWTH TREND
    // ==========================================================

    let growthScore =
      50;

    if (
      revenueGrowth !== null
    ) {
      if (revenueGrowth >= 15) {
        growthScore += 25;
      } else if (
        revenueGrowth >= 8
      ) {
        growthScore += 18;
      } else if (
        revenueGrowth > 0
      ) {
        growthScore += 8;
      } else {
        growthScore -= 15;
      }
    }

    if (
      profitGrowth !== null
    ) {
      if (profitGrowth >= 15) {
        growthScore += 20;
      } else if (
        profitGrowth >= 5
      ) {
        growthScore += 12;
      } else if (
        profitGrowth < 0
      ) {
        growthScore -= 15;
      }
    }

    growthScore =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(growthScore)
        )
      );

    let growthTrend =
      "STABLE";

    if (
      growthScore >= 70
    ) {
      growthTrend =
        "STRONG";
    } else if (
      growthScore >= 55
    ) {
      growthTrend =
        "POSITIVE";
    } else if (
      growthScore < 40
    ) {
      growthTrend =
        "WEAK";
    }

    // ==========================================================
    // PROFITABILITY SCORE
    // ==========================================================

    let profitabilityScore =
      50;

    if (
      profitMargin !== null
    ) {
      const margin =
        profitMargin * 100;

      if (margin >= 20) {
        profitabilityScore += 20;
      } else if (
        margin >= 10
      ) {
        profitabilityScore += 10;
      } else if (
        margin < 0
      ) {
        profitabilityScore -= 25;
      }
    }

    if (
      operatingMargin !== null
    ) {
      const margin =
        operatingMargin * 100;

      if (margin >= 20) {
        profitabilityScore += 15;
      } else if (
        margin >= 10
      ) {
        profitabilityScore += 8;
      }
    }

    if (
      returnOnEquity !== null
    ) {
      const roe =
        returnOnEquity * 100;

      if (roe >= 20) {
        profitabilityScore += 15;
      } else if (
        roe >= 10
      ) {
        profitabilityScore += 8;
      }
    }

    if (
      profitGrowth !== null &&
      profitGrowth > 0
    ) {
      profitabilityScore += 10;
    }

    profitabilityScore =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            profitabilityScore
          )
        )
      );

    let profitabilityTrend =
      "STABLE";

    if (
      profitabilityScore >= 75
    ) {
      profitabilityTrend =
        "STRONG";
    } else if (
      profitabilityScore >= 55
    ) {
      profitabilityTrend =
        "HEALTHY";
    } else if (
      profitabilityScore < 40
    ) {
      profitabilityTrend =
        "WEAK";
    }

    // ==========================================================
    // VALUATION
    // ==========================================================

    let valuationScore =
      50;

    if (
      pe !== null
    ) {
      if (pe > 0 && pe < 20) {
        valuationScore += 20;
      } else if (
        pe >= 20 &&
        pe < 30
      ) {
        valuationScore += 10;
      } else if (
        pe >= 40
      ) {
        valuationScore -= 15;
      }
    }

    if (
      peg !== null
    ) {
      if (peg > 0 && peg < 1.5) {
        valuationScore += 15;
      } else if (
        peg >= 2
      ) {
        valuationScore -= 10;
      }
    }

    valuationScore =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            valuationScore
          )
        )
      );

    let valuationView =
      "FAIR";

    if (
      valuationScore >= 70
    ) {
      valuationView =
        "ATTRACTIVE";
    } else if (
      valuationScore < 40
    ) {
      valuationView =
        "EXPENSIVE";
    }

    // ==========================================================
    // COMPANY HEALTH
    // ==========================================================

    const healthScore =
      Math.round(
        growthScore * 0.40 +
        profitabilityScore * 0.40 +
        valuationScore * 0.20
      );

    let healthStatus =
      "AVERAGE";

    if (
      healthScore >= 80
    ) {
      healthStatus =
        "EXCELLENT";
    } else if (
      healthScore >= 65
    ) {
      healthStatus =
        "HEALTHY";
    } else if (
      healthScore < 45
    ) {
      healthStatus =
        "WEAK";
    }

    // ==========================================================
    // NEWS
    // ==========================================================

    const rawNews =
      Array.isArray(
        newsData.feed
      )
        ? newsData.feed
        : [];

    const news =
      rawNews
        .slice(0, 6)
        .map((item) => ({
          title:
            item.title ||
            "Untitled",

          source:
            item.source ||
            "Unknown source",

          url:
            item.url ||
            null,

          timePublished:
            item.time_published ||
            null,

          summary:
            item.summary ||
            "",

          sentimentScore:
            firstNumber(
              item.overall_sentiment_score
            ),

          sentiment:
            item.overall_sentiment_label ||
            "Neutral"
        }));

    const sentimentScores =
      news
        .map(
          (x) =>
            x.sentimentScore
        )
        .filter(
          Number.isFinite
        );

    const newsSentimentScore =
      sentimentScores.length
        ? average(
            sentimentScores
          )
        : null;

    let newsSentiment =
      "NEUTRAL";

    if (
      newsSentimentScore !== null
    ) {
      if (
        newsSentimentScore >= 0.15
      ) {
        newsSentiment =
          "POSITIVE";
      } else if (
        newsSentimentScore <= -0.15
      ) {
        newsSentiment =
          "NEGATIVE";
      }
    }

    // ==========================================================
    // TECHNICAL SCORE
    // ==========================================================

    let technicalScore =
      50;

    if (
      trend === "BULLISH"
    ) {
      technicalScore += 15;
    }

    if (
      structureDirection ===
      "BULLISH"
    ) {
      technicalScore += 12;
    }

    if (
      macd.histogram !== null &&
      macd.histogram > 0
    ) {
      technicalScore += 10;
    }

    if (
      rsi !== null &&
      rsi >= 45 &&
      rsi <= 70
    ) {
      technicalScore += 8;
    }

    if (
      candleSignal === "BULLISH"
    ) {
      technicalScore += 5;
    }

    if (
      relativeVolume !== null &&
      relativeVolume >= 1.1
    ) {
      technicalScore += 5;
    }

    if (
      trend === "BEARISH"
    ) {
      technicalScore -= 15;
    }

    if (
      structureDirection ===
      "BEARISH"
    ) {
      technicalScore -= 12;
    }

    technicalScore =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            technicalScore
          )
        )
      );

    // ==========================================================
    // OVERALL INVESTMENT SCORE
    // ==========================================================

    let newsScore =
      50;

    if (
      newsSentiment === "POSITIVE"
    ) {
      newsScore = 75;
    }

    if (
      newsSentiment === "NEGATIVE"
    ) {
      newsScore = 25;
    }

    const investmentScore =
      Math.round(
        healthScore * 0.30 +
        growthScore * 0.20 +
        profitabilityScore * 0.15 +
        valuationScore * 0.15 +
        technicalScore * 0.15 +
        newsScore * 0.05
      );

    // ==========================================================
    // DECISION
    // ==========================================================

    let decision =
      "WATCH";

    let decisionReason =
      "The company and market setup need more confirmation.";

    if (
      investmentScore >= 80 &&
      technicalScore >= 65 &&
      healthScore >= 65
    ) {
      decision =
        "STRONG BUY";

      decisionReason =
        "Strong company fundamentals combined with a supportive market setup.";
    } else if (
      investmentScore >= 68 &&
      healthScore >= 60
    ) {
      decision =
        "BUY";

      decisionReason =
        "The company fundamentals are attractive and the setup offers potential upside.";
    } else if (
      investmentScore <= 35
    ) {
      decision =
        "AVOID";

      decisionReason =
        "Fundamental health and/or market conditions are weak.";
    }

    if (
      technicalScore < 40 &&
      decision === "BUY"
    ) {
      decision =
        "WATCH";

      decisionReason =
        "The company is fundamentally attractive, but the technical entry is not yet supportive.";
    }

    // ==========================================================
    // CONDITIONS
    // ==========================================================

    const conditions = {
      healthyCompany:
        healthScore >= 65,

      revenueGrowing:
        revenueGrowth !== null &&
        revenueGrowth > 0,

      profitsGrowing:
        profitGrowth !== null &&
        profitGrowth > 0,

      profitable:
        profitabilityScore >= 60,

      valuationReasonable:
        valuationScore >= 50,

      technicalSupport:
        technicalScore >= 55
    };

    const conditionsMet =
      Object.values(
        conditions
      ).filter(Boolean).length;

    // ==========================================================
    // REASONS / RISKS
    // ==========================================================

    const reasons = [];

    if (
      healthScore >= 70
    ) {
      reasons.push(
        "Company health is strong."
      );
    }

    if (
      revenueGrowth !== null &&
      revenueGrowth > 0
    ) {
      reasons.push(
        `Revenue is growing ${round(
          revenueGrowth,
          1
        )}% year over year.`
      );
    }

    if (
      profitGrowth !== null &&
      profitGrowth > 0
    ) {
      reasons.push(
        `Profit is growing ${round(
          profitGrowth,
          1
        )}% year over year.`
      );
    }

    if (
      technicalScore >= 65
    ) {
      reasons.push(
        "Technical momentum is supportive."
      );
    }

    if (
      newsSentiment === "POSITIVE"
    ) {
      reasons.push(
        "Recent news sentiment is positive."
      );
    }

    const risks = [];

    if (
      revenueGrowth !== null &&
      revenueGrowth < 0
    ) {
      risks.push(
        "Revenue is declining."
      );
    }

    if (
      profitGrowth !== null &&
      profitGrowth < 0
    ) {
      risks.push(
        "Profit is declining."
      );
    }

    if (
      valuationScore < 40
    ) {
      risks.push(
        "Valuation appears expensive."
      );
    }

    if (
      technicalScore < 45
    ) {
      risks.push(
        "Technical setup is weak."
      );
    }

    if (
      newsSentiment === "NEGATIVE"
    ) {
      risks.push(
        "Recent news sentiment is negative."
      );
    }

    if (!reasons.length) {
      reasons.push(
        "No major positive factor detected yet."
      );
    }

    if (!risks.length) {
      risks.push(
        "No major risk detected from the available data."
      );
    }

    // ==========================================================
    // RESPONSE
    // ==========================================================

    return res.status(200).json({

      // ----------------------------
      // Basic
      // ----------------------------

      symbol,

      name:
        companyName,

      sector,

      industry,

      price:
        round(price),

      change:
        round(change),

      change_pct:
        round(changePct),

      // ----------------------------
      // Main decision
      // ----------------------------

      decision,

      decision_reason:
        decisionReason,

      score:
        investmentScore,

      // ----------------------------
      // Company health
      // ----------------------------

      company_health: {
        score:
          healthScore,

        status:
          healthStatus
      },

      // ----------------------------
      // Growth
      // ----------------------------

      growth: {

        score:
          growthScore,

        trend:
          growthTrend,

        revenue_growth:
          round(
            revenueGrowth,
            1
          ),

        profit_growth:
          round(
            profitGrowth,
            1
          ),

        eps_growth:
          round(
            epsGrowth,
            1
          ),

        quarterly_revenue_growth:
          round(
            quarterlyRevenueGrowth,
            1
          ),

        quarterly_earnings_growth:
          round(
            quarterlyEarningsGrowth,
            1
          ),

        history:
          annualFinancials
            .map((x) => ({
              year:
                x.fiscalDateEnding,

              revenue:
                x.revenue,

              profit:
                x.netIncome,

              eps:
                x.eps
            }))
            .reverse()
      },

      // ----------------------------
      // Profitability
      // ----------------------------

      profitability: {

        score:
          profitabilityScore,

        trend:
          profitabilityTrend,

        profit_margin:
          round(
            latestProfitMargin,
            1
          ),

        operating_margin:
          operatingMargin !== null
            ? round(
                operatingMargin * 100,
                1
              )
            : null,

        roe:
          returnOnEquity !== null
            ? round(
                returnOnEquity * 100,
                1
              )
            : null,

        roa:
          returnOnAssets !== null
            ? round(
                returnOnAssets * 100,
                1
              )
            : null
      },

      // ----------------------------
      // Valuation
      // ----------------------------

      valuation: {

        score:
          valuationScore,

        view:
          valuationView,

        pe:
          round(pe, 2),

        peg:
          round(peg, 2),

        eps:
          round(eps, 2),

        book_value:
          round(bookValue, 2),

        market_cap:
          marketCap
      },

      // ----------------------------
      // News
      // ----------------------------

      news_sentiment:
        newsSentiment,

      news_sentiment_score:
        round(
          newsSentimentScore,
          3
        ),

      news,

      // ----------------------------
      // Technical
      // ----------------------------

      technical_score:
        technicalScore,

      trend,

      trend_score:
        trendScore,

      trend_confidence:
        Math.max(
          0,
          Math.min(
            100,
            Math.round(
              technicalScore
            )
          )
        ),

      short_term_trend:
        shortTermTrend,

      structure,

      structure_direction:
        structureDirection,

      sma20:
        round(sma20),

      sma50:
        round(sma50),

      rsi:
        round(rsi),

      macd:
        round(
          macd.macd,
          4
        ),

      macd_signal:
        round(
          macd.signal,
          4
        ),

      macd_histogram:
        round(
          macd.histogram,
          4
        ),

      support:
        round(support),

      resistance:
        round(resistance),

      relative_volume:
        round(
          relativeVolume,
          2
        ),

      volume_confirmation:
        volumeConfirmation,

      candle: {
        pattern:
          candlePattern,

        signal:
          candleSignal,

        strength:
          candleStrength
      },

      candle_pattern:
        candlePattern,

      candle_signal:
        candleSignal,

      candle_strength:
        candleStrength,

      // ----------------------------
      // Entry
      // ----------------------------

      entry_low:
        round(entryLow),

      entry_high:
        round(entryHigh),

      preferred_entry:
        round(preferredEntry),

      in_pullback_zone:
        inPullbackZone,

      invalidation:
        round(invalidation),

      stop:
        round(invalidation),

      target1:
        round(target1),

      target2:
        round(target2),

      breakout_level:
        round(breakoutLevel),

      buy_trigger_price:
        round(
          buyTriggerPrice
        ),

      buy_trigger_confirmed:
        breakoutConfirmed,

      breakout_confirmed:
        breakoutConfirmed,

      // ----------------------------
      // Risk / reward
      // ----------------------------

      risk_per_share:
        round(
          riskPerShare
        ),

      risk_reward_target1:
        round(
          riskRewardTarget1,
          2
        ),

      risk_reward_target2:
        round(
          riskRewardTarget2,
          2
        ),

      risk_reward_quality:
        riskRewardQuality,

      // ----------------------------
      // Conditions
      // ----------------------------

      conditions,

      conditions_met:
        conditionsMet,

      conditions_total:
        Object.keys(
          conditions
        ).length,

      // ----------------------------
      // Reasons / risks
      // ----------------------------

      reasons,

      risks,

      // ----------------------------
      // Historical chart
      // ----------------------------

      history:
        history.map((x) => ({
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
            round(x.rsi),

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
        })),

      last_updated:
        latest.date
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error: "Analysis failed",
      message:
        error.message ||
        "Unknown error"
    });
  }
}
