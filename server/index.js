import express from "express";
import cors from "cors";
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));
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
function normalizePair(symbol) {
  if (!/^[\p{L}\p{N}]{2,40}$/u.test(symbol)) throw new Error("Invalid pair");
  return symbol;
}
function okxPair(symbol) {
  if (!symbol.endsWith("USDT"))
    throw new Error("OKX Spot requires a USDT-quoted pair");
  return `${symbol.slice(0, -4)}-USDT`;
}
async function marketsFor(provider) {
  const cached = marketCache.get(provider);
  if (cached && Date.now() - cached.time < 300000) return cached.markets;
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
  } else if (provider === "bybit") {
    url = new URL("/v5/market/instruments-info", apiBases.bybit);
    url.search = new URLSearchParams({
      category: "linear",
      limit: "1000",
    }).toString();
    transform = (raw) => {
      if (raw.retCode !== 0)
        throw new Error(raw.retMsg || "Bybit instruments unavailable");
      return raw.result.list
        .filter((s) => s.status === "Trading")
        .map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseCoin,
          quoteAsset: s.quoteCoin,
        }));
    };
  } else if (provider === "okx") {
    url = new URL("/api/v5/public/instruments", apiBases.okx);
    url.search = new URLSearchParams({ instType: "SPOT" }).toString();
    transform = (raw) => {
      if (raw.code !== "0")
        throw new Error(raw.msg || "OKX instruments unavailable");
      return raw.data
        .filter((s) => s.state === "live" && s.quoteCcy === "USDT")
        .map((s) => ({
          symbol: s.instId.replaceAll("-", ""),
          baseAsset: s.baseCcy,
          quoteAsset: s.quoteCcy,
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
            ["ENABLED", "1"].includes(String(s.status)) &&
            s.isSpotTradingAllowed !== false,
        )
        .map((s) => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
        }));
    };
  }
  const response = await exchangeRequestWithRetry(
    url,
    requestInit,
    provider === "mexc" ? 12000 : 15000,
    ["binance", "okx"].includes(provider) ? 1 : 2,
  );
  if (!response.ok)
    throw new Error(`${provider} instruments API returned ${response.status}`);
  const quoteRank = new Map(
    ["USDT", "USDC", "BTC", "ETH", "BNB", "EUR", "TRY"].map((quote, index) => [
      quote,
      index,
    ]),
  );
  const markets = transform(await response.json()).sort(
    (a, b) =>
      (quoteRank.get(a.quoteAsset) ?? 99) -
        (quoteRank.get(b.quoteAsset) ?? 99) || a.symbol.localeCompare(b.symbol),
  );
  marketCache.set(provider, { time: Date.now(), markets });
  return markets;
}
async function candlesFor(provider, symbol, interval) {
  let url,
    transform,
    requestInit = {};
  if (provider === "binance") {
    url = new URL("/api/v3/klines", apiBases.binance);
    url.search = new URLSearchParams({
      symbol,
      interval,
      limit: "500",
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
      limit: "500",
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
    url = new URL("/api/v5/market/candles", apiBases.okx);
    url.search = new URLSearchParams({
      instId: okxPair(symbol),
      bar: okxMap[interval],
      limit: "300",
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
      limit: "500",
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
      startTime = endTime - seconds * 1000 * 500;
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
      limit: "500",
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
  const response = await exchangeRequestWithRetry(
    url,
    requestInit,
    15000,
    2,
  );
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
    const results = new Array(sources.length);
    let cursor = 0;
    async function loadNextMarketSource() {
      while (cursor < sources.length) {
        const index = cursor++;
        const source = sources[index];
        try {
          results[index] = {
            status: "fulfilled",
            value: { source, markets: await marketsFor(source) },
          };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }
    await Promise.all([loadNextMarketSource(), loadNextMarketSource()]);
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
    return res.json({ provider: "all", markets, unavailable });
  }
  if (!providers.has(provider))
    return res.status(400).json({ error: "Invalid exchange" });
  try {
    const markets = await marketsFor(provider);
    res.json({ provider, markets });
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
  if (
    !providers.has(provider) ||
    !allowedIntervals.has(interval) ||
    !/^[\p{L}\p{N}]{2,40}$/u.test(symbol)
  )
    return res
      .status(400)
      .json({ error: "Invalid exchange, trading pair or timeframe" });
  try {
    const candles = await candlesFor(provider, normalizePair(symbol), interval);
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
app.post("/api/signal", async (req, res) => {
  const { symbol, interval, analysis, provider, riskAcknowledged } =
    req.body || {};
  if (riskAcknowledged !== true)
    return res
      .status(400)
      .json({
        error: "Risk acknowledgement is required before generating a signal.",
      });
  if (
    !/^[\p{L}\p{N}]{2,40}$/u.test(String(symbol || "")) ||
    !allowedIntervals.has(interval) ||
    !analysis ||
    typeof analysis !== "object"
  )
    return res.status(400).json({ error: "Invalid signal request" });
  if (!process.env.GEMINI_API_KEY)
    return res
      .status(503)
      .json({
        error:
          "AI signals are not configured. Add GEMINI_API_KEY to server secrets.",
      });
  try {
    const response = await generateAi(
      `You generate cautious, educational crypto chart setups from validated technical-analysis JSON. This is not personalized financial advice. Use ONLY numbers present in the JSON, reproduce price levels exactly, and never invent or calculate new levels. If evidence is conflicting or there is no clean invalidation, return NO TRADE. Do not recommend leverage, position size, or immediate execution. Limit to 170 words. Start exactly with "Educational signal — NFA" and use sections: Bias, Confirmation required, Conditional entry area, Invalidation, Potential targets, Risk note. Every setup must be conditional and the Risk note must say the signal may be wrong and is followed entirely at the user's own risk. Exchange: ${provider || "unknown"}, Pair: ${symbol}, timeframe: ${interval}. JSON: ${JSON.stringify(cleanAnalysis(analysis)).slice(0, 14000)}`,
    );
    const signalText =
      response.text?.trim() ||
      "NO TRADE — the available evidence does not support a clean conditional setup.";
    res.json({
      text: signalText.startsWith("Educational signal — NFA")
        ? signalText
        : `Educational signal — NFA\n\n${signalText}`,
    });
  } catch (e) {
    res
      .status(502)
      .json({
        error:
          "AI signal request failed. Check the Gemini key, quota and selected model.",
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
const port = Number(process.env.PORT || 3001);
app.listen(port, "0.0.0.0", () =>
  console.log(`Chart AI API listening on ${port}`),
);
