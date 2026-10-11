# Chart AI

Real-time multi-exchange crypto charting with TradingView Lightweight Charts, deterministic technical analysis, Gemini or Venice AI chat, optional Gemini explanations, and transparent LONG/SHORT/WAIT chart scenarios.

## Market data

- Binance Spot
- Bybit Linear
- OKX Spot
- Aster Perpetual
- Hyperliquid Perpetuals
- MEXC Spot

The searchable market picker combines every exchange reachable from the running server. Historical candles are fetched through the Node API and live candles stream from each exchange WebSocket.

## Run locally

1. Install Node.js 20.9 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and/or `VENICE_API_KEY`.
4. Run `npm run dev`.
5. Open `http://localhost:3001`.

The interface uses the Next.js App Router. The Node API runs alongside it, and Next.js forwards same-origin `/api/*` requests to that service. `npm start` respects the host-provided `PORT` value.

For a production-style run, run `npm run build` followed by `npm start`.

## Deploy to Vercel

Vercel detects the Next.js app and `api/[...path].js` provides the existing Express API endpoints. Add `GEMINI_API_KEY` and/or `VENICE_API_KEY` as server-side Vercel Environment Variables to enable the corresponding AI features. Never add provider keys to the frontend or commit them to the repository.

## Google AI Studio

This project follows Google AI Studio's full-stack security model:

- Gemini calls run only in `server/index.js`.
- The browser never receives the Gemini API key.
- The browser never receives the Venice API key either.
- The server reads `GEMINI_API_KEY` and `VENICE_API_KEY` from the environment.
- The Next.js app binds to `0.0.0.0` and respects the injected `PORT` value; the private API service stays on localhost.
- `npm run build` creates the Next.js app and `npm start` serves the complete app.

Import the repository into Google AI Studio Build mode, open **Settings → Secrets**, and add `GEMINI_API_KEY`. To enable Venice as a chat choice, also add `VENICE_API_KEY` as a server secret. AI Studio injects those secrets into the server-side runtime. The public exchange URLs and `VENICE_API_URL` can remain at the defaults in `.env.example`.

## AI chat

The analyst sidebar includes a free-text conversation panel. Users can choose Gemini or Venice AI, optionally attach the current exchange, pair, timeframe, and deterministic chart analysis, or turn chart context off for crypto education and general reasoning. Conversation history is kept in the browser for the current page session only. Market commentary remains educational and does not execute trades.

## Rule-based chart signals

Signal generation runs locally from completed candles and does not require an AI key or network round trip. Users choose which of seven checks to combine: swing trend, EMA 20/50, SMA 200, rolling VWAP, RSI 14, MACD, and volume expansion. At least two selected checks must agree, and a recent confirmed structure break remains required for every LONG or SHORT. The result shows the checks used and the chart marks the candle-close entry reference, invalidation, and target. A directional setup also needs at least 1.5:1 potential reward-to-risk before the next detected chart barrier; otherwise the result is WAIT with watch levels. These rules do not execute trades or guarantee outcomes.

## Chart controls

The chart starts clean with overlays disabled. Users can selectively enable:

- EMA 20, EMA 50, SMA 200, rolling VWAP, Bollinger Bands, and Donchian Channel
- Fibonacci retracement, fair value gaps, order blocks, and BOS/CHOCH
- Confirmed swing pivots
- Individually selected support and resistance zones

Visible labels, chart marks, and analysis cards can be clicked for an explanation. Fibonacci levels include percentage and descriptive labels. Support levels are ordered from lowest upward; resistance levels are ordered from highest downward.

## Demo copy trading

Demo traders get a signed, anonymous browser identity. Sharing is private by default; a user must choose a display name and enable sharing before appearing in the public trader list. Followers can choose a 50%–200% copy size. New demo opens and closes are published by the server and polled every 2.5 seconds while the app is open. A copied position is sized from the follower's own demo balance and the source trade's risk, and it is closed when the source trade closes. No exchange orders are sent.

Local development uses an in-memory shared room so multiple browser sessions on the same running server can try the feature. That room resets when the server restarts. For a persistent Vercel deployment, create a Supabase project, run [`supabase/copy-trading.sql`](supabase/copy-trading.sql) in its SQL editor, and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a long random `DEMO_TRADING_SECRET` as server-side environment variables. Redeploy after setting them. The service role key must never be added to frontend variables. Without this database setup, Vercel disables copy-trading endpoints instead of presenting a non-persistent room as a real shared feature.

## Safety and limitations

- AI signals are educational and not financial advice.
- Users must acknowledge the risk warning before generating a signal.
- The application never executes trades or accesses wallets.
- Exchange availability depends on geography, network policy, maintenance, and rate limits.
- Technical-analysis patterns are deterministic observations, not guarantees of future price movement.
