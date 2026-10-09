# Chart AI

Real-time multi-exchange crypto charting with TradingView Lightweight Charts, deterministic technical analysis, Gemini or Venice AI chat, optional Gemini explanations, and guarded educational signals.

## Market data

- Binance Spot
- Bybit Linear
- OKX Spot
- Aster Perpetual
- Hyperliquid Perpetuals
- MEXC Spot

The searchable market picker combines every exchange reachable from the running server. Historical candles are fetched through the Node API and live candles stream from each exchange WebSocket.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` and/or `VENICE_API_KEY`.
4. Run `npm run dev`.
5. Open `http://localhost:5173`.

For a production-style run, run `npm run build` followed by `npm start`. Express serves both `/api/*` and the built React application.

## Google AI Studio

This project follows Google AI Studio's full-stack security model:

- Gemini calls run only in `server/index.js`.
- The browser never receives the Gemini API key.
- The browser never receives the Venice API key either.
- The server reads `GEMINI_API_KEY` and `VENICE_API_KEY` from the environment.
- The server binds to `0.0.0.0` and respects the injected `PORT` value.
- `npm run build` creates the React client and `npm start` serves the complete app.

Import the repository into Google AI Studio Build mode, open **Settings → Secrets**, and add `GEMINI_API_KEY`. To enable Venice as a chat choice, also add `VENICE_API_KEY` as a server secret. AI Studio injects those secrets into the server-side runtime. The public exchange URLs and `VENICE_API_URL` can remain at the defaults in `.env.example`.

## AI chat

The analyst sidebar includes a free-text conversation panel. Users can choose Gemini or Venice AI, optionally attach the current exchange, pair, timeframe, and deterministic chart analysis, or turn chart context off for crypto education and general reasoning. Conversation history is kept in the browser for the current page session only. Market commentary remains educational and does not execute trades.

## Chart controls

The chart starts clean with overlays disabled. Users can selectively enable:

- EMA 20, EMA 50, SMA 200, rolling VWAP, Bollinger Bands, and Donchian Channel
- Fibonacci retracement, fair value gaps, order blocks, and BOS/CHOCH
- Confirmed swing pivots
- Individually selected support and resistance zones

Visible labels, chart marks, and analysis cards can be clicked for an explanation. Fibonacci levels include percentage and descriptive labels. Support levels are ordered from lowest upward; resistance levels are ordered from highest downward.

## Safety and limitations

- AI signals are educational and not financial advice.
- Users must acknowledge the risk warning before generating a signal.
- The application never executes trades or accesses wallets.
- Exchange availability depends on geography, network policy, maintenance, and rate limits.
- Technical-analysis patterns are deterministic observations, not guarantees of future price movement.
