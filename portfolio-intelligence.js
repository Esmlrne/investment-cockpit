/* Portfolio Intelligence — Investment Cockpit */

(function () {
  "use strict";

  const STORAGE_KEY = "investmentCockpitPortfolio";
  const INTEL_KEY = "investmentCockpitIntelligence";

  const CONFIG = {
    weights: {
      qualityGrowth: 0.50,
      valuation: 0.20,
      diversification: 0.15,
      profitability: 0.10,
      technical: 0.05
    },
    targetMin: 2,
    targetMax: 10,
    maxSinglePosition: 12
  };

  function readPortfolio() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(v, min = 0, max = 100) {
    return Math.max(min, Math.min(max, v));
  }

  function normalizeScore(v, fallback = 50) {
    return clamp(num(v, fallback));
  }

  function holdingValue(h) {
    const shares = num(h.shares);
    const price = num(h.price);
    const marketValue = num(h.marketValue);

    if (marketValue > 0) return marketValue;
    if (shares > 0 && price > 0) return shares * price;

    return 0;
  }

  function qualityScore(a) {
    const health = normalizeScore(
      a?.company_health?.score,
      50
    );

    const growth = normalizeScore(
      a?.growth?.score,
      50
    );

    return clamp(
      health * 0.55 +
      growth * 0.45
    );
  }

  function valuationScore(a) {
    return normalizeScore(
      a?.valuation?.score,
      50
    );
  }

  function profitabilityScore(a) {
    const profitability =
      normalizeScore(
        a?.profitability?.score,
        50
      );

    const health =
      normalizeScore(
        a?.company_health?.score,
        50
      );

    return clamp(
      profitability * 0.75 +
      health * 0.25
    );
  }

  function technicalScore(a) {
    return normalizeScore(
      a?.technical_score,
      a?.score ?? 50
    );
  }

  function buildItems() {
    return readPortfolio()
      .map(h => {
        const ticker = String(
          h.ticker ||
          h.symbol ||
          ""
        ).toUpperCase();

        return {
          holding: h,
          ticker,
          value: holdingValue(h),
          analysis:
            h.analysis ||
            h.stockAnalysis ||
            {}
        };
      })
      .filter(x => x.ticker);
  }

  function calculateDiversification(items) {
    if (!items.length) return 0;

    const total =
      items.reduce(
        (sum, x) => sum + x.value,
        0
      );

    if (!total) return 0;

    items.forEach(x => {
      x.weight =
        x.value / total;
    });

    const largest =
      Math.max(
        ...items.map(x => x.weight)
      );

    const hhi =
      items.reduce(
        (sum, x) =>
          sum +
          x.weight * x.weight,
        0
      );

    let score = 100;

    if (largest > 0.20) {
      score -= 45;
    } else if (largest > 0.15) {
      score -= 30;
    } else if (largest > 0.12) {
      score -= 18;
    } else if (largest > 0.10) {
      score -= 8;
    }

    score -= clamp(
      (hhi - 0.05) * 120,
      0,
      35
    );

    return clamp(score);
  }

  function calculate(items) {
    const total =
      items.reduce(
        (sum, x) => sum + x.value,
        0
      );

    if (!total) {
      return {
        items,
        total: 0,
        health: 0,
        diversification: 0
      };
    }

    items.forEach(x => {
      x.weight =
        x.value / total;

      const quality =
        qualityScore(
          x.analysis
        );

      const valuation =
        valuationScore(
          x.analysis
        );

      const profitability =
        profitabilityScore(
          x.analysis
        );

      const technical =
        technicalScore(
          x.analysis
        );

      x.components = {
        qualityGrowth: quality,
        valuation,
        profitability,
        technical
      };
    });

    const diversification =
      calculateDiversification(
        items
      );

    items.forEach(x => {

      x.intelligenceScore =
        clamp(
          x.components
            .qualityGrowth *
            CONFIG.weights
              .qualityGrowth +

          x.components
            .valuation *
            CONFIG.weights
              .valuation +

          diversification *
            CONFIG.weights
              .diversification +

          x.components
            .profitability *
            CONFIG.weights
              .profitability +

          x.components
            .technical *
            CONFIG.weights
              .technical
        );

      const weightPct =
        x.weight * 100;

      let action = "HOLD";
      let reason =
        "Good risk/reward balance at the current weight.";

      if (
        weightPct >
        CONFIG.maxSinglePosition
      ) {
        action = "REDUCE";

        reason =
          "Position is already highly concentrated.";

      } else if (
        x.intelligenceScore >= 80 &&
        weightPct < 5
      ) {
        action = "ADD";

        reason =
          "High-quality opportunity and materially underweight.";

      } else if (
        x.intelligenceScore >= 75 &&
        weightPct < 8
      ) {
        action = "ADD";

        reason =
          "Strong long-term score with room to increase.";

      } else if (
        x.intelligenceScore < 50
      ) {
        action = "REDUCE";

        reason =
          "Weak portfolio contribution versus alternatives.";

      } else if (
        x.intelligenceScore < 60
      ) {
        action = "HOLD";

        reason =
          "Mixed fundamentals or valuation; wait for improvement.";

      } else if (
        weightPct >= 10
      ) {
        action = "HOLD";

        reason =
          "Strong holding, but already a meaningful portfolio weight.";
      }

      x.action = action;
      x.reason = reason;

      let target = 2;

      if (
        x.intelligenceScore >= 85
      ) {
        target = 10;
      } else if (
        x.intelligenceScore >= 78
      ) {
        target = 8;
      } else if (
        x.intelligenceScore >= 70
      ) {
        target = 6;
      } else if (
        x.intelligenceScore >= 60
      ) {
        target = 4;
      }

      if (action === "REDUCE") {
        target =
          Math.min(target, 5);
      }

      x.targetWeight = target;

      x.gap =
        target -
        weightPct;
    });

    const health =
      items.reduce(
        (sum, x) =>
          sum +
          x.intelligenceScore *
          x.weight,
        0
      );

    return {
      items,
      total,
      health: clamp(health),
      diversification
    };
  }

  function euro(value) {
    return new Intl.NumberFormat(
      "en-US",
      {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0
      }
    ).format(
      num(value)
    );
  }

  function pct(value) {
    return (
      num(value).toFixed(1) +
      "%"
    );
  }

  function ensureStyles() {

    if (
      document.getElementById(
        "portfolio-intelligence-style"
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        "style"
      );

    style.id =
      "portfolio-intelligence-style";

    style.textContent = `
      #portfolio-intelligence {
        margin: 24px 0;
        font-family: inherit;
      }

      .pi-card {
        border: 1px solid rgba(128,128,128,.22);
        border-radius: 16px;
        padding: 18px;
        margin-bottom: 14px;
        background: rgba(128,128,128,.05);
      }

      .pi-grid {
        display: grid;
        grid-template-columns:
          repeat(4,minmax(0,1fr));
        gap: 12px;
      }

      .pi-metric {
        padding: 14px;
        border-radius: 12px;
        background: rgba(128,128,128,.08);
      }

      .pi-label {
        font-size: 12px;
        opacity: .7;
        margin-bottom: 5px;
      }

      .pi-value {
        font-size: 25px;
        font-weight: 750;
      }

      .pi-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      .pi-table th,
      .pi-table td {
        padding: 9px 7px;
        border-bottom:
          1px solid rgba(128,128,128,.16);
        text-align: left;
      }

      .pi-table th {
        opacity: .7;
        font-weight: 600;
      }

      .pi-action {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 999px;
        font-weight: 700;
        font-size: 11px;
      }

      .pi-add {
        background:
          rgba(40,180,90,.15);
      }

      .pi-hold {
        background:
          rgba(100,130,180,.15);
      }

      .pi-reduce {
        background:
          rgba(220,80,70,.15);
      }

      .pi-muted {
        opacity: .7;
        font-size: 12px;
      }

      .pi-two {
        display: grid;
        grid-template-columns:
          1fr 1fr;
        gap: 14px;
      }

      .pi-bar {
        height: 8px;
        border-radius: 99px;
        background:
          rgba(128,128,128,.16);
        overflow: hidden;
      }

      .pi-bar span {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: currentColor;
      }

      @media(max-width:760px) {

        .pi-grid {
          grid-template-columns:
            1fr 1fr;
        }

        .pi-two {
          grid-template-columns:
            1fr;
        }

        .pi-table {
          font-size: 12px;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function findPortfolioContainer() {

    const selectors = [
      "#portfolio",
      "#portfolioTab",
      ".portfolio-container",
      "[data-tab='portfolio']",
      "[data-section='portfolio']"
    ];

    for (
      const selector of selectors
    ) {
      const el =
        document.querySelector(
          selector
        );

      if (el) {
        return el;
      }
    }

    const elements =
      [
        ...document.querySelectorAll(
          "h1,h2,h3,h4,button"
        )
      ];

    const match =
      elements.find(el =>
        /my portfolio/i.test(
          el.textContent || ""
        )
      );

    return (
      match?.parentElement ||
      document.body
    );
  }

  function render() {

    ensureStyles();

    const old =
      document.getElementById(
        "portfolio-intelligence"
      );

    if (old) {
      old.remove();
    }

    const result =
      calculate(
        buildItems()
      );

    const section =
      document.createElement(
        "section"
      );

    section.id =
      "portfolio-intelligence";

    if (
      !result.items.length
    ) {

      section.innerHTML = `
        <div class="pi-card">
          <h2>Portfolio Intelligence</h2>

          <div class="pi-muted">
            Add holdings and refresh prices
            to activate portfolio intelligence.
          </div>
        </div>
      `;

      findPortfolioContainer()
        .appendChild(section);

      return;
    }

    const ranked =
      result.items
        .slice()
        .sort(
          (a,b) =>
            b.intelligenceScore -
            a.intelligenceScore
        );

    const adds =
      ranked
        .filter(
          x =>
            x.action === "ADD"
        )
        .slice(0,5);

    const reduces =
      ranked
        .filter(
          x =>
            x.action === "REDUCE"
        )
        .slice(0,5);

    const allocation =
      [1500,1250,1000,750,500];

    section.innerHTML = `

      <div class="pi-card">

        <div style="
          display:flex;
          justify-content:space-between;
          gap:12px;
          align-items:center;
          flex-wrap:wrap;
        ">

          <div>

            <h2 style="
              margin:0 0 5px;
            ">
              Portfolio Intelligence
            </h2>

            <div class="pi-muted">
              Long-term investor framework
              • quality first
              • valuation-aware
              • concentration controlled
            </div>

          </div>

          <strong>
            ${result.health >= 80
              ? "STRONG"
              : result.health >= 70
              ? "HEALTHY"
              : result.health >= 55
              ? "REVIEW"
              : "ACTION REQUIRED"}
          </strong>

        </div>

        <div
          class="pi-grid"
          style="margin-top:14px;"
        >

          <div class="pi-metric">

            <div class="pi-label">
              Portfolio Health
            </div>

            <div class="pi-value">
              ${Math.round(
                result.health
              )}/100
            </div>

          </div>

          <div class="pi-metric">

            <div class="pi-label">
              Holdings
            </div>

            <div class="pi-value">
              ${result.items.length}
            </div>

          </div>

          <div class="pi-metric">

            <div class="pi-label">
              Diversification
            </div>

            <div class="pi-value">
              ${Math.round(
                result.diversification
              )}/100
            </div>

          </div>

          <div class="pi-metric">

            <div class="pi-label">
              Portfolio Value
            </div>

            <div class="pi-value"
              style="font-size:20px;"
            >
              ${euro(result.total)}
            </div>

          </div>

        </div>

      </div>

      <div class="pi-two">

        <div class="pi-card">

          <h3 style="margin-top:0;">
            Where should I put my next €5,000?
          </h3>

          <div class="pi-muted"
            style="margin-bottom:12px;"
          >
            Based on the portfolio's current
            quality, valuation, diversification
            and position sizing.
          </div>

          ${
            adds.length
            ? adds.map(
                (x,i) => `
                  <div style="
                    display:flex;
                    justify-content:space-between;
                    gap:10px;
                    padding:9px 0;
                    border-bottom:
                      1px solid
                      rgba(128,128,128,.14);
                  ">

                    <div>

                      <strong>
                        ${i + 1}. ${x.ticker}
                      </strong>

                      <div class="pi-muted">
                        ${x.reason}
                      </div>

                    </div>

                    <strong>
                      ${euro(
                        allocation[i]
                      )}
                    </strong>

                  </div>
                `
              ).join("")
            : `
              <div class="pi-muted">
                No position currently qualifies
                for a strong new allocation.
              </div>
            `
          }

        </div>

        <div class="pi-card">

          <h3 style="margin-top:0;">
            Portfolio Watch-outs
          </h3>

          ${
            reduces.length
            ? reduces.map(
                x => `
                  <div style="
                    padding:9px 0;
                    border-bottom:
                      1px solid
                      rgba(128,128,128,.14);
                  ">

                    <strong>
                      ${x.ticker}
                    </strong>

                    <span class="
                      pi-action
                      pi-reduce
                    ">
                      REDUCE
                    </span>

                    <div class="pi-muted">
                      ${pct(
                        x.weight * 100
                      )}
                      current vs
                      ${pct(
                        x.targetWeight
                      )}
                      target
                      •
                      ${x.reason}
                    </div>

                  </div>
                `
              ).join("")
            : `
              <div class="pi-muted">
                No immediate position-size
                reduction flagged.
              </div>
            `
          }

        </div>

      </div>

      <div class="pi-card">

        <h3 style="margin-top:0;">
          Holding Recommendations
        </h3>

        <div style="overflow-x:auto;">

          <table class="pi-table">

            <thead>

              <tr>
                <th>Stock</th>
                <th>Score</th>
                <th>Weight</th>
                <th>Target</th>
                <th>Gap</th>
                <th>Action</th>
              </tr>

            </thead>

            <tbody>

              ${ranked.map(
                x => `
                  <tr>

                    <td>
                      <strong>
                        ${x.ticker}
                      </strong>
                    </td>

                    <td>
                      ${Math.round(
                        x.intelligenceScore
                      )}
                    </td>

                    <td>
                      ${pct(
                        x.weight * 100
                      )}
                    </td>

                    <td>
                      ${pct(
                        x.targetWeight
                      )}
                    </td>

                    <td>
                      ${
                        x.gap >= 0
                        ? "+"
                        : ""
                      }${pct(x.gap)}
                    </td>

                    <td>

                      <span class="
                        pi-action
                        pi-${String(
                          x.action
                        ).toLowerCase()}
                      ">
                        ${x.action}
                      </span>

                    </td>

                  </tr>
                `
              ).join("")}

            </tbody>

          </table>

        </div>

      </div>

      <div class="pi-card">

        <h3 style="margin-top:0;">
          Investment Framework
        </h3>

        <div class="pi-two">

          <div>

            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:5px;
            ">
              <span>
                Business quality & growth
              </span>
              <strong>50%</strong>
            </div>

            <div class="pi-bar">
              <span style="width:100%;"></span>
            </div>

          </div>

          <div>

            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:5px;
            ">
              <span>Valuation</span>
              <strong>20%</strong>
            </div>

            <div class="pi-bar">
              <span style="width:40%;"></span>
            </div>

          </div>

          <div>

            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:5px;
            ">
              <span>
                Diversification
              </span>
              <strong>15%</strong>
            </div>

            <div class="pi-bar">
              <span style="width:30%;"></span>
            </div>

          </div>

          <div>

            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:5px;
            ">
              <span>
                Profitability
              </span>
              <strong>10%</strong>
            </div>

            <div class="pi-bar">
              <span style="width:20%;"></span>
            </div>

          </div>

          <div>

            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:5px;
            ">
              <span>
                Technical / entry
              </span>
              <strong>5%</strong>
            </div>

            <div class="pi-bar">
              <span style="width:10%;"></span>
            </div>

          </div>

        </div>

        <div
          class="pi-muted"
          style="margin-top:12px;"
        >
          This is a decision-support framework,
          not a guarantee of future returns.
        </div>

      </div>
    `;

    findPortfolioContainer()
      .appendChild(section);

    try {

      localStorage.setItem(
        INTEL_KEY,
        JSON.stringify({
          updatedAt:
            new Date().toISOString(),

          health:
            result.health,

          diversification:
            result.diversification
        })
      );

    } catch (_) {}
  }

  function boot() {

    render();

    window.addEventListener(
      "storage",
      render
    );

    let last = "";

    setInterval(
      () => {

        try {

          const current =
            localStorage.getItem(
              STORAGE_KEY
            ) || "";

          if (
            current !== last
          ) {

            last = current;

            render();
          }

        } catch (_) {}

      },
      1500
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      boot
    );

  } else {

    boot();
  }

  window
    .InvestmentCockpitPortfolioIntelligence = {
      render,
      calculate
    };

})();
