# Investment Cockpit V2 — Live API

Upload `index.html`, `vercel.json`, and the `api` folder to the existing GitHub repository.

## Vercel secret
In Vercel: Project → Settings → Environment Variables → add:
Name: `ALPHAVANTAGE_API_KEY`
Value: your private Alpha Vantage key
Environment: Production (and Preview if desired)

Redeploy after saving.

The browser calls `/api/stock?ticker=NVDA`; the server calls Alpha Vantage, so the API key is not exposed to the iPhone.

V2 currently provides a real live quote and a conservative WATCH placeholder score. Do not treat it as a completed investment strategy yet.
