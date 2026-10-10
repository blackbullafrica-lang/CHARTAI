import express from "express";
import cors from "cors";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import copyTradingRouter from "./copyTrading.js";
const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use("/api/copy-trading", copyTradingRouter);
const allowedIntervals = new Set(["5m", "15m", "1h", "4h", "1d", "1w"]);
const providers = new Set([
  "binance",
  "bybit",
  "okx",
  "aster",
  "hyperliquid",
  "mexc",
]);
const intervalMap = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};
const okxMap = {
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};
const apiBases = {
  binance: process.env.BINANCE_API_URL || "https://data-api.binance.vision",
  bybit: process.env.BYBIT_API_URL || "https://api.bybit.com",
  okx: process.env.OKX_API_URL || "https://www.okx.com",
  aster: process.env.ASTER_API_URL || "https://fapi.asterdex.com",
  hyperliquid: process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz",
  mexc: process.env.MEXC_API_URL || "https://api.mexc.com",
};
const apiFallbackBases = {
  binance: [
    apiBases.binance,
    "https://data-api.binance.vision",
    "https://api.binance.com",
    "https://api-gcp.binance.com",
    "https://api1.binance.com",
  ],
  okx: [
    apiBases.okx,
    "https://openapi.okx.com",
    "https://www.okx.com",
  ],
};
const preferredApiBases = new Map();
function exchangeRequest(url, requestInit = {}, timeoutMs = 12000, hops = 0) {
  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const request = transport.request(
      target,
      {
        method: requestInit.method || "GET",
        headers: requestInit.headers || {},
      },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location &&
          hops < 3
        ) {
          response.resume();
          exchangeRequest(
            new URL(response.headers.location, target),
            requestInit,
            timeoutMs,
            hops + 1,
          ).then(resolve, reject);
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 30 * 1024 * 1024) {
            request.destroy(new Error("Exchange response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => JSON.parse(text),
          });
        });
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error(`${target.host} timed out`)),
    );
    request.on("error", reject);
    if (requestInit.body) request.write(requestInit.body);
    request.end();
  });
}
async function exchangeRequestWithRetry(
  url,
  requestInit = {},
  timeoutMs = 12000,
  attempts = 2,
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await exchangeRequest(url, requestInit, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
async function exchangeRequestForProvider(
  provider,
  originalUrl,
  requestInit = {},
  timeoutMs = 12000,
  attempts = 2,
) {
  const original = originalUrl instanceof URL ? originalUrl : new URL(originalUrl);
  const configured = apiFallbackBases[provider] || [original.origin];
  const preferred = preferredApiBases.get(provider);
  const bases = [preferred, ...configured]
    .filter(Boolean)
    .filter((base, index, values) => values.indexOf(base) === index);
  let lastError;
  let lastResponse;
  for (const base of bases) {
    const candidate = new URL(`${original.pathname}${original.search}`, base);
    try {
      const response = await exchangeRequestWithRetry(
        candidate,
        requestInit,
        timeoutMs,
        attempts,
      );
      if (response.ok) {
        preferredApiBases.set(provider, base);
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error(`${provider} API is unavailable`);
}
async function generateAi(contents) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    ...(
      process.env.GEMINI_FALLBACK_MODELS ||
      "gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash"
    ).split(","),
  ]
    .map((model) => model.trim())
    .filter((model, index, list) => model && list.indexOf(model) === index);
  let lastError;
  for (const model of models) {
    try {
      return await client.models.generateContent({ model, contents });
    } catch (error) {
      lastError = error;
      if (![404, 429, 500, 502, 503, 504].includes(Number(error?.status)))
        throw error;
    }
  }
  throw lastError;
}
async function generateVenice(messages, systemPrompt) {
  const baseUrl = (
    process.env.VENICE_API_URL || "https://api.venice.ai/api/v1"
  ).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.VENICE_MODEL || "zai-org-glm-4.7-flash",
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_completion_tokens: 900,
      temperature: 0.35,
      stream: false,
      venice_parameters: {
        include_venice_system_prompt: false,
        strip_thinking_response: true,
      },
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const message =
      detail?.error?.message || detail?.error || `HTTP ${response.status}`;
    throw new Error(`Venice request failed: ${String(message).slice(0, 180)}`);
  }
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("Venice returned an empty response");
}
function normalizedChatMessages(value) {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  let total = 0;
  const messages = [];
  for (const message of value) {
    const role = message?.role;
    const content = typeof message?.content === "string" ? message.content.trim() : "";
    if (!['user', 'assistant'].includes(role) || !content || content.length > 4000)
      return null;
    total += content.length;
    if (total > 18000) return null;
    messages.push({ role, content });
  }
  return messages;
}
function chartChatSystemPrompt({ chartContext, symbol, interval, exchange }) {
  const base = `You are Chart AI, a concise and thoughtful assistant for chart discussion, crypto education, and general reasoning. Answer the user's actual question directly. When discussing markets, clearly distinguish observations from facts and uncertainty from confidence. Never promise returns, invent live prices, claim to execute trades, or give personalized financial advice. If you describe a market outlook or setup, include a brief "Educational only — not financial advice" note. For general questions, do not force trading commentary. Prefer short paragraphs and bullets, and stay under 350 words unless the user asks for depth.`;
  if (!chartContext) return base;
  const data = JSON.stringify(cleanAnalysis(chartContext)).slice(0, 15000);
  return `${base}\n\nThe user has chosen to share the current chart context. Use only the structured values below for chart-specific claims and price levels; do not invent missing values. Exchange: ${exchange || "unknown"}. Pair: ${symbol}. Timeframe: ${interval}. Chart JSON: ${data}`;
}
function cleanAnalysis(value) {
  if (Array.isArray(value)) return value.map(cleanAnalysis);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cleanAnalysis(item)]),
    );
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    !Number.isInteger(value)
  )
    return Number(value.toPrecision(10));
  return value;
}
const marketCache = new Map();
const marketRequests = new Map();
function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
function normalizePair(symbol) {
  if (!isChartablePair(symbol)) throw new Error("Invalid pair");
  return symbol;
}
function isChartablePair(symbol) {
  return /^[\p{L}\p{N}]{2,40}$/u.test(symbol);
}
function sortAndCacheMarkets(provider, markets) {
  const quoteRank = new Map(
    ["USDT", "USDC", "BTC", "ETH", "BNB", "EUR", "TRY"].map(
      (quote, index) => [quote, index],
    ),
  );
  const uniqueMarkets = new Map();
  for (const market of markets) {
    if (isChartablePair(market.symbol) && !uniqueMarkets.has(market.symbol))
      uniqueMarkets.set(market.symbol, market);
  }
  const sorted = [...uniqueMarkets.values()].sort(
    (a, b) =>
      (quoteRank.get(a.quoteAsset) ?? 99) -
        (quoteRank.get(b.quoteAsset) ?? 99) || a.symbol.localeCompare(b.symbol),
  );
  if (!sorted.length)
    throw new Error(`${provider} returned an empty market catalog`);
  marketCache.set(provider, { time: Date.now(), markets: sorted });
  return sorted;
}
async function marketsFor(provider) {
  const cached = marketCache.get(provider);
  if (cached && Date.now() - cached.time < 300000) return cached.markets;
  const pending = marketRequests.get(provider);
  if (pending) return pending;
  const request = loadMarketsFor(provider, cached);
  marketRequests.set(provider, request);
  try {
    return await request;
  } finally {
    if (marketRequests.get(provider) === request) marketRequests.delete(provider);
  }
}
async function loadMarketsFor(provider, cached) {
  if (provider === "bybit") {
    try {
      const markets = [];
      let cursor = "";
      let pages = 0;
      do {
        const url = new URL("/v5/market/instruments-info", apiBases.bybit);
        url.search = new URLSearchParams({
          category: "linear",
          status: "Trading",
          limit: "1000",
          ...(cursor ? { cursor } : {}),
        }).toString();
        const response = await exchangeRequestWithRetry(url, {}, 15000, 2);
        if (!response.ok)
          throw new Error(`bybit instruments API returned ${response.status}`);
        const raw = await response.json();
        if (raw.retCode !== 0 || !Array.isArray(raw.result?.list))
          throw new Error(raw.retMsg || "Bybit instruments unavailable");
        markets.push(
          ...raw.result.list
            .filter((symbol) => symbol.status === "Trading")
            .map((symbol) => ({
              symbol: symbol.symbol,
              baseAsset: symbol.baseCoin,
              quoteAsset: symbol.quoteCoin,
            })),
        );
        const nextCursor = String(raw.result.nextPageCursor || "");
        cursor = nextCursor && nextCursor !== cursor ? nextCursor : "";
        pages += 1;
      } while (cursor && pages < 20);
      return sortAndCacheMarkets(provider, markets);
    } catch (error) {
      if (cached?.markets?.length) return cached.markets;
      throw error;
    }
  }
  let url,
    transform,
    requestInit = {};
  if (provider === "binance") {
    url = new URL("/api/v3/exchangeInfo", apiBases.binance);
    transform = (raw) =>
      raw.symbols
        .filter(
          (s) => s.status === "TRADING" && s.isSpotTradingAllowed !== false,
        )
        .map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }));
  } else if (provider === "okx") {
    url = new URL("/api/v5/public/instruments", apiBases.okx);
    url.search = new URLSearchParams({ instType: "SPOT" }).toString();
    transform = (raw) => {
      if (raw.code !== "0")
        throw new Error(raw.msg || "OKX instruments unavailable");
      return raw.data
        .filter((s) => s.state === "live")
        .map((s) => ({
          symbol: s.instId.replaceAll("-", ""),
          baseAsset: s.baseCcy,
          quoteAsset: s.quoteCcy,
          apiSymbol: s.instId,
        }));
    };
  } else if (provider === "aster") {
    url = new URL("/fapi/v3/exchangeInfo", apiBases.aster);
    transform = (raw) => {
      if (!Array.isArray(raw.symbols))
        throw new Error("Aster instruments unavailable");
      return raw.symbols
        .filter(
          (s) =>
            s.status === "TRADING" &&
            (!s.contractType || s.contractType === "PERPETUAL"),
        )
        .map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }));
    };
  } else if (provider === "hyperliquid") {
    url = new URL("/info", apiBases.hyperliquid);
    requestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    };
    transform = (raw) => {
      if (!Array.isArray(raw.universe))
        throw new Error("Hyperliquid instruments unavailable");
      return raw.universe
        .filter((s) => !s.isDelisted)
        .map((s) => ({
          symbol: `${s.name.toUpperCase()}USDC`,
          baseAsset: s.name,
          quoteAsset: "USDC",
          apiSymbol: s.name,
        }));
    };
  } else {
    url = new URL("/api/v3/exchangeInfo", apiBases.mexc);
    transform = (raw) => {
      if (!Array.isArray(raw.symbols))
        throw new Error("MEXC instruments unavailable");
      return raw.symbols
        .filter(
          (s) =>
            ["ENABLED", "1", "TRADING"].includes(String(s.status)) &&
            s.isSpotTradingAllowed !== false,
        )
        .map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }));
    };
  }
  try {
    const response = ["binance", "okx"].includes(provider)
      ? await exchangeRequestForProvider(
          provider,
          url,
          requestInit,
          6500,
          1,
        )
      : await exchangeRequestWithRetry(
          url,
          requestInit,
          provider === "mexc" ? 12000 : 15000,
          2,
        );
    if (!response.ok)
      throw new Error(`${provider} instruments API returned ${response.status}`);
    return sortAndCacheMarkets(provider, transform(await response.json()));
  } catch (error) {
    if (cached?.markets?.length) return cached.markets;
    throw error;
  }
}
async function candlesFor(provider, symbol, interval, requestedLimit = 500) {
  const limit = Math.min(500, Math.max(2, Math.trunc(requestedLimit)));
  let url,
    transform,
    requestInit = {};
  if (provider === "binance") {
    url = new URL("/api/v3/klines", apiBases.binance);
    url.search = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
    }).toString();
    transform = (raw) => {
      if (!Array.isArray(raw))
        throw new Error("Pair not listed on Binance Spot");
      return raw.map((k) => ({
        time: Math.floor(Number(k[0]) / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closed: +k[6] < Date.now(),
      }));
    };
  } else if (provider === "bybit") {
    url = new URL("/v5/market/kline", apiBases.bybit);
    url.search = new URLSearchParams({
      category: "linear",
      symbol,
      interval: intervalMap[interval],
      limit: String(limit),
    }).toString();
    transform = (raw) => {
      if (raw.retCode !== 0 || !raw.result?.list?.length)
        throw new Error(raw.retMsg || "Pair not listed on Bybit Linear");
      return raw.result.list.map((k) => ({
        time: Math.floor(+k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
      }));
    };
  } else if (provider === "okx") {
    const markets = await marketsFor("okx");
    const market = markets.find((item) => item.symbol === symbol);
    if (!market?.apiSymbol) throw new Error("Pair not listed on OKX Spot");
    url = new URL("/api/v5/market/candles", apiBases.okx);
    url.search = new URLSearchParams({
      instId: market.apiSymbol,
      bar: okxMap[interval],
      limit: String(Math.min(limit, 300)),
    }).toString();
    transform = (raw) => {
      if (raw.code !== "0" || !raw.data?.length)
        throw new Error(raw.msg || "Pair not listed on OKX Spot");
      return raw.data.map((k) => ({
        time: Math.floor(+k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closed: k[8] === "1",
      }));
    };
  } else if (provider === "aster") {
    url = new URL("/fapi/v3/klines", apiBases.aster);
    url.search = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
    }).toString();
    transform = (raw) => {
      if (!Array.isArray(raw) || !raw.length)
        throw new Error("Pair not listed on Aster Perpetual");
      return raw.map((k) => ({
        time: Math.floor(+k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closed: +k[6] < Date.now(),
      }));
    };
  } else if (provider === "hyperliquid") {
    const markets = await marketsFor("hyperliquid"),
      market = markets.find((item) => item.symbol === symbol);
    if (!market) throw new Error("Pair not listed on Hyperliquid Perpetuals");
    const seconds = {
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
        "1w": 604800,
      }[interval],
      endTime = Date.now(),
      startTime = endTime - seconds * 1000 * limit;
    url = new URL("/info", apiBases.hyperliquid);
    requestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candleSnapshot",
        req: { coin: market.apiSymbol, interval, startTime, endTime },
      }),
    };
    transform = (raw) => {
      if (!Array.isArray(raw) || !raw.length)
        throw new Error("Pair not listed on Hyperliquid Perpetuals");
      return raw.map((k) => ({
        time: Math.floor(+k.t / 1000),
        open: +k.o,
        high: +k.h,
        low: +k.l,
        close: +k.c,
        volume: +k.v,
        closed: +k.T < Date.now(),
      }));
    };
  } else {
    url = new URL("/api/v3/klines", apiBases.mexc);
    url.search = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
    }).toString();
    transform = (raw) => {
      if (!Array.isArray(raw) || !raw.length)
        throw new Error("Pair not listed on MEXC Spot");
      return raw.map((k) => ({
        time: Math.floor(+k[0] / 1000),
        open: +k[1],
        high: +k[2],
        low: +k[3],
        close: +k[4],
        volume: +k[5],
        closed: +k[6] < Date.now(),
      }));
    };
  }
  const response = ["binance", "okx"].includes(provider)
    ? await exchangeRequestForProvider(provider, url, requestInit, 6500, 1)
    : await exchangeRequestWithRetry(url, requestInit, 9000, 2);
  if (!response.ok)
    throw new Error(`${provider} market API returned ${response.status}`);
  const data = transform(await response.json()).sort((a, b) => a.time - b.time);
  const seconds = {
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
  }[interval];
  // Exchange-specific closed flags are preferred. For other feeds, infer from elapsed interval.
  return data.map((c) => ({
    ...c,
    closed: c.closed ?? (c.time + seconds) * 1000 <= Date.now(),
  }));
}
app.get("/api/markets", async (req, res) => {
  const provider = String(req.query.provider || "binance").toLowerCase();
  if (provider === "all") {
    const sources = [
      "bybit",
      "aster",
      "hyperliquid",
      "mexc",
      "binance",
      "okx",
    ];
    const results = await Promise.allSettled(
      sources.map(async (source) => ({
        source,
        markets: await withTimeout(
          marketsFor(source),
          12000,
          `${source} market catalog timed out`,
        ),
      })),
    );
    const markets = results
      .flatMap((result) =>
        result.status === "fulfilled"
          ? result.value.markets.map((market) => ({
              ...market,
              provider: result.value.source,
            }))
          : [],
      )
      .sort(
        (a, b) =>
          a.baseAsset.localeCompare(b.baseAsset) ||
          a.quoteAsset.localeCompare(b.quoteAsset) ||
          a.provider.localeCompare(b.provider),
      );
    const unavailable = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              provider: sources[index],
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : "Unavailable",
            },
          ]
        : [],
    );
    res.setHeader(
      "Cache-Control",
      unavailable.length
        ? "no-store"
        : "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    );
    if (!markets.length)
      return res.status(503).json({
        provider: "all",
        markets: [],
        unavailable: unavailable.length
          ? unavailable
          : [{ provider: "catalog", error: "No exchange catalogs are available" }],
      });
    return res.json({ provider: "all", markets, unavailable });
  }
  if (!providers.has(provider))
    return res.status(400).json({ error: "Invalid exchange" });
  try {
    const markets = await marketsFor(provider);
    res.setHeader(
      "Cache-Control",
      "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
    );
    res.json({ provider, markets: markets.map((market) => ({ ...market, provider })) });
  } catch (e) {
    res
      .status(502)
      .json({
        error: e instanceof Error ? e.message : "Market list is unavailable",
      });
  }
});
app.get("/api/klines", async (req, res) => {
  const provider = String(req.query.provider || "binance").toLowerCase();
  const symbol = String(req.query.symbol || "BTCUSDT").toUpperCase();
  const interval = String(req.query.interval || "4h");
  const parsedLimit = Number(req.query.limit || 500);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(500, Math.max(2, Math.trunc(parsedLimit)))
    : 500;
  if (
    !providers.has(provider) ||
    !allowedIntervals.has(interval) ||
    !/^[\p{L}\p{N}]{2,40}$/u.test(symbol)
  )
    return res
      .status(400)
      .json({ error: "Invalid exchange, trading pair or timeframe" });
  try {
    const candles = await candlesFor(
      provider,
      normalizePair(symbol),
      interval,
      limit,
    );
    if (candles.length < 2) throw new Error("Insufficient market candles");
    res.json({ provider, symbol, interval, candles });
  } catch (e) {
    res
      .status(502)
      .json({
        error: e instanceof Error ? e.message : "Market data is unavailable",
      });
  }
});
app.get("/api/ai/providers", (_req, res) =>
  res.json({
    providers: {
      gemini: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        label: "Gemini",
      },
      venice: {
        configured: Boolean(process.env.VENICE_API_KEY),
        label: "Venice AI",
      },
    },
  }),
);
app.post("/api/chat", async (req, res) => {
  const {
    aiProvider = "gemini",
    messages: rawMessages,
    chartContext,
    symbol,
    interval,
    exchange,
  } = req.body || {};
  const messages = normalizedChatMessages(rawMessages);
  if (!messages || !["gemini", "venice"].includes(aiProvider))
    return res.status(400).json({ error: "Invalid AI chat request" });
  if (
    chartContext &&
    (!/^[\p{L}\p{N}]{2,40}$/u.test(String(symbol || "")) ||
      !allowedIntervals.has(interval) ||
      !providers.has(String(exchange || "").toLowerCase()) ||
      typeof chartContext !== "object")
  )
    return res.status(400).json({ error: "Invalid chart context" });
  const secret =
    aiProvider === "venice"
      ? process.env.VENICE_API_KEY
      : process.env.GEMINI_API_KEY;
  if (!secret)
    return res.status(503).json({
      error: `${aiProvider === "venice" ? "Venice AI" : "Gemini"} is not configured on the server.`,
    });
  const systemPrompt = chartChatSystemPrompt({
    chartContext,
    symbol,
    interval,
    exchange,
  });
  try {
    let text;
    if (aiProvider === "venice") {
      text = await generateVenice(messages, systemPrompt);
    } else {
      const transcript = messages
        .map(
          (message) =>
            `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`,
        )
        .join("\n\n");
      const response = await generateAi(
        `${systemPrompt}\n\nConversation:\n${transcript}\n\nAssistant:`,
      );
      text = response.text?.trim();
    }
    if (!text) throw new Error("AI provider returned an empty response");
    res.json({ text, provider: aiProvider });
  } catch (error) {
    const providerMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `AI chat provider error (${aiProvider}):`,
      providerMessage,
    );
    const insufficientVeniceCredit =
      aiProvider === "venice" &&
      /insufficient .*balance|add credits/i.test(providerMessage);
    res.status(502).json({
      error: insufficientVeniceCredit
        ? "Venice AI is connected, but this account needs USD or DIEM credit before it can answer."
        : `${aiProvider === "venice" ? "Venice AI" : "Gemini"} could not answer right now. Check the server key, balance, and model setting.`,
    });
  }
});
app.post("/api/explain", async (req, res) => {
  const { symbol, interval, analysis, provider } = req.body || {};
  if (
    !/^[\p{L}\p{N}]{2,40}$/u.test(String(symbol || "")) ||
    !allowedIntervals.has(interval) ||
    !analysis ||
    typeof analysis !== "object"
  )
    return res.status(400).json({ error: "Invalid analysis request" });
  if (!process.env.GEMINI_API_KEY)
    return res
      .status(503)
      .json({
        error:
          "AI explanations are not configured. Add GEMINI_API_KEY to server secrets.",
      });
  try {
    const response = await generateAi(
      `You are a cautious educational crypto chart analyst. Interpret ONLY this validated structured technical data, with no new numbers or invented price levels. Do not claim profits or certainty. Limit to 150 words. Use sections: Structure, Bullish case, Bearish case. Exchange: ${provider || "unknown"}, Pair: ${symbol}, timeframe: ${interval}. JSON: ${JSON.stringify(cleanAnalysis(analysis)).slice(0, 12000)}`,
    );
    res.json({ text: response.text || "No AI explanation returned." });
  } catch (e) {
    res
      .status(502)
      .json({
        error:
          "AI provider request failed. Check key, quota and selected model.",
      });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
const distPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
if (existsSync(path.join(distPath, "index.html"))) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

export default app;
