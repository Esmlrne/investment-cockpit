# Investment Cockpit V2 — Live API

This corrected V2 removes the custom `vercel.json` runtime configuration that caused the deployment error. Vercel will auto-detect the Node.js API function in `api/stock.js`.

## Upload
Replace the existing `index.html` and add/replace the `api/stock.js` file. You do not need a `vercel.json`.

## Vercel secret
In Vercel: Project → Settings → Environment Variables → add:
Name: `ALPHAVANTAGE_API_KEY`
Value: your private Alpha Vantage key
Environment: Production (and Preview if desired)

Redeploy after saving.

The browser calls `/api/stock?ticker=NVDA`; the server calls Alpha Vantage, so the API key is not exposed to the iPhone.

V2 currently provides a real live quote and a conservative WATCH placeholder score. Do not treat it as a completed investment strategy yet.
