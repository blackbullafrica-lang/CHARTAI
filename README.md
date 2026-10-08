# Chart AI — Phase 1

Minimalist crypto charting application, React + TypeScript + Lightweight Charts v5 and Express/Node. Includes three exchange adapters and optional Gemini interpretation of deterministic chart statistics.

## Exchanges
- **Binance Spot:** 500 historical candles + WebSocket candle streaming.
- **Bybit Linear USDT perpetuals:** 500 historical candles + refresh polling every 10 seconds.
- **OKX Spot:** 300 historical candles + refresh polling every 10 seconds.

Use exchange-specific listed symbols only, e.g. BTCUSDT. Aster ANSEM/USDT is NOT supported yet. Polling data is not tick-by-tick streaming. Geographic/API restrictions may limit upstream connectivity. Unsupported symbols raise an error instead of substituting prices.

## Run locally
1. Install Node.js 20+ (22 recommended).
2. Unzip and open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` (Gemini is optional).
5. Run `npm run dev`.
6. Open http://localhost:5173.

`npm run build` generates frontend assets only; `npm run server` runs the API, default port 3001. During development Vite proxies `/api` to the API server. Production deployment needs an HTTPS API reverse proxy or same-origin backend.

## Features
- Exchange selector and pair input, six timeframes
- Interactive candlesticks, zoom, pan and crosshair
- Confirmed three-bar swing pivots
- ATR-clustered price levels and basic market trend classification
- Overlays can be toggled
- Gemini AI summary from structured analysis (requires server-side `GEMINI_API_KEY`)
- Exchange errors and live/refresh status

## Important limitations
- This is a Phase 1 engineering starter, not a validated trading strategy or production-grade data terminal.
- Tested Node server syntax and checked project assets; **could not install npm dependencies in the build environment**, so the frontend compilation and live exchange access have not been verified. Run `npm install` and `npm run build` on your computer.
- No automated trades or wallet access. No reliable probability estimates.
- Server currently accepts client-submitted analysis for the AI explanation endpoint; before public deployment calculate and validate those statistics server-side and add input/rate limits.
- Market data may lag, rate-limit, or be unavailable. Add reconnect/backoff, caching, request throttling and monitoring before public deployment.

## AI Studio
Push this folder to a GitHub repository, then import it into Google AI Studio Build mode or your development workspace. Ask the AI coding agent to run `npm install`, `npm run build`, and fix any errors. Keep `GEMINI_API_KEY` server-only.

## Next phase
Aster integration for ANSEM/USDT (subject to a supported market-data endpoint), real-time Bybit/OKX WebSockets, drawing zones as filled primitives, structure breaks and educational AI chat.
