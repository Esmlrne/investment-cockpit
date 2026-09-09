# Investment Cockpit — iPhone Mobile V1

This is a mobile-first web app that can be opened in Safari and added to the iPhone Home Screen.

## Current version
- iPhone-optimized UI
- Add/remove-ready ticker architecture
- Persistent watchlist using localStorage
- Stock analysis cards
- Investment score
- Buy / Watch / Sell
- Buy zone, targets and invalidation
- Mobile chart
- Clearly labeled demo data

## Important: live data
Do NOT put an Alpha Vantage API key inside index.html. Anyone could see it.

For live data, deploy a small server-side API endpoint (Vercel/Netlify/Cloudflare Worker, etc.) that stores the API key securely and proxies only the permitted data to the app.

The next version should connect:
- `/api/quote?ticker=NVDA`
- `/api/history?ticker=NVDA`
- `/api/fundamentals?ticker=NVDA`
- `/api/news?ticker=NVDA`

Then the frontend will replace the demo provider with those endpoints.

## Easiest iPhone use
1. Host this folder on any static web host.
2. Open the site in Safari.
3. Tap Share → Add to Home Screen.
4. Launch it like an app.

## Roadmap
V2: server-side live API + fundamentals + earnings + news
V3: real investment engine + backtesting
V4: AI analyst + alerts + portfolio
