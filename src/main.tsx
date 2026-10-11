"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type AutoscaleInfoProvider,
  type LineData,
  type Time,
} from "lightweight-charts";
import { Root } from "protobufjs/light";
import {
  Activity,
  BrainCircuit,
  CandlestickChart,
  RefreshCcw,
  ScanLine,
  Layers,
  ChevronRight,
  ChevronDown,
  SlidersHorizontal,
  GitBranch,
  Settings2,
  Search,
  ShieldAlert,
  X,
  CircleHelp,
  MessageSquareText,
  Send,
  Trash2,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Users,
  Radio,
  Copy,
  Maximize2,
  Minimize2,
  Download,
} from "lucide-react";
import {
  analyze,
  type Analysis,
  type Candle,
  type ChartPattern,
  type Level,
} from "./analysis";
import {
  buildRuleSignal,
  DEFAULT_SIGNAL_FACTORS,
  isSignalFactor,
  SIGNAL_FACTORS,
  type RuleSignal,
  type SignalFactor,
} from "./signals";
import { AnimatedCompanion } from "./AnimatedCompanion";
import { PatternThumbnail } from "./PatternThumbnail";
import {
  calculatePaperQuote,
  estimatePaperBookFill,
  estimatePaperLiquidationPrice,
  PAPER_STORAGE_KEY,
  paperGrossPositionPnl,
  paperPositionPnl,
  readPaperPortfolio,
  type PaperClosedTrade,
  type PaperDirection,
  type PaperDirectionMode,
  type PaperPendingOrder,
  type PaperPortfolio,
  type PaperPosition,
} from "./paperTrading";
const intervals = ["5m", "15m", "1h", "4h", "1d", "1w"];
const signalFactorsStorageKey = "chart-ai.signal-factors";
const savedCandlesKey = (provider: string, symbol: string, interval: string) =>
  `chart-ai.candles.v1:${provider}:${symbol}:${interval}`;
function readSavedCandles(key: string): Candle[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!Array.isArray(saved)) return [];
    return saved.filter((candle): candle is Candle =>
      Boolean(candle) &&
      typeof candle === "object" &&
      Number.isFinite(candle.time) &&
      Number.isFinite(candle.open) && candle.open > 0 &&
      Number.isFinite(candle.high) && candle.high > 0 &&
      Number.isFinite(candle.low) && candle.low > 0 &&
      Number.isFinite(candle.close) && candle.close > 0 &&
      Number.isFinite(candle.volume),
    ).slice(-500);
  } catch {
    return [];
  }
}
function readSavedSignalFactors(): SignalFactor[] {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(signalFactorsStorageKey) ?? "null",
    );
    if (!Array.isArray(saved)) return [...DEFAULT_SIGNAL_FACTORS];
    const selected = SIGNAL_FACTORS.filter((factor) =>
      saved.some((value) => isSignalFactor(value) && value === factor.id),
    ).map((factor) => factor.id);
    return selected.length ? selected : [...DEFAULT_SIGNAL_FACTORS];
  } catch {
    return [...DEFAULT_SIGNAL_FACTORS];
  }
}
const exchanges = [
  { id: "binance", name: "Binance Spot" },
  { id: "bybit", name: "Bybit Linear" },
  { id: "okx", name: "OKX Spot" },
  { id: "aster", name: "Aster Perpetual" },
  { id: "hyperliquid", name: "Hyperliquid Perps" },
  { id: "mexc", name: "MEXC Spot" },
];
const marketCatalogStorageKey = "chart-ai.market-catalog.v1";
function readSavedMarketCatalog(): Market[] {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(marketCatalogStorageKey) ?? "null",
    );
    if (!Array.isArray(saved)) return [];
    const validProviders = new Set(exchanges.map((exchange) => exchange.id));
    return saved.filter(
      (market): market is Market =>
        Boolean(market) &&
        typeof market === "object" &&
        typeof market.symbol === "string" &&
        /^[\p{L}\p{N}]{2,40}$/u.test(market.symbol) &&
        typeof market.baseAsset === "string" &&
        typeof market.quoteAsset === "string" &&
        typeof market.provider === "string" &&
        validProviders.has(market.provider),
    );
  } catch {
    return [];
  }
}
function mergeProviderMarkets(
  current: Market[],
  provider: string,
  replacement: Market[],
): Market[] {
  const unique = new Map<string, Market>();
  for (const market of current) {
    if (market.provider !== provider)
      unique.set(`${market.provider}:${market.symbol}`, market);
  }
  for (const market of replacement)
    unique.set(`${provider}:${market.symbol}`, market);
  return [...unique.values()].sort(
    (a, b) =>
      a.baseAsset.localeCompare(b.baseAsset) ||
      a.quoteAsset.localeCompare(b.quoteAsset) ||
      (a.provider || "").localeCompare(b.provider || ""),
  );
}
type Market = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  apiSymbol?: string;
  provider?: string;
};
type MarketFailure = {
  provider: string;
  error: string;
};
type CopyProfile = {
  id: string;
  displayName: string;
  isPublic: boolean;
  currentTrade: { position: PaperPosition; accountBalance: number } | null;
  realizedPnl: number;
  totalTrades: number;
  updatedAt: string;
};
type CopyFollow = {
  traderId: string;
  enabled: boolean;
  copyScale: number;
};
type CopyTradeEvent = {
  id: number;
  traderId: string;
  kind: "open" | "close";
  trade: {
    position?: PaperPosition;
    accountBalance?: number;
    positionId?: string;
    exitPrice?: number;
    closedAtTime?: number;
    pnl?: number;
    reason?: PaperClosedTrade["reason"];
  };
  createdAt: string;
  displayName: string;
};
type CopySnapshot = {
  me: CopyProfile;
  traders: CopyProfile[];
  follows: CopyFollow[];
  events: CopyTradeEvent[];
  cursor: number;
  storageMode: "local-memory" | "persistent";
};
type IndicatorKey =
  | "ema20"
  | "ema50"
  | "sma200"
  | "vwap"
  | "bollinger"
  | "donchian";
type ConceptKey = "fibonacci" | "fairValueGaps" | "orderBlocks" | "structure";
type DraggableLevel = Level & {
  dragKey: string;
  originalPrice: number;
  minPrice: number;
  maxPrice: number;
  rank: number;
};
type ZoneRect = {
  top: number;
  height: number;
  kind: "support" | "resistance";
  price: number;
  touches: number;
  dragKey: string;
  originalPrice: number;
  minPrice: number;
  maxPrice: number;
  rank: number;
};
type ConceptRect = {
  left: number;
  width: number;
  top: number;
  height: number;
  low: number;
  high: number;
  kind: "fvg-bullish" | "fvg-bearish" | "ob-bullish" | "ob-bearish";
  label: string;
  muted: boolean;
};
type FibLineRect = {
  left: number;
  width: number;
  top: number;
  ratio: number;
  price: number;
  name: string;
};
type PatternDrawing = {
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  points: { x: number; y: number; label: string }[];
};
type InfoDetail = { title: string; description: string; facts?: string[] };
type AiProvider = "gemini" | "venice";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: AiProvider;
};
type DailyStats = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
type PaperLiveMark = {
  positionId: string;
  price: number;
  markKind: "mark" | "last";
  updatedAt: number;
};
type PaperMarkFeedState = "inactive" | "connecting" | "live" | "stale";
type PaperOrderBookLevel = {
  price: number;
  size: number;
  quoteSize: number;
  cumulativeQuote: number;
};
type PaperOrderBook = {
  provider: string;
  symbol: string;
  marketType: string;
  source: "websocket" | "rest-snapshot";
  bids: PaperOrderBookLevel[];
  asks: PaperOrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  spreadPercent: number;
  sequence: string | null;
  exchangeTime: number;
  updatedAt: number;
};
type PaperBookFeedState = "inactive" | "connecting" | "live" | "stale" | "reconnecting" | "syncing";
type PaperHistoryFilter = "ALL" | "WINS" | "LOSSES";
type PaperTerminalTab = "POSITIONS" | "OPEN_ORDERS" | "TRADE_HISTORY";
type RangePeriod = "off" | "daily" | "weekly" | "monthly" | "yearly";
type CandleReading = {
  name: string;
  direction: "bullish" | "bearish" | "neutral";
  description: string;
};
type SelectedCandle = {
  candle: Candle;
  index: number;
  readings: CandleReading[];
};
const rangePeriodLabels: Record<Exclude<RangePeriod, "off">, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};
const indicatorLabels: Record<IndicatorKey, string> = {
  ema20: "EMA 20",
  ema50: "EMA 50",
  sma200: "SMA 200",
  vwap: "Rolling VWAP 50",
  bollinger: "Bollinger Bands",
  donchian: "Donchian Channel 20",
};
const indicatorInfo: Record<IndicatorKey, InfoDetail> = {
  ema20: {
    title: "EMA 20",
    description:
      "A fast exponential moving average that gives more weight to recent closes. It is useful for observing short-term trend direction and dynamic reactions, not as a standalone signal.",
  },
  ema50: {
    title: "EMA 50",
    description:
      "A medium-term exponential moving average. Traders often compare it with price or faster averages to understand trend alignment.",
  },
  sma200: {
    title: "SMA 200",
    description:
      "The average of the last 200 completed closes. It is a broad long-term trend reference and can react slowly to recent price changes.",
  },
  vwap: {
    title: "Rolling VWAP 50",
    description:
      "The volume-weighted average price over the latest 50 completed candles. It shows where recent trading activity was concentrated by price and volume.",
  },
  bollinger: {
    title: "Bollinger Bands",
    description:
      "A 20-period average surrounded by bands two standard deviations away. Wider bands indicate higher recent volatility; touches are not automatic reversal signals.",
  },
  donchian: {
    title: "Donchian Channel 20",
    description:
      "The highest high and lowest low across the last 20 completed candles. It highlights the current range and possible breakout boundaries.",
  },
};
const conceptInfo: Record<ConceptKey, InfoDetail> = {
  fibonacci: {
    title: "Fibonacci retracement",
    description:
      "Auto follows the detected swing. Long maps levels from the swing low toward the high; Short reverses the anchors from high to low. These are reaction areas, not guaranteed support or resistance.",
  },
  fairValueGaps: {
    title: "Fair value gap",
    description:
      "A three-candle imbalance where the first and third candles do not fully overlap. The shaded zone remains active until price fully trades through it.",
  },
  orderBlocks: {
    title: "Order block",
    description:
      "The last opposing candle before a confirmed displacement through a recent range. It marks a possible institutional reaction area and can be invalidated.",
  },
  structure: {
    title: "BOS / CHOCH",
    description:
      "BOS marks a break in the existing direction. CHOCH marks a break opposite the previous structural direction and may indicate a transition.",
  },
};
const pivotInfo: InfoDetail = {
  title: "Confirmed pivots",
  description:
    "PH and PL marks identify confirmed swing highs and lows and display their exact prices. Nearby pivots are clustered to calculate the labeled support and resistance lines. Confirmation uses three completed candles on both sides, which reduces repainting but introduces delay.",
};
const rsiInfo: InfoDetail = {
  title: "RSI 14",
  description:
    "The Relative Strength Index compares recent gains with recent losses across 14 completed candles. Values above 70 or below 30 describe momentum extremes, not guaranteed reversals.",
};
function fibName(ratio: number, direction: "bullish" | "bearish") {
  if (ratio === 0) return direction === "bullish" ? "Swing high" : "Swing low";
  if (ratio === 1) return direction === "bullish" ? "Swing low" : "Swing high";
  if (ratio === 0.5) return "Midpoint";
  if (ratio === 0.618) return "Golden ratio";
  return "Retracement";
}
function formatPrice(price: number) {
  return price.toLocaleString(undefined, { maximumFractionDigits: 8 });
}
function formatMoney(amount: number) {
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
function formatSignedMoney(amount: number) {
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}${formatMoney(Math.abs(amount))}`;
}
function formatSignedPercent(percent: number) {
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(2)}%`;
}
function candleChangePercent(candle: Pick<Candle, "open" | "close">) {
  return candle.open
    ? ((candle.close - candle.open) / candle.open) * 100
    : 0;
}
function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function CandleIllustration({ candle }: { candle: Candle }) {
  const isBullish = candle.close >= candle.open;
  const color = isBullish ? "#32c997" : "#ed707b";
  const range = candle.high - candle.low;
  const yAt = (price: number) =>
    range > 0 ? 7 + ((candle.high - price) / range) * 54 : 34;
  const openY = yAt(candle.open);
  const closeY = yAt(candle.close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(3, Math.abs(closeY - openY));
  return (
    <svg
      className={`candle-illustration${isBullish ? " bullish" : " bearish"}`}
      viewBox="0 0 64 72"
      role="img"
      aria-label={`${isBullish ? "Bullish" : "Bearish"} candle with high ${formatPrice(candle.high)}, open ${formatPrice(candle.open)}, close ${formatPrice(candle.close)}, and low ${formatPrice(candle.low)}`}
    >
      <title>Selected candle shape drawn from its OHLC prices</title>
      <rect className="candle-mini-background" x="1" y="1" width="62" height="70" rx="7" />
      <path className="candle-mini-guides" d="M7 17H57 M7 36H57 M7 55H57" />
      <line x1="32" y1={yAt(candle.high)} x2="32" y2={yAt(candle.low)} stroke={color} strokeWidth="2" />
      <line x1="18" y1={openY} x2="24" y2={openY} stroke={color} strokeWidth="2" />
      <line x1="40" y1={closeY} x2="46" y2={closeY} stroke={color} strokeWidth="2" />
      <rect x="24" y={bodyTop} width="16" height={bodyHeight} rx="1.5" fill={color} />
    </svg>
  );
}
type InsightSection = { title: string; lines: string[] };
function parseInsightText(text: string) {
  const intro: string[] = [];
  const sections: InsightSection[] = [];
  let current: InsightSection | null = null;
  const lines = text.replace(/\r/g, "").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^```/.test(line)) continue;
    const markdownHeading =
      line.match(/^#{1,4}\s+(.+?)\s*#*$/) ??
      line.match(/^\*\*(.+?)\*\*:?\s*$/) ??
      line.match(/^__(.+?)__:?\s*$/);
    const colonHeading = line.match(/^([A-Z][A-Za-z0-9 /&'’()-]{1,42}):\s*$/);
    const title = markdownHeading?.[1] ?? colonHeading?.[1];
    if (title) {
      current = { title: title.trim().replace(/:$/, ""), lines: [] };
      sections.push(current);
      continue;
    }
    const cleanLine = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .trim();
    if (!cleanLine) continue;
    (current ? current.lines : intro).push(cleanLine);
  }
  return { intro, sections };
}
function ChartInsight({ text }: { text: string }) {
  const parsed = parseInsightText(text);
  const bias = parsed.sections.find((section) => /^bias$/i.test(section.title));
  const biasText = bias?.lines.join(" ") ?? "";
  const direction = /\bbullish\b|\bbuy\b|\blong\b/i.test(biasText)
    ? "bullish"
    : /\bbearish\b|\bsell\b|\bshort\b/i.test(biasText)
      ? "bearish"
      : "";
  const sideLabel = direction === "bullish" ? "LONG" : direction === "bearish" ? "SHORT" : biasText;
  const intro = parsed.intro.filter(
    (line) => !/^educational signal\b/i.test(line),
  );
  const sections = parsed.sections.filter((section) => section !== bias);
  return (
    <section className="insights insight-card" aria-label="Chart explanation">
      <header className="insight-heading">
        <span className="insight-icon"><BrainCircuit size={15} aria-hidden="true" /></span>
        <span className="insight-heading-copy">
          <strong>Chart analysis</strong>
          <small>Educational market scenario</small>
        </span>
        {biasText && (
          <span className={`insight-bias ${direction}`}>
            {sideLabel}
          </span>
        )}
      </header>
      {sections.length > 0 ? (
        <>
          {intro.length > 0 && (
            <p className="insight-intro">{intro.join(" ")}</p>
          )}
          <div className="insight-sections">
            {sections.map((section, index) => {
              const title = section.title.toLowerCase();
              const wide = /structure|confirmation|required|risk note/.test(title);
              const risk = /risk note/.test(title);
              return (
                <article
                  className={`insight-section${wide ? " wide" : ""}${risk ? " risk" : ""}`}
                  key={`${section.title}-${index}`}
                >
                  <h4>{section.title}</h4>
                  {section.lines.map((line, lineIndex) => (
                    <p key={`${lineIndex}-${line}`}>{line}</p>
                  ))}
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <div className="insight-plain">
          {intro.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
        </div>
      )}
    </section>
  );
}
function aggregateCandleRange(candles: Candle[]): DailyStats | null {
  if (!candles.length) return null;
  const ordered = [...candles].sort((a, b) => a.time - b.time);
  return {
    time: ordered[0].time,
    open: ordered[0].open,
    high: Math.max(...ordered.map((candle) => candle.high)),
    low: Math.min(...ordered.map((candle) => candle.low)),
    close: ordered[ordered.length - 1].close,
  };
}
function recordPaperClose(
  portfolio: PaperPortfolio,
  position: PaperPosition,
  exitPrice: number,
  closedAtTime: number,
  reason: PaperClosedTrade["reason"],
): PaperPortfolio {
  const trade: PaperClosedTrade = {
    ...position,
    exitPrice,
    pnl: paperPositionPnl(position, exitPrice),
    closedAtTime,
    reason,
  };
  return {
    balance: portfolio.balance + trade.pnl,
    openPosition: null,
    pendingOrder: null,
    history: [trade, ...portfolio.history].slice(0, 500),
  };
}
function downloadPaperPnlCard(trade: PaperClosedTrade) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) return;

  const ctx = context;
  const positive = trade.pnl >= 0;
  const accent = positive ? "#53d6a4" : "#ff7d89";
  const money = (value: number) => formatMoney(value);
  const date = new Date(trade.closedAtTime * 1000);
  const stamp = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const roi = trade.margin > 0 ? (trade.pnl / trade.margin) * 100 : 0;
  const roundedRect = (
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  };

  const background = ctx.createLinearGradient(0, 0, 1200, 675);
  background.addColorStop(0, "#101923");
  background.addColorStop(0.56, "#111d29");
  background.addColorStop(1, "#0b1118");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  roundedRect(28, 28, 1144, 619, 28);
  ctx.clip();
  const glow = ctx.createRadialGradient(1030, 80, 20, 1030, 80, 500);
  glow.addColorStop(0, positive ? "rgba(56, 177, 136, .17)" : "rgba(210, 79, 96, .17)");
  glow.addColorStop(1, "rgba(16, 25, 35, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(28, 28, 1144, 619);
  ctx.restore();
  roundedRect(28, 28, 1144, 619, 28);
  ctx.strokeStyle = "#2b3b49";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.fillStyle = "#dbe7ef";
  ctx.font = "700 28px Inter, Segoe UI, sans-serif";
  ctx.fillText("CHART AI", 72, 83);
  ctx.fillStyle = "#8395a4";
  ctx.font = "600 16px Inter, Segoe UI, sans-serif";
  ctx.fillText("DEMO TRADE · SIMULATION", 72, 114);
  roundedRect(930, 62, 194, 46, 23);
  ctx.fillStyle = positive ? "rgba(42, 126, 96, .24)" : "rgba(145, 60, 70, .24)";
  ctx.fill();
  ctx.strokeStyle = positive ? "rgba(83, 214, 164, .45)" : "rgba(255, 125, 137, .45)";
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.font = "800 15px Inter, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(trade.direction, 1027, 85);
  ctx.textAlign = "left";

  ctx.fillStyle = "#f2f6f9";
  ctx.font = "750 48px Inter, Segoe UI, sans-serif";
  ctx.fillText(trade.symbol, 72, 190);
  ctx.fillStyle = "#93a5b4";
  ctx.font = "600 17px Inter, Segoe UI, sans-serif";
  ctx.fillText(`${trade.provider.toUpperCase()}  ·  ${trade.leverage}× leverage  ·  ${stamp}`, 72, 226);

  ctx.fillStyle = "#8698a7";
  ctx.font = "700 16px Inter, Segoe UI, sans-serif";
  ctx.fillText("NET REALIZED P&L", 72, 297);
  ctx.fillStyle = accent;
  ctx.font = "750 74px Inter, Segoe UI, sans-serif";
  ctx.fillText(formatSignedMoney(trade.pnl), 68, 377);
  roundedRect(72, 414, 132, 40, 20);
  ctx.fillStyle = positive ? "rgba(42, 126, 96, .23)" : "rgba(145, 60, 70, .23)";
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = "750 17px Inter, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(formatSignedPercent(roi), 138, 434);
  ctx.textAlign = "left";
  ctx.fillStyle = "#8293a1";
  ctx.font = "500 15px Inter, Segoe UI, sans-serif";
  ctx.fillText("return on isolated margin", 222, 434);

  ctx.strokeStyle = "#293845";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, 493);
  ctx.lineTo(1128, 493);
  ctx.stroke();
  const detail = (x: number, label: string, value: string) => {
    ctx.fillStyle = "#8293a1";
    ctx.font = "600 14px Inter, Segoe UI, sans-serif";
    ctx.fillText(label.toUpperCase(), x, 531);
    ctx.fillStyle = "#dce6ed";
    ctx.font = "700 19px Inter, Segoe UI, sans-serif";
    ctx.fillText(value, x, 565);
  };
  detail(72, "Entry", formatPrice(trade.entry));
  detail(320, "Exit", formatPrice(trade.exitPrice));
  detail(548, "Position size", `${trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${trade.symbol.replace(/USDT$|USDC$|USD$/, "")}`);
  detail(820, "Closed", trade.reason);

  ctx.fillStyle = "#728493";
  ctx.font = "500 13px Inter, Segoe UI, sans-serif";
  ctx.fillText("Simulated performance · not an exchange statement or financial advice", 72, 612);
  ctx.textAlign = "right";
  ctx.fillStyle = "#8fa1af";
  ctx.font = "650 13px Inter, Segoe UI, sans-serif";
  ctx.fillText(`Margin ${money(trade.margin)}`, 1128, 612);
  ctx.textAlign = "left";

  const safeSymbol = trade.symbol.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const day = date.toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.download = `chart-ai-${safeSymbol}-${trade.direction.toLowerCase()}-pnl-${day}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}
function recognizeCandlestick(candles: Candle[], index: number): CandleReading[] {
  const candle = candles[index];
  if (!candle) return [];
  const readings: CandleReading[] = [];
  const add = (reading: CandleReading) => {
    if (!readings.some((current) => current.name === reading.name))
      readings.push(reading);
  };
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bodyRatio = body / range;
  const bullish = candle.close > candle.open;
  const direction = bullish ? "bullish" : candle.close < candle.open ? "bearish" : "neutral";
  const earlier = candles[Math.max(0, index - 5)];
  const priorMove = index > 0 ? candles[index - 1].close - earlier.close : 0;

  if (range <= Number.EPSILON * 10) {
    add({ name: "Four-price doji", direction: "neutral", description: "Open, high, low and close are effectively identical." });
  } else if (bodyRatio <= 0.1) {
    if (lowerWick >= range * 0.62 && upperWick <= range * 0.1)
      add({ name: "Dragonfly doji", direction: "bullish", description: "A doji near the high with a long lower wick, showing strong rejection below." });
    else if (upperWick >= range * 0.62 && lowerWick <= range * 0.1)
      add({ name: "Gravestone doji", direction: "bearish", description: "A doji near the low with a long upper wick, showing strong rejection above." });
    else if (upperWick >= range * 0.3 && lowerWick >= range * 0.3)
      add({ name: "Long-legged doji", direction: "neutral", description: "Long wicks on both sides show a wide battle with little net body." });
    else
      add({ name: "Doji", direction: "neutral", description: "Open and close are nearly equal, signalling short-term indecision." });
  } else if (bodyRatio >= 0.84) {
    add({
      name: bullish ? "Bullish marubozu" : "Bearish marubozu",
      direction,
      description: "The real body controls most of the full range with very small opposing wicks.",
    });
  } else if (lowerWick >= body * 2.1 && upperWick <= body * 0.65) {
    add({
      name: priorMove <= 0 ? "Hammer" : "Hanging man",
      direction: priorMove <= 0 ? "bullish" : "bearish",
      description: "A compact body above a long lower wick marks forceful rejection of lower prices.",
    });
  } else if (upperWick >= body * 2.1 && lowerWick <= body * 0.65) {
    add({
      name: priorMove <= 0 ? "Inverted hammer" : "Shooting star",
      direction: priorMove <= 0 ? "bullish" : "bearish",
      description: "A compact body below a long upper wick marks forceful rejection of higher prices.",
    });
  } else if (bodyRatio <= 0.34 && upperWick >= body * 0.7 && lowerWick >= body * 0.7) {
    add({ name: "Spinning top", direction: "neutral", description: "A small body with meaningful wicks on both sides shows balanced pressure." });
  } else {
    add({
      name: `${bullish ? "Bullish" : "Bearish"} ${bodyRatio >= 0.58 ? "long" : "standard"} candle`,
      direction,
      description: `${bullish ? "Buyers" : "Sellers"} closed the candle away from its open with ${bodyRatio >= 0.58 ? "strong" : "moderate"} body control.`,
    });
  }

  const previous = candles[index - 1];
  if (previous) {
    const previousBullish = previous.close > previous.open;
    const currentHighBody = Math.max(candle.open, candle.close);
    const currentLowBody = Math.min(candle.open, candle.close);
    const previousHighBody = Math.max(previous.open, previous.close);
    const previousLowBody = Math.min(previous.open, previous.close);
    if (bullish && !previousBullish && currentLowBody <= previousLowBody && currentHighBody >= previousHighBody)
      add({ name: "Bullish engulfing", direction: "bullish", description: "The bullish body fully engulfs the previous bearish body." });
    if (!bullish && previousBullish && currentLowBody <= previousLowBody && currentHighBody >= previousHighBody)
      add({ name: "Bearish engulfing", direction: "bearish", description: "The bearish body fully engulfs the previous bullish body." });
    if (currentLowBody >= previousLowBody && currentHighBody <= previousHighBody)
      add({ name: bullish ? "Bullish harami" : "Bearish harami", direction, description: "The current real body sits inside the previous candle's body." });
    const tolerance = Math.max(range, previous.high - previous.low) * 0.06;
    if (Math.abs(candle.high - previous.high) <= tolerance && previousBullish && !bullish)
      add({ name: "Tweezer top", direction: "bearish", description: "Two candles rejected almost the same high." });
    if (Math.abs(candle.low - previous.low) <= tolerance && !previousBullish && bullish)
      add({ name: "Tweezer bottom", direction: "bullish", description: "Two candles rejected almost the same low." });
    const previousMidpoint = (previous.open + previous.close) / 2;
    if (!previousBullish && bullish && candle.open <= previous.close && candle.close > previousMidpoint && candle.close < previous.open)
      add({ name: "Piercing line", direction: "bullish", description: "A bullish recovery closes beyond the midpoint of the prior bearish body." });
    if (previousBullish && !bullish && candle.open >= previous.close && candle.close < previousMidpoint && candle.close > previous.open)
      add({ name: "Dark cloud cover", direction: "bearish", description: "A bearish reversal closes below the midpoint of the prior bullish body." });
  }

  const twoBack = candles[index - 2];
  if (twoBack && previous) {
    const firstBody = Math.abs(twoBack.close - twoBack.open);
    const middleBody = Math.abs(previous.close - previous.open);
    const firstMidpoint = (twoBack.open + twoBack.close) / 2;
    if (twoBack.close < twoBack.open && middleBody <= firstBody * 0.45 && bullish && candle.close > firstMidpoint)
      add({ name: "Morning star", direction: "bullish", description: "A three-candle transition from bearish momentum through indecision into bullish recovery." });
    if (twoBack.close > twoBack.open && middleBody <= firstBody * 0.45 && !bullish && candle.close < firstMidpoint)
      add({ name: "Evening star", direction: "bearish", description: "A three-candle transition from bullish momentum through indecision into bearish reversal." });
  }
  return readings.slice(0, 5);
}
const bybitIntervals: Record<string, string> = {
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1d": "D",
  "1w": "W",
};
const okxChannels: Record<string, string> = {
  "5m": "candle5m",
  "15m": "candle15m",
  "1h": "candle1H",
  "4h": "candle4H",
  "1d": "candle1D",
  "1w": "candle1W",
};
const mexcIntervals: Record<string, string> = {
  "5m": "Min5",
  "15m": "Min15",
  "1h": "Min60",
  "4h": "Hour4",
  "1d": "Day1",
  "1w": "Week1",
};
const mexcProtoRoot = Root.fromJSON({
  nested: {
    PublicSpotKlineV3Api: {
      fields: {
        interval: { type: "string", id: 1 },
        windowStart: { type: "int64", id: 2 },
        openingPrice: { type: "string", id: 3 },
        closingPrice: { type: "string", id: 4 },
        highestPrice: { type: "string", id: 5 },
        lowestPrice: { type: "string", id: 6 },
        volume: { type: "string", id: 7 },
        amount: { type: "string", id: 8 },
        windowEnd: { type: "int64", id: 9 },
      },
    },
    PushDataV3ApiWrapper: {
      oneofs: { body: { oneof: ["publicSpotKline"] } },
      fields: {
        channel: { type: "string", id: 1 },
        publicSpotKline: { type: "PublicSpotKlineV3Api", id: 308 },
        symbol: { type: "string", id: 3 },
        symbolId: { type: "string", id: 4 },
        createTime: { type: "int64", id: 5 },
        sendTime: { type: "int64", id: 6 },
      },
    },
  },
});
const mexcKlineWrapper = mexcProtoRoot.lookupType("PushDataV3ApiWrapper");
function emaLine(candles: Candle[], period: number): LineData<Time>[] {
  if (!candles.length) return [];
  const k = 2 / (period + 1);
  let value = candles[0].close;
  return candles.map((c, index) => {
    value = index ? c.close * k + value * (1 - k) : value;
    return { time: c.time as Time, value };
  });
}
function smaLine(candles: Candle[], period: number): LineData<Time>[] {
  const data: LineData<Time>[] = [],
    window: number[] = [];
  let sum = 0;
  for (const candle of candles) {
    window.push(candle.close);
    sum += candle.close;
    if (window.length > period) sum -= window.shift()!;
    if (window.length === period)
      data.push({ time: candle.time as Time, value: sum / period });
  }
  return data;
}
function rollingVwapLine(candles: Candle[], period = 50): LineData<Time>[] {
  const data: LineData<Time>[] = [],
    window: { pv: number; volume: number }[] = [];
  let pv = 0,
    volume = 0;
  for (const candle of candles) {
    const item = {
      pv: ((candle.high + candle.low + candle.close) / 3) * candle.volume,
      volume: candle.volume,
    };
    window.push(item);
    pv += item.pv;
    volume += item.volume;
    if (window.length > period) {
      const removed = window.shift()!;
      pv -= removed.pv;
      volume -= removed.volume;
    }
    if (window.length === period && volume > 0)
      data.push({ time: candle.time as Time, value: pv / volume });
  }
  return data;
}
function bollingerLines(candles: Candle[], period = 20) {
  const upper: LineData<Time>[] = [],
    middle: LineData<Time>[] = [],
    lower: LineData<Time>[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1).map((c) => c.close);
    const average = window.reduce((a, b) => a + b, 0) / period;
    const deviation = Math.sqrt(
      window.reduce((sum, value) => sum + (value - average) ** 2, 0) / period,
    );
    const time = candles[i].time as Time;
    upper.push({ time, value: average + deviation * 2 });
    middle.push({ time, value: average });
    lower.push({ time, value: average - deviation * 2 });
  }
  return { upper, middle, lower };
}
function donchianLines(candles: Candle[], period = 20) {
  const upper: LineData<Time>[] = [],
    middle: LineData<Time>[] = [],
    lower: LineData<Time>[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    const window = candles.slice(i - period + 1, i + 1),
      high = Math.max(...window.map((c) => c.high)),
      low = Math.min(...window.map((c) => c.low)),
      time = candles[i].time as Time;
    upper.push({ time, value: high });
    middle.push({ time, value: (high + low) / 2 });
    lower.push({ time, value: low });
  }
  return { upper, middle, lower };
}
function App() {
  const [provider, setProvider] = useState("aster");
  const [reload, setReload] = useState(0);
  const [symbol, setSymbol] = useState("SOLUSDT");
  const [interval, setIntervalValue] = useState("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [timeframeChanges, setTimeframeChanges] = useState<
    Record<string, number>
  >({});
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<DailyStats | null>(null);
  const [dailyHistory, setDailyHistory] = useState<Candle[]>([]);
  const [rangeLevelPeriod, setRangeLevelPeriod] =
    useState<RangePeriod>("off");
  const [selectedCandle, setSelectedCandle] =
    useState<SelectedCandle | null>(null);
  const [focusedPatternName, setFocusedPatternName] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [initialMarketCatalog] = useState(readSavedMarketCatalog);
  const [markets, setMarkets] = useState<Market[]>(initialMarketCatalog);
  const [marketsLoading, setMarketsLoading] = useState(
    initialMarketCatalog.length === 0,
  );
  const [marketResolvedProviders, setMarketResolvedProviders] = useState<
    string[]
  >(() => [...new Set(initialMarketCatalog.map((market) => market.provider || ""))]);
  const [marketFailures, setMarketFailures] = useState<MarketFailure[]>([]);
  const [marketScope, setMarketScope] = useState("all");
  const [marketQuery, setMarketQuery] = useState("");
  const [marketMenu, setMarketMenu] = useState(false);
  const [showSupportZones, setShowSupportZones] = useState(false);
  const [showResistanceZones, setShowResistanceZones] = useState(false);
  const [selectedSupportRanks, setSelectedSupportRanks] = useState<number[]>(
    [],
  );
  const [selectedResistanceRanks, setSelectedResistanceRanks] = useState<
    number[]
  >([]);
  const [zoneMenu, setZoneMenu] = useState(false);
  const [showPivots, setShowPivots] = useState(false);
  const [indicators, setIndicators] = useState<Record<IndicatorKey, boolean>>({
    ema20: false,
    ema50: false,
    sma200: false,
    vwap: false,
    bollinger: false,
    donchian: false,
  });
  const [indicatorMenu, setIndicatorMenu] = useState(false);
  const [zoneRects, setZoneRects] = useState<ZoneRect[]>([]);
  const [levelOverrides, setLevelOverrides] = useState<Record<string, number>>(
    {},
  );
  const [draggingLevelKey, setDraggingLevelKey] = useState<string | null>(null);
  const [returningLevelKey, setReturningLevelKey] = useState<string | null>(
    null,
  );
  const [concepts, setConcepts] = useState<Record<ConceptKey, boolean>>({
    fibonacci: false,
    fairValueGaps: false,
    orderBlocks: false,
    structure: false,
  });
  const [conceptMenu, setConceptMenu] = useState(false);
  const [fibDirectionMode, setFibDirectionMode] =
    useState<PaperDirectionMode>("auto");
  const [conceptRects, setConceptRects] = useState<ConceptRect[]>([]);
  const [fibLines, setFibLines] = useState<FibLineRect[]>([]);
  const [patternDrawing, setPatternDrawing] =
    useState<PatternDrawing | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [signalModal, setSignalModal] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [signalPlan, setSignalPlan] = useState<RuleSignal | null>(null);
  const [signalError, setSignalError] = useState("");
  const [signalFactors, setSignalFactors] = useState<SignalFactor[]>(
    readSavedSignalFactors,
  );
  const [signalSettingsOpen, setSignalSettingsOpen] = useState(false);
  const [paperPortfolio, setPaperPortfolio] =
    useState<PaperPortfolio>(readPaperPortfolio);
  const [paperHistoryFilter, setPaperHistoryFilter] =
    useState<PaperHistoryFilter>("ALL");
  const [paperTerminalTab, setPaperTerminalTab] =
    useState<PaperTerminalTab>("POSITIONS");
  const [paperLiveMark, setPaperLiveMark] = useState<PaperLiveMark | null>(null);
  const [paperMarkFeedState, setPaperMarkFeedState] =
    useState<PaperMarkFeedState>("inactive");
  const [paperOrderBook, setPaperOrderBook] = useState<PaperOrderBook | null>(null);
  const [paperBookFeedState, setPaperBookFeedState] =
    useState<PaperBookFeedState>("inactive");
  const [copySnapshot, setCopySnapshot] = useState<CopySnapshot | null>(null);
  const [copyNameDraft, setCopyNameDraft] = useState("");
  const [copyShareDraft, setCopyShareDraft] = useState(false);
  const [copySaving, setCopySaving] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copyStatus, setCopyStatus] = useState("Connecting to demo traders…");
  const [copyScaleDrafts, setCopyScaleDrafts] = useState<Record<string, number>>({});
  const [paperDirection, setPaperDirection] =
    useState<PaperDirection>("LONG");
  const [paperOrderType, setPaperOrderType] =
    useState<"MARKET" | "LIMIT">("MARKET");
  const [paperEntry, setPaperEntry] = useState("");
  const [paperStop, setPaperStop] = useState("");
  const [paperTarget, setPaperTarget] = useState("");
  const [paperRiskPercent, setPaperRiskPercent] = useState("1");
  const [paperLeverage, setPaperLeverage] = useState("3");
  const [paperMaintenanceMarginPercent, setPaperMaintenanceMarginPercent] =
    useState("0.5");
  const [paperFeePercent, setPaperFeePercent] = useState("0.05");
  const [paperError, setPaperError] = useState("");
  const [paperDockExpanded, setPaperDockExpanded] = useState(false);
  const [paperFullscreen, setPaperFullscreen] = useState(false);
  const [chatProvider, setChatProvider] = useState<AiProvider>("venice");
  const [chatProviders, setChatProviders] = useState<
    Record<AiProvider, boolean>
  >({ gemini: true, venice: true });
  const [includeChartContext, setIncludeChartContext] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [infoDetail, setInfoDetail] = useState<InfoDetail | null>(null);
  const chartDiv = useRef<HTMLDivElement>(null);
  const paperDockRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indicatorSeries = useRef<{
    ema20: ISeriesApi<"Line">;
    ema50: ISeriesApi<"Line">;
    sma200: ISeriesApi<"Line">;
    vwap: ISeriesApi<"Line">;
    bbUpper: ISeriesApi<"Line">;
    bbMiddle: ISeriesApi<"Line">;
    bbLower: ISeriesApi<"Line">;
    dcUpper: ISeriesApi<"Line">;
    dcMiddle: ISeriesApi<"Line">;
    dcLower: ISeriesApi<"Line">;
  } | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const levelPriceLinesRef = useRef<IPriceLine[]>([]);
  const signalPriceLinesRef = useRef<IPriceLine[]>([]);
  const paperPriceLinesRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const marketsRef = useRef<Market[]>([]);
  const paperPortfolioRef = useRef(paperPortfolio);
  const paperLiveMarkRef = useRef<PaperLiveMark | null>(null);
  const copySnapshotRef = useRef<CopySnapshot | null>(null);
  const copyCursorRef = useRef<number | null>(null);
  const copySyncBusyRef = useRef(false);
  const copyPublishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const zoneDragRef = useRef<{
    pointerId: number;
    key: string;
    startY: number;
    startPrice: number;
    currentPrice: number;
    moved: boolean;
  } | null>(null);
  const suppressZoneClickRef = useRef(false);
  useEffect(() => {
    const closeFallbackFullscreen = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        paperDockRef.current?.classList.contains("is-fullscreen")
      ) {
        setPaperFullscreen(false);
      }
    };
    document.addEventListener("keydown", closeFallbackFullscreen);
    return () => {
      document.removeEventListener("keydown", closeFallbackFullscreen);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("paper-workspace-active", paperFullscreen);
    return () => document.body.classList.remove("paper-workspace-active");
  }, [paperFullscreen]);
  function togglePaperFullscreen() {
    if (paperFullscreen) {
      setPaperFullscreen(false);
      return;
    }
    setPaperDockExpanded(true);
    setPaperFullscreen(true);
  }
  function replacePaperPortfolio(next: PaperPortfolio) {
    paperPortfolioRef.current = next;
    setPaperPortfolio(next);
  }
  function replacePaperLiveMark(next: PaperLiveMark | null) {
    paperLiveMarkRef.current = next;
    setPaperLiveMark(next);
  }
  function processPaperMarketTick(
    watchedTradeId: string,
    price: number,
    updatedAt: number,
  ) {
    let portfolio = paperPortfolioRef.current;
    let position = portfolio.openPosition;
    const pending = portfolio.pendingOrder;

    if (!position && pending?.id === watchedTradeId) {
      const isLong = pending.direction === "LONG";
      const limitTriggered = isLong
        ? price <= pending.limitPrice
        : price >= pending.limitPrice;
      if (!limitTriggered) return;

      // A resting limit order receives the current mark when it is better than its limit.
      const fillPrice = isLong
        ? Math.min(price, pending.limitPrice)
        : Math.max(price, pending.limitPrice);
      position = {
        id: pending.id,
        direction: pending.direction,
        provider: pending.provider,
        symbol: pending.symbol,
        interval: pending.interval,
        openedAtTime: Math.floor(updatedAt / 1000),
        entry: fillPrice,
        stop: pending.stop,
        target: pending.target,
        quantity: pending.quantity,
        leverage: pending.leverage,
        margin: pending.quantity * fillPrice / pending.leverage,
        liquidationPrice: estimatePaperLiquidationPrice(
          fillPrice,
          pending.direction,
          pending.leverage,
          pending.maintenanceMarginPercent,
          pending.feeRate,
        ),
        riskAmount: Math.abs(fillPrice - pending.stop) * pending.quantity +
          pending.quantity * (fillPrice + pending.stop) * pending.feeRate,
        feeRate: pending.feeRate,
        markPrice: price,
      };
      replacePaperPortfolio({
        ...portfolio,
        openPosition: position,
        pendingOrder: null,
      });
      void publishCopyEvent("open", {
        position,
        accountBalance: portfolio.balance,
      });
      portfolio = paperPortfolioRef.current;
    }

    if (!position || position.id !== watchedTradeId) return;
    const latestPortfolio = paperPortfolioRef.current;
    if (latestPortfolio.openPosition?.id === position.id && position.markPrice !== price) {
      position = { ...position, markPrice: price };
      replacePaperPortfolio({ ...latestPortfolio, openPosition: position });
    }
    const isLong = position.direction === "LONG";
    const liquidationHit = isLong
      ? price <= position.liquidationPrice
      : price >= position.liquidationPrice;
    const stopHit = isLong ? price <= position.stop : price >= position.stop;
    const targetHit = isLong ? price >= position.target : price <= position.target;
    if (!liquidationHit && !stopHit && !targetHit) return;

    const reason: PaperClosedTrade["reason"] = liquidationHit
      ? "Estimated liquidation"
      : stopHit
        ? "Stop hit"
        : "Target hit";
    const exitPrice = liquidationHit
      ? price
      : stopHit
        ? isLong
          ? Math.min(price, position.stop)
          : Math.max(price, position.stop)
        : isLong
          ? Math.max(price, position.target)
          : Math.min(price, position.target);
    portfolio = paperPortfolioRef.current;
    if (portfolio.openPosition?.id !== position.id) return;
    const closedPortfolio = recordPaperClose(
      portfolio,
      position,
      exitPrice,
      Math.floor(updatedAt / 1000),
      reason,
    );
    replacePaperPortfolio(closedPortfolio);
    if (!position.copiedFrom)
      void publishCopyEvent("close", {
        positionId: position.id,
        exitPrice,
        closedAtTime: Math.floor(updatedAt / 1000),
        reason,
        pnl: closedPortfolio.history[0]?.pnl || 0,
      });
  }
  function applyCopiedPosition(
    trader: CopyProfile,
    shared: { position: PaperPosition; accountBalance: number },
    copyScale: number,
  ) {
    const source = shared.position;
    const currentPortfolio = paperPortfolioRef.current;
    if (currentPortfolio.openPosition?.copiedFrom?.positionId === source.id) {
      setCopyStatus(`Copying ${trader.displayName} · ${source.symbol}`);
      return true;
    }
    if (currentPortfolio.openPosition || currentPortfolio.pendingOrder) {
      setCopyStatus(`Skipped ${trader.displayName}'s ${source.symbol} entry · manage your current demo trade first.`);
      return false;
    }
    const sourceRiskPercent =
      (Number(source.riskAmount) / Math.max(1, Number(shared.accountBalance))) *
      Math.max(10, Math.min(200, copyScale));
    const riskPercent = Math.max(0.1, Math.min(5, sourceRiskPercent));
    const quoteResult = calculatePaperQuote({
      direction: source.direction,
      entry: source.entry,
      stop: source.stop,
      target: source.target,
      riskPercent,
      leverage: Math.max(1, Math.min(50, Number(source.leverage))),
      maintenanceMarginPercent: 0.5,
      feePercent: Math.max(0, Math.min(1, Number(source.feeRate) * 100)),
      balance: currentPortfolio.balance,
    });
    if (!quoteResult.quote) {
      setCopyStatus(`Could not copy ${trader.displayName}'s trade: ${quoteResult.error}`);
      return false;
    }
    const copiedPosition: PaperPosition = {
      ...source,
      id: `copy-${trader.id}-${source.id}`.slice(0, 120),
      quantity: quoteResult.quote.quantity,
      margin: quoteResult.quote.margin,
      liquidationPrice: quoteResult.quote.liquidationPrice,
      riskAmount: quoteResult.quote.stopLoss,
      copiedFrom: {
        traderId: trader.id,
        traderName: trader.displayName,
        positionId: source.id,
      },
    };
    replacePaperPortfolio({ ...currentPortfolio, openPosition: copiedPosition });
    setCopyStatus(`Copied ${source.direction} ${source.symbol} from ${trader.displayName}.`);
    return true;
  }
  function applyCopyClose(event: CopyTradeEvent) {
    const position = paperPortfolioRef.current.openPosition;
    if (
      !position?.copiedFrom ||
      position.copiedFrom.traderId !== event.traderId ||
      position.copiedFrom.positionId !== event.trade.positionId ||
      !Number.isFinite(Number(event.trade.exitPrice))
    ) return;
    const next = recordPaperClose(
      paperPortfolioRef.current,
      position,
      Number(event.trade.exitPrice),
      Number(event.trade.closedAtTime || Date.now() / 1000),
      event.trade.reason || "Closed manually",
    );
    replacePaperPortfolio(next);
    setCopyStatus(`Closed copied ${position.direction} ${position.symbol} from ${event.displayName}.`);
  }
  async function syncCopyTrading() {
    if (copySyncBusyRef.current) return;
    copySyncBusyRef.current = true;
    const isBootstrap = copyCursorRef.current === null;
    try {
      const after = copyCursorRef.current;
      const response = await fetch(
        after === null ? "/api/copy-trading" : `/api/copy-trading?after=${after}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const body = await response.json() as CopySnapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || "Copy trading unavailable");
      const firstSnapshot = copySnapshotRef.current === null;
      copySnapshotRef.current = body;
      setCopySnapshot(body);
      setCopyNameDraft((current) => current || body.me.displayName);
      if (firstSnapshot) setCopyShareDraft(body.me.isPublic);
      setCopyScaleDrafts((current) => {
        const next = { ...current };
        for (const follow of body.follows)
          if (next[follow.traderId] === undefined)
            next[follow.traderId] = follow.copyScale;
        return next;
      });
      if (isBootstrap) {
        copyCursorRef.current = body.cursor;
      } else {
        const sortedEvents = [...body.events].sort((a, b) => a.id - b.id);
        for (const event of sortedEvents) {
          if (event.kind === "open") {
            const follow = body.follows.find(
              (item) => item.traderId === event.traderId && item.enabled,
            );
            const trader = body.traders.find((item) => item.id === event.traderId);
            if (follow && trader && event.trade.position && event.trade.accountBalance)
              applyCopiedPosition(
                trader,
                {
                  position: event.trade.position,
                  accountBalance: event.trade.accountBalance,
                },
                follow.copyScale,
              );
          } else {
            applyCopyClose(event);
          }
        }
        copyCursorRef.current = Math.max(
          after || 0,
          ...sortedEvents.map((event) => event.id),
          body.cursor,
        );
      }
      setCopyError("");
      setCopyStatus((current) =>
        current.startsWith("Copied ") || current.startsWith("Closed copied ") || current.startsWith("Skipped ")
          ? current
          : "Live · trader updates every 2.5 seconds",
      );
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Copy trading is unavailable.");
      setCopyStatus("Reconnect to demo traders");
    } finally {
      copySyncBusyRef.current = false;
    }
  }
  async function publishCopyEvent(
    kind: "open" | "close",
    trade: CopyTradeEvent["trade"],
  ) {
    const send = async () => {
      if (!copySnapshotRef.current?.me.isPublic) return;
      try {
        const response = await fetch("/api/copy-trading/event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ kind, trade }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Trade could not be shared.");
      } catch (error) {
        setCopyError(error instanceof Error ? error.message : "Trade could not be shared.");
        setCopyStatus("Trade sharing needs attention");
      }
    };
    copyPublishQueueRef.current = copyPublishQueueRef.current.then(send, send);
    await copyPublishQueueRef.current;
  }
  const analysis = useMemo(() => {
    try {
      return candles.length ? analyze(candles) : null;
    } catch {
      return null;
    }
  }, [candles]);
  const fibonacciForDisplay = useMemo(() => {
    const fib = analysis?.fibonacci;
    if (!fib || fibDirectionMode === "auto") return fib;
    const completed = candles.filter((candle) => candle.closed);
    const windowStart = Math.max(0, completed.length - 140);
    const lowOffset = completed.findIndex(
      (candle, index) => index >= windowStart && candle.low === fib.low,
    );
    const highOffset = completed.findIndex(
      (candle, index) => index >= windowStart && candle.high === fib.high,
    );
    const lowIndex = lowOffset >= 0 ? lowOffset : fib.startIndex;
    const highIndex = highOffset >= 0 ? highOffset : fib.endIndex;
    const direction: "bullish" | "bearish" =
      fibDirectionMode === "long" ? "bullish" : "bearish";
    const range = fib.high - fib.low;
    return {
      ...fib,
      direction,
      startIndex: direction === "bullish" ? lowIndex : highIndex,
      endIndex: direction === "bullish" ? highIndex : lowIndex,
      levels: fib.levels.map((level) => ({
        ...level,
        price:
          direction === "bullish"
            ? fib.high - range * level.ratio
            : fib.low + range * level.ratio,
      })),
    };
  }, [analysis, candles, fibDirectionMode]);
  const focusedPattern =
    analysis?.patterns.find((pattern) => pattern.name === focusedPatternName) ??
    null;
  const supportLevels = useMemo(
    () =>
      analysis?.levels
        .filter((level) => level.kind === "support")
        .sort((a, b) => a.price - b.price) ?? [],
    [analysis],
  );
  const resistanceLevels = useMemo(
    () =>
      analysis?.levels
        .filter((level) => level.kind === "resistance")
        .sort((a, b) => b.price - a.price) ?? [],
    [analysis],
  );
  const visibleLevels = useMemo<DraggableLevel[]>(() => {
    const allLevels = [...(analysis?.levels ?? [])].sort(
      (a, b) => a.price - b.price,
    );
    const withDragLimits = (level: Level, rank: number): DraggableLevel => {
      const orderedIndex = allLevels.indexOf(level);
      const minPrice =
        orderedIndex > 0 ? allLevels[orderedIndex - 1].price : level.price;
      const maxPrice =
        orderedIndex >= 0 && orderedIndex < allLevels.length - 1
          ? allLevels[orderedIndex + 1].price
          : level.price;
      const dragKey = `${level.kind}-${rank}`;
      const requestedPrice = levelOverrides[dragKey] ?? level.price;
      return {
        ...level,
        price: Math.min(maxPrice, Math.max(minPrice, requestedPrice)),
        dragKey,
        originalPrice: level.price,
        minPrice,
        maxPrice,
        rank: rank + 1,
      };
    };
    const supports = showSupportZones
      ? supportLevels.flatMap((level, index) =>
          selectedSupportRanks.includes(index)
            ? [withDragLimits(level, index)]
            : [],
        )
      : [];
    const resistances = showResistanceZones
      ? resistanceLevels.flatMap((level, index) =>
          selectedResistanceRanks.includes(index)
            ? [withDragLimits(level, index)]
            : [],
        )
      : [];
    return [...supports, ...resistances];
  }, [
    analysis,
    levelOverrides,
    supportLevels,
    resistanceLevels,
    showSupportZones,
    showResistanceZones,
    selectedSupportRanks,
    selectedResistanceRanks,
  ]);
  const rangeStats = useMemo(() => {
    const source = dailyHistory.length ? dailyHistory : candles;
    const latestSource = source[source.length - 1];
    const reference = new Date((latestSource?.time ?? Date.now() / 1000) * 1000);
    const dayStart = Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    );
    const weekStart =
      dayStart - ((reference.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000;
    const monthStart = Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      1,
    );
    const yearStart = Date.UTC(reference.getUTCFullYear(), 0, 1);
    const firstSourceTime = source[0]?.time ?? Infinity;
    const hasYearCoverage =
      Boolean(dailyHistory.length) ||
      firstSourceTime * 1000 <= yearStart ||
      candles.length < 500;
    return {
      daily:
        dailyStats ||
        aggregateCandleRange(
          source.filter((candle) => candle.time * 1000 >= dayStart),
        ),
      weekly:
        weeklyStats ||
        aggregateCandleRange(
          source.filter((candle) => candle.time * 1000 >= weekStart),
        ),
      monthly: aggregateCandleRange(
        source.filter((candle) => candle.time * 1000 >= monthStart),
      ),
      yearly: hasYearCoverage
        ? aggregateCandleRange(
            source.filter((candle) => candle.time * 1000 >= yearStart),
          )
        : null,
    };
  }, [candles, dailyHistory, dailyStats, weeklyStats]);
  const activeRangeStats =
    rangeLevelPeriod === "off" ? null : rangeStats[rangeLevelPeriod];
  const activeRangeLabel =
    rangeLevelPeriod === "off" ? null : rangePeriodLabels[rangeLevelPeriod];
  const selectedMarket = useMemo(
    () =>
      markets.find(
        (market) => market.provider === provider && market.symbol === symbol,
      ),
    [markets, provider, symbol],
  );
  const marketsInScope = useMemo(
    () =>
      marketScope === "all"
        ? markets
        : markets.filter((market) => market.provider === marketScope),
    [markets, marketScope],
  );
  const filteredMarkets = useMemo(() => {
    const query = marketQuery.trim().toUpperCase();
    return query
      ? marketsInScope.filter((market) =>
          `${market.symbol} ${market.baseAsset}/${market.quoteAsset}`
            .toUpperCase()
            .includes(query),
        )
      : marketsInScope;
  }, [marketsInScope, marketQuery]);
  const marketMatches = useMemo(
    () => filteredMarkets.slice(0, 160),
    [filteredMarkets],
  );
  const loadedMarketProviderCount = new Set(
    markets.map((market) => market.provider),
  ).size;
  const marketFailuresInScope = marketScope === "all"
    ? marketFailures
    : marketFailures.filter((failure) => failure.provider === marketScope);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        signalFactorsStorageKey,
        JSON.stringify(signalFactors),
      );
    } catch {
      // Signal preferences still work for this session when storage is unavailable.
    }
  }, [signalFactors]);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        PAPER_STORAGE_KEY,
        JSON.stringify(paperPortfolio),
      );
    } catch {
      // Demo trading remains usable in this session when storage is unavailable.
    }
  }, [paperPortfolio]);
  useEffect(() => {
    setLevelOverrides({});
    setDraggingLevelKey(null);
    setReturningLevelKey(null);
    setFocusedPatternName(null);
    setPaperEntry("");
    setPaperStop("");
    setPaperTarget("");
    setPaperError("");
    zoneDragRef.current = null;
  }, [provider, symbol, interval]);
  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);
  useEffect(() => {
    if (!markets.length) return;
    try {
      window.localStorage.setItem(
        marketCatalogStorageKey,
        JSON.stringify(markets),
      );
    } catch {
      // The live exchange catalog remains usable if browser storage is unavailable.
    }
  }, [markets]);
  useEffect(() => {
    void syncCopyTrading();
    const timer = window.setInterval(() => void syncCopyTrading(), 2500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/providers")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error("AI providers unavailable");
        return {
          gemini: Boolean(body.providers?.gemini?.configured),
          venice: Boolean(body.providers?.venice?.configured),
        };
      })
      .then((available) => {
        if (cancelled) return;
        setChatProviders(available);
        setChatProvider((current) => {
          if (available[current]) return current;
          return available.venice ? "venice" : "gemini";
        });
      })
      .catch(() => {
        if (!cancelled)
          setChatProviders({ gemini: true, venice: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatMessages, chatLoading]);
  useEffect(() => {
    let cancelled = false;
    const retryTimers = new Map<string, number>();
    const controller = new AbortController();
    setMarketQuery("");
    setMarketMenu(false);
    const loadProviderMarkets = async (providerId: string) => {
      const requestController = new AbortController();
      const abortWithParent = () => requestController.abort();
      controller.signal.addEventListener("abort", abortWithParent, {
        once: true,
      });
      const timeout = window.setTimeout(() => requestController.abort(), 22000);
      try {
        const response = await fetch(
          `/api/markets?provider=${encodeURIComponent(providerId)}`,
          { signal: requestController.signal },
        );
        const body = await response.json() as {
          markets?: unknown;
          error?: string;
        };
        if (!response.ok)
          throw new Error(body.error || `${providerId} markets unavailable`);
        if (cancelled) return;
        const next = (Array.isArray(body.markets) ? body.markets : []).filter(
          (market): market is Market =>
            Boolean(market) &&
            typeof market === "object" &&
            typeof market.symbol === "string" &&
            /^[\p{L}\p{N}]{2,40}$/u.test(market.symbol) &&
            typeof market.baseAsset === "string" &&
            typeof market.quoteAsset === "string",
        ).map((market) => ({ ...market, provider: providerId }));
        if (!next.length)
          throw new Error(`${providerId} returned no active coin pairs`);
        setMarkets((current) =>
          mergeProviderMarkets(current, providerId, next),
        );
        setMarketFailures((current) =>
          current.filter(
            (failure) =>
              failure.provider !== providerId && failure.provider !== "catalog",
          ),
        );
        setMarketResolvedProviders((current) =>
          current.includes(providerId) ? current : [...current, providerId],
        );
        setMarketsLoading(false);
        return true;
      } catch (reason) {
        if (cancelled || controller.signal.aborted) return;
        setMarketsLoading(false);
        setMarketResolvedProviders((current) =>
          current.includes(providerId) ? current : [...current, providerId],
        );
        setMarketFailures((current) => [
          ...current.filter(
            (failure) =>
              failure.provider !== providerId && failure.provider !== "catalog",
          ),
          {
            provider: providerId,
            error:
              reason instanceof Error
                ? reason.message
                : `${providerId} market catalog is unavailable`,
          },
        ]);
        return false;
      } finally {
        window.clearTimeout(timeout);
        controller.signal.removeEventListener("abort", abortWithParent);
      }
    };
    const refreshProvider = async (providerId: string) => {
      setMarketsLoading(marketsRef.current.length === 0);
      const loaded = await loadProviderMarkets(providerId);
      if (cancelled) return;
      retryTimers.set(
        providerId,
        window.setTimeout(
          () => void refreshProvider(providerId),
          loaded ? 300000 : 30000,
        ),
      );
    };
    for (const exchange of exchanges) void refreshProvider(exchange.id);
    return () => {
      cancelled = true;
      controller.abort();
      for (const timer of retryTimers.values()) window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const available = markets.filter((market) => market.provider === provider);
    if (
      markets.length &&
      !available.length &&
      marketResolvedProviders.includes(provider)
    ) {
      const workingExchange = [
        "mexc",
        "bybit",
        "aster",
        "hyperliquid",
        "okx",
        "binance",
      ].find((source) =>
        markets.some((market) => market.provider === source),
      );
      const fallback =
        markets.find(
          (market) =>
            market.provider === workingExchange &&
            market.symbol === "BTCUSDT",
        ) ||
        markets.find(
          (market) =>
            market.provider === workingExchange &&
            market.symbol === "BTCUSDC",
        ) ||
        markets.find((market) => market.provider === workingExchange);
      if (fallback?.provider) {
        setProvider(fallback.provider);
        setSymbol(fallback.symbol);
      }
      return;
    }
    if (
      available.length &&
      !available.some((market) => market.symbol === symbol)
    ) {
      const fallback =
        available.find((market) => market.symbol === "BTCUSDT") ||
        available.find((market) => market.symbol === "BTCUSDC") ||
        available[0];
      setSymbol(fallback.symbol);
    }
  }, [markets, marketResolvedProviders, provider, symbol]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setTimeframeChanges({});
    setDailyStats(null);
    setWeeklyStats(null);
    setDailyHistory([]);
    Promise.allSettled(
      intervals.map(async (timeframe) => {
        const historyLimit = timeframe === "1d" ? 500 : 2;
        const response = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&provider=${provider}&limit=${historyLimit}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok || !body.candles?.length)
          throw new Error(body.error || `${timeframe} summary unavailable`);
        const history = body.candles as Candle[];
        const latest = history[history.length - 1];
        return { timeframe, latest, history };
      }),
    ).then((results) => {
      if (cancelled) return;
      const changes: Record<string, number> = {};
      let nextDailyStats: DailyStats | null = null;
      let nextWeeklyStats: DailyStats | null = null;
      let nextDailyHistory: Candle[] = [];
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        changes[result.value.timeframe] = candleChangePercent(
          result.value.latest,
        );
        if (result.value.timeframe === "1d") {
          const { time, open, high, low, close } = result.value.latest;
          nextDailyStats = { time, open, high, low, close };
          nextDailyHistory = result.value.history;
        }
        if (result.value.timeframe === "1w") {
          const { time, open, high, low, close } = result.value.latest;
          nextWeeklyStats = { time, open, high, low, close };
        }
      }
      setTimeframeChanges(changes);
      setDailyStats(nextDailyStats);
      setWeeklyStats(nextWeeklyStats);
      setDailyHistory(nextDailyHistory);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [provider, symbol, reload]);
  useEffect(() => {
    if (!chartDiv.current) return;
    const chart = createChart(chartDiv.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#101114" },
        textColor: "#9a9da5",
        fontFamily: "Inter,system-ui,sans-serif",
      },
      grid: {
        vertLines: { color: "#1d2024" },
        horzLines: { color: "#1d2024" },
      },
      rightPriceScale: {
        borderColor: "#272b31",
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: {
        borderColor: "#272b31",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
      },
      crosshair: {
        vertLine: { visible: false, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#18ad7e",
      downColor: "#e75e68",
      borderVisible: false,
      wickUpColor: "#18ad7e",
      wickDownColor: "#e75e68",
      priceLineColor: "#6b7280",
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    const ema20 = chart.addSeries(LineSeries, {
      color: "#5b9cf6",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "EMA 20",
    });
    const ema50 = chart.addSeries(LineSeries, {
      color: "#f2b84b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "EMA 50",
    });
    const sma200 = chart.addSeries(LineSeries, {
      color: "#ef73d2",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "SMA 200",
    });
    const vwap = chart.addSeries(LineSeries, {
      color: "#2ad6d0",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "VWAP 50",
    });
    const bbUpper = chart.addSeries(LineSeries, {
      color: "#9b7bea",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "BB upper",
    });
    const bbMiddle = chart.addSeries(LineSeries, {
      color: "#8a6fd2",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "BB 20",
    });
    const bbLower = chart.addSeries(LineSeries, {
      color: "#9b7bea",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "BB lower",
    });
    const dcUpper = chart.addSeries(LineSeries, {
      color: "#ee8d58",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "DC upper",
    });
    const dcMiddle = chart.addSeries(LineSeries, {
      color: "#c97549",
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "DC 20",
    });
    const dcLower = chart.addSeries(LineSeries, {
      color: "#ee8d58",
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
      title: "DC lower",
    });
    chart
      .priceScale("volume")
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const markerHandle = createSeriesMarkers(series, []);
    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
    indicatorSeries.current = {
      ema20,
      ema50,
      sma200,
      vwap,
      bbUpper,
      bbMiddle,
      bbLower,
      dcUpper,
      dcMiddle,
      dcLower,
    };
    markersRef.current = markerHandle;
    const inspectCandle = (event: { time?: Time }) => {
      if (typeof event.time !== "number") {
        setSelectedCandle(null);
        return;
      }
      const index = candlesRef.current.findIndex(
        (candle) => candle.time === event.time,
      );
      const candle = candlesRef.current[index];
      if (!candle) return;
      setSelectedCandle({
        candle,
        index,
        readings: recognizeCandlestick(candlesRef.current, index),
      });
    };
    chart.subscribeClick(inspectCandle);
    return () => {
      chart.unsubscribeClick(inspectCandle);
      levelPriceLinesRef.current = [];
      signalPriceLinesRef.current = [];
      paperPriceLinesRef.current = [];
      markersRef.current = null;
      indicatorSeries.current = null;
      volumeRef.current = null;
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let socketRetry: number | undefined;
    let dataRetry: number | undefined;
    let heartbeat: number | undefined;
    let loadFailures = 0;
    let activeLoadController: AbortController | null = null;
    const candleKey = savedCandlesKey(provider, symbol, interval);
    const savedCandles = readSavedCandles(candleKey);
    if (savedCandles.length >= 2) {
      candlesRef.current = savedCandles;
      setCandles(savedCandles);
      seriesRef.current?.setData(
        savedCandles.map((candle) => ({
          time: candle.time as Time,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
      volumeRef.current?.setData(
        savedCandles.map((candle) => ({
          time: candle.time as Time,
          value: candle.volume,
          color: candle.close >= candle.open ? "#18ad7e45" : "#e75e6845",
        })),
      );
      chartRef.current?.timeScale().fitContent();
    } else {
      candlesRef.current = [];
      setCandles([]);
    }
    setLoading(savedCandles.length < 2);
    setError("");
    setLive(false);
    setSelectedCandle(null);
    setAiText("");
    setSignalPlan(null);
    setSignalError("");
    async function load() {
      if (cancelled) return;
      if (dataRetry !== undefined) {
        window.clearTimeout(dataRetry);
        dataRetry = undefined;
      }
      const requestController = new AbortController();
      activeLoadController = requestController;
      const requestTimeout = window.setTimeout(
        () => requestController.abort(),
        35000,
      );
      try {
        const response = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&provider=${provider}`,
          { signal: requestController.signal, cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Market data unavailable");
        if (cancelled) return;
        loadFailures = 0;
        setError(body.stale ? body.warning || "Showing the last saved candles." : "");
        candlesRef.current = body.candles;
        setCandles(body.candles);
        try {
          window.localStorage.setItem(candleKey, JSON.stringify(body.candles));
        } catch {
          // The chart still works when browser storage is unavailable.
        }
        const latest = body.candles[body.candles.length - 1] as Candle;
        setTimeframeChanges((current) => ({
          ...current,
          [interval]: candleChangePercent(latest),
        }));
        if (interval === "1d") {
          const { time, open, high, low, close } = latest;
          setDailyStats({ time, open, high, low, close });
          setDailyHistory(body.candles);
        }
        if (interval === "1w") {
          const { time, open, high, low, close } = latest;
          setWeeklyStats({ time, open, high, low, close });
        }
        seriesRef.current?.setData(
          body.candles.map((c: Candle) => ({
            time: c.time as Time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        volumeRef.current?.setData(
          body.candles.map((c: Candle) => ({
            time: c.time as Time,
            value: c.volume,
            color: c.close >= c.open ? "#18ad7e45" : "#e75e6845",
          })),
        );
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: Math.max(0, body.candles.length - 140),
          to: body.candles.length + 5,
        });
        setLoading(false);
        connect();
      } catch (e) {
        if (!cancelled) {
          const delay = Math.min(30000, 1500 * 2 ** Math.min(loadFailures, 4));
          loadFailures += 1;
          const message = e instanceof Error
            ? e.message
            : "Failed to load market data";
          setError(`${message} · ${candlesRef.current.length >= 2 ? "showing saved candles · " : ""}retrying in ${Math.ceil(delay / 1000)}s`);
          setLoading(false);
          dataRetry = window.setTimeout(() => {
            dataRetry = undefined;
            void load();
          }, delay);
        }
      } finally {
        window.clearTimeout(requestTimeout);
        if (activeLoadController === requestController)
          activeLoadController = null;
      }
    }
    function applyLiveCandle(c: Candle) {
      const current = candlesRef.current;
      const existing = current.findIndex((v) => v.time === c.time);
      let next: Candle[];
      if (existing >= 0) {
        next = current.slice();
        next[existing] = c;
      } else {
        next = [...current, c].sort((a, b) => a.time - b.time).slice(-500);
      }
      candlesRef.current = next;
      const activeTrade = paperPortfolioRef.current.openPosition ??
        paperPortfolioRef.current.pendingOrder;
      const lastPaperMark = paperLiveMarkRef.current;
      if (
        activeTrade?.provider === provider &&
        activeTrade.symbol === symbol &&
        (lastPaperMark?.positionId !== activeTrade.id ||
          Date.now() - lastPaperMark.updatedAt >= 6000)
      ) {
        // If the exchange mark endpoint is delayed, keep the demo position tied
        // to the exact last-traded price being drawn by this live chart.
        processPaperMarketTick(activeTrade.id, c.close, Date.now());
      }
      setCandles(next);
      if (c.closed) {
        try {
          window.localStorage.setItem(candleKey, JSON.stringify(next));
        } catch {
          // Keep the live chart usable even when local storage is full or blocked.
        }
      }
      setTimeframeChanges((current) => ({
        ...current,
        [interval]: candleChangePercent(c),
      }));
      if (interval === "1d") {
        const { time, open, high, low, close } = c;
        setDailyStats({ time, open, high, low, close });
        setDailyHistory((history) => {
          const existingDay = history.findIndex((day) => day.time === c.time);
          if (existingDay < 0) return [...history, c].slice(-500);
          const nextHistory = history.slice();
          nextHistory[existingDay] = c;
          return nextHistory;
        });
      }
      if (interval === "1w") {
        const { time, open, high, low, close } = c;
        setWeeklyStats({ time, open, high, low, close });
      }
      setSelectedCandle((selected) =>
        selected?.candle.time === c.time
          ? {
              candle: c,
              index: selected.index,
              readings: recognizeCandlestick(next, selected.index),
            }
          : selected,
      );
      seriesRef.current?.update({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      });
      volumeRef.current?.update({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? "#18ad7e45" : "#e75e6845",
      });
    }
    function connect() {
      if (cancelled) return;
      const url =
        provider === "binance"
          ? `wss://data-stream.binance.vision:443/ws/${encodeURIComponent(symbol.toLowerCase())}@kline_${interval}`
          : provider === "bybit"
            ? "wss://stream.bytick.com/v5/public/linear"
            : provider === "okx"
              ? "wss://ws.okx.com:8443/ws/v5/business"
              : provider === "aster"
                ? `wss://fstream.asterdex.com/ws/${encodeURIComponent(symbol.toLowerCase())}@kline_${interval}`
                : provider === "hyperliquid"
                  ? "wss://api.hyperliquid.xyz/ws"
                  : "wss://wbs-api.mexc.com/ws";
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        if (cancelled) return;
        if (provider === "bybit")
          ws?.send(
            JSON.stringify({
              op: "subscribe",
              args: [`kline.${bybitIntervals[interval]}.${symbol}`],
            }),
          );
        if (provider === "okx")
          ws?.send(
            JSON.stringify({
              op: "subscribe",
              args: [
                {
                  channel: okxChannels[interval],
                  instId: `${symbol.slice(0, -4)}-USDT`,
                },
              ],
            }),
          );
        if (provider === "hyperliquid") {
          const coin =
            marketsRef.current.find(
              (market) =>
                market.provider === provider && market.symbol === symbol,
            )?.apiSymbol || symbol.slice(0, -4);
          ws?.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { type: "candle", coin, interval },
            }),
          );
        }
        if (provider === "mexc") {
          ws?.send(
            JSON.stringify({
              method: "SUBSCRIPTION",
              params: [
                `spot@public.kline.v3.api.pb@${symbol}@${mexcIntervals[interval]}`,
              ],
            }),
          );
          heartbeat = window.setInterval(
            () =>
              ws?.readyState === WebSocket.OPEN &&
              ws.send(JSON.stringify({ method: "PING" })),
            20000,
          );
        }
        setLive(true);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          let c: Candle | null = null;
          if (provider === "mexc" && event.data instanceof ArrayBuffer) {
            const message = mexcKlineWrapper.toObject(
                mexcKlineWrapper.decode(new Uint8Array(event.data)),
                { longs: Number },
              ) as any,
              k = message.publicSpotKline;
            if (k)
              c = {
                time: +k.windowStart,
                open: +k.openingPrice,
                high: +k.highestPrice,
                low: +k.lowestPrice,
                close: +k.closingPrice,
                volume: +k.volume,
                closed: +k.windowEnd * 1000 <= Date.now(),
              };
          } else {
            const message = JSON.parse(String(event.data));
            if ((provider === "binance" || provider === "aster") && message.k) {
              const k = message.k;
              c = {
                time: Math.floor(k.t / 1000),
                open: +k.o,
                high: +k.h,
                low: +k.l,
                close: +k.c,
                volume: +k.v,
                closed: !!k.x,
              };
            } else if (provider === "bybit" && message.data?.[0]) {
              const k = message.data[0];
              c = {
                time: Math.floor(+k.start / 1000),
                open: +k.open,
                high: +k.high,
                low: +k.low,
                close: +k.close,
                volume: +k.volume,
                closed: !!k.confirm,
              };
            } else if (provider === "okx" && message.data?.[0]) {
              const k = message.data[0];
              c = {
                time: Math.floor(+k[0] / 1000),
                open: +k[1],
                high: +k[2],
                low: +k[3],
                close: +k[4],
                volume: +k[5],
                closed: k[8] === "1",
              };
            } else if (
              provider === "hyperliquid" &&
              message.channel === "candle" &&
              message.data
            ) {
              const k = Array.isArray(message.data)
                ? message.data[message.data.length - 1]
                : message.data;
              c = {
                time: Math.floor(+k.t / 1000),
                open: +k.o,
                high: +k.h,
                low: +k.l,
                close: +k.c,
                volume: +k.v,
                closed: +k.T < Date.now(),
              };
            }
          }
          if (c) applyLiveCandle(c);
        } catch {
          /* Ignore malformed exchange message */
        }
      };
      ws.onclose = () => {
        window.clearInterval(heartbeat);
        if (!cancelled) {
          setLive(false);
          socketRetry = window.setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => ws?.close();
    }
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(socketRetry);
      window.clearTimeout(dataRetry);
      window.clearInterval(heartbeat);
      activeLoadController?.abort();
      ws?.close();
    };
  }, [symbol, interval, provider, reload]);
  useEffect(() => {
    const series = indicatorSeries.current;
    if (!series) return;
    series.ema20.setData(emaLine(candles, 20));
    series.ema50.setData(emaLine(candles, 50));
    series.sma200.setData(smaLine(candles, 200));
    series.vwap.setData(rollingVwapLine(candles));
    const bands = bollingerLines(candles);
    series.bbUpper.setData(bands.upper);
    series.bbMiddle.setData(bands.middle);
    series.bbLower.setData(bands.lower);
    const channels = donchianLines(candles);
    series.dcUpper.setData(channels.upper);
    series.dcMiddle.setData(channels.middle);
    series.dcLower.setData(channels.lower);
  }, [candles]);
  useEffect(() => {
    const series = indicatorSeries.current;
    if (!series) return;
    series.ema20.applyOptions({ visible: indicators.ema20 });
    series.ema50.applyOptions({ visible: indicators.ema50 });
    series.sma200.applyOptions({ visible: indicators.sma200 });
    series.vwap.applyOptions({ visible: indicators.vwap });
    series.bbUpper.applyOptions({ visible: indicators.bollinger });
    series.bbMiddle.applyOptions({ visible: indicators.bollinger });
    series.bbLower.applyOptions({ visible: indicators.bollinger });
    series.dcUpper.applyOptions({ visible: indicators.donchian });
    series.dcMiddle.applyOptions({ visible: indicators.donchian });
    series.dcLower.applyOptions({ visible: indicators.donchian });
  }, [indicators]);
  useEffect(() => {
    if (!analysis) {
      markersRef.current?.setMarkers([]);
      return;
    }
    const completed = candles.filter((c) => c.closed),
      markers: any[] = [];
    if (showPivots) {
      const markedPivots = [
        ...analysis.pivots
          .filter((pivot) => pivot.kind === "high")
          .slice(-8),
        ...analysis.pivots
          .filter((pivot) => pivot.kind === "low")
          .slice(-8),
      ].sort((a, b) => a.index - b.index);
      markers.push(
        ...markedPivots.flatMap((p) =>
          completed[p.index]
            ? [
                {
                  time: completed[p.index].time as Time,
                  position:
                    p.kind === "high"
                      ? ("aboveBar" as const)
                      : ("belowBar" as const),
                  color: p.kind === "high" ? "#e5ae6e" : "#5ecda5",
                  shape: "circle" as const,
                  text: `${p.kind === "high" ? "PH" : "PL"} · ${p.price.toLocaleString(undefined, { maximumFractionDigits: p.price >= 10 ? 2 : 6 })}`,
                },
              ]
            : [],
        ),
      );
    }
    if (concepts.structure)
      markers.push(
        ...analysis.smartMoney.structureEvents.flatMap((event) =>
          completed[event.index]
            ? [
                {
                  time: completed[event.index].time as Time,
                  position:
                    event.direction === "bullish"
                      ? ("belowBar" as const)
                      : ("aboveBar" as const),
                  color:
                    event.kind === "CHOCH"
                      ? "#eecb66"
                      : event.direction === "bullish"
                        ? "#36d6a0"
                        : "#ed7781",
                  shape:
                    event.direction === "bullish"
                      ? ("arrowUp" as const)
                      : ("arrowDown" as const),
                  text: `${event.kind} ${event.direction === "bullish" ? "↑" : "↓"}`,
                },
              ]
            : [],
        ),
      );
    if (signalPlan && signalPlan.direction !== "WAIT") {
      const signalCandle = completed.find(
        (candle) => candle.time === signalPlan.time,
      );
      if (signalCandle) {
        const isLong = signalPlan.direction === "LONG";
        markers.push({
          time: signalCandle.time as Time,
          position: isLong ? ("belowBar" as const) : ("aboveBar" as const),
          color: isLong ? "#35d6a0" : "#ef7782",
          shape: isLong ? ("arrowUp" as const) : ("arrowDown" as const),
          text: `${signalPlan.direction} ENTRY`,
        });
      }
    }
    markersRef.current?.setMarkers(
      markers.sort((a, b) => (a.time as number) - (b.time as number)),
    );
  }, [analysis, showPivots, concepts.structure, candles, signalPlan]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const priceLine of signalPriceLinesRef.current)
      series.removePriceLine(priceLine);
    signalPriceLinesRef.current = [];
    if (!signalPlan) return;

    const addLine = (
      price: number | null,
      title: string,
      color: string,
      axisLabelColor: string,
      lineStyle: LineStyle,
    ) => {
      if (price === null || !Number.isFinite(price)) return;
      signalPriceLinesRef.current.push(
        series.createPriceLine({
          price,
          title,
          color,
          axisLabelColor,
          axisLabelTextColor: "#ffffff",
          lineWidth: 2,
          lineStyle,
          lineVisible: true,
          axisLabelVisible: true,
        }),
      );
    };

    if (signalPlan.direction === "LONG") {
      addLine(signalPlan.entry, "LONG ENTRY", "#35d6a0", "#176b55", LineStyle.Solid);
      addLine(signalPlan.stop, "INVALIDATION", "#ef7782", "#803c43", LineStyle.Dashed);
      addLine(signalPlan.target, "TARGET", "#e6b95d", "#7c612b", LineStyle.Dashed);
    } else if (signalPlan.direction === "SHORT") {
      addLine(signalPlan.entry, "SHORT ENTRY", "#ef7782", "#803c43", LineStyle.Solid);
      addLine(signalPlan.stop, "INVALIDATION", "#d88b91", "#803c43", LineStyle.Dashed);
      addLine(signalPlan.target, "TARGET", "#e6b95d", "#7c612b", LineStyle.Dashed);
    } else {
      addLine(signalPlan.buyTrigger, "WATCH LONG", "#35d6a0", "#176b55", LineStyle.Dotted);
      addLine(signalPlan.sellTrigger, "WATCH SHORT", "#ef7782", "#803c43", LineStyle.Dotted);
    }
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    return () => {
      for (const priceLine of signalPriceLinesRef.current)
        series.removePriceLine(priceLine);
      signalPriceLinesRef.current = [];
    };
  }, [signalPlan]);
  useEffect(() => {
    const series = seriesRef.current;
    const position = paperPortfolio.openPosition;
    const pendingOrder = paperPortfolio.pendingOrder;
    for (const priceLine of paperPriceLinesRef.current)
      series?.removePriceLine(priceLine);
    paperPriceLinesRef.current = [];
    if (
      !series ||
      (!position && !pendingOrder) ||
      (position && (position.provider !== provider || position.symbol !== symbol)) ||
      (pendingOrder && (pendingOrder.provider !== provider || pendingOrder.symbol !== symbol))
    ) return;

    const addPaperLine = (
      price: number,
      title: string,
      color: string,
      lineStyle: LineStyle,
    ) => {
      paperPriceLinesRef.current.push(
        series.createPriceLine({
          price,
          title,
          color,
          axisLabelColor: color,
          axisLabelTextColor: "#ffffff",
          lineWidth: 2,
          lineStyle,
          lineVisible: true,
          axisLabelVisible: true,
        }),
      );
    };
    if (position) {
      const exchangeMark = paperLiveMark?.positionId === position.id &&
        paperMarkFeedState === "live" &&
        Date.now() - paperLiveMark.updatedAt < 6000
        ? paperLiveMark.price
        : null;
      const lastChartPrice = position.provider === provider && position.symbol === symbol
        ? candlesRef.current[candlesRef.current.length - 1]?.close
        : null;
      const liveMark = exchangeMark ?? lastChartPrice ?? position.markPrice;
      addPaperLine(position.entry, `DEMO ${position.direction} ENTRY`, "#69a9ff", LineStyle.Solid);
      addPaperLine(liveMark, "DEMO P&L PRICE", "#f0bd69", LineStyle.Dotted);
      addPaperLine(position.stop, "DEMO STOP", "#ef7782", LineStyle.Dashed);
      addPaperLine(position.target, "DEMO TARGET", "#45d6a3", LineStyle.Dashed);
      addPaperLine(position.liquidationPrice, "EST. LIQ.", "#d58cff", LineStyle.Dotted);
    } else if (pendingOrder) {
      addPaperLine(pendingOrder.limitPrice, `PENDING ${pendingOrder.direction}`, "#69a9ff", LineStyle.Dotted);
      addPaperLine(pendingOrder.stop, "PENDING STOP", "#ef7782", LineStyle.Dashed);
      addPaperLine(pendingOrder.target, "PENDING TARGET", "#45d6a3", LineStyle.Dashed);
    }
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    return () => {
      for (const priceLine of paperPriceLinesRef.current)
        series.removePriceLine(priceLine);
      paperPriceLinesRef.current = [];
    };
  }, [candles, interval, paperPortfolio.openPosition, paperPortfolio.pendingOrder, paperLiveMark, paperMarkFeedState, provider, symbol]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const priceLine of levelPriceLinesRef.current)
      series.removePriceLine(priceLine);
    levelPriceLinesRef.current = [];
    if (!visibleLevels.length && !activeRangeStats) {
      series.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    series.applyOptions({
      autoscaleInfoProvider: (
        original: Parameters<AutoscaleInfoProvider>[0],
      ) => {
        const info = original();
        if (!info || !info.priceRange) return info;
        const zoneBand = analysis
          ? Math.max(analysis.atr * 0.35, analysis.last * 0.001)
          : 0;
        const selectedLows = visibleLevels.map(
          (level) => level.price - zoneBand,
        );
        const selectedHighs = visibleLevels.map(
          (level) => level.price + zoneBand,
        );
        if (activeRangeStats) {
          selectedLows.push(activeRangeStats.low);
          selectedHighs.push(activeRangeStats.high);
        }
        const minValue = Math.min(info.priceRange.minValue, ...selectedLows);
        const maxValue = Math.max(info.priceRange.maxValue, ...selectedHighs);
        const padding = Math.max(
          (maxValue - minValue) * 0.025,
          maxValue * 0.001,
        );
        return {
          ...info,
          priceRange: {
            minValue: minValue - padding,
            maxValue: maxValue + padding,
          },
        };
      },
    });
    const nextPriceLines = visibleLevels.map((level) => {
      const shortKind = level.kind === "support" ? "S" : "R";
      return series.createPriceLine({
        price: level.price,
        color: level.kind === "support" ? "#3fd0a0" : "#eb7f88",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        lineVisible: true,
        axisLabelVisible: true,
        axisLabelColor: level.kind === "support" ? "#176b55" : "#803c43",
        axisLabelTextColor: "#ffffff",
        title: `${shortKind}${level.rank} · ${level.touches} touches`,
      });
    });
    if (activeRangeStats && activeRangeLabel) {
      nextPriceLines.push(
        series.createPriceLine({
          price: activeRangeStats.high,
          color: "#e6b95d",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lineVisible: true,
          axisLabelVisible: true,
          axisLabelColor: "#7c612b",
          axisLabelTextColor: "#ffffff",
          title: `${activeRangeLabel} ATH`,
        }),
        series.createPriceLine({
          price: activeRangeStats.low,
          color: "#779bf2",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          lineVisible: true,
          axisLabelVisible: true,
          axisLabelColor: "#3b5184",
          axisLabelTextColor: "#ffffff",
          title: `${activeRangeLabel} ATL`,
        }),
      );
    }
    levelPriceLinesRef.current = nextPriceLines;
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    return () => {
      for (const priceLine of levelPriceLinesRef.current)
        series.removePriceLine(priceLine);
      levelPriceLinesRef.current = [];
      series.applyOptions({ autoscaleInfoProvider: undefined });
    };
  }, [activeRangeLabel, activeRangeStats, analysis, visibleLevels]);
  useEffect(() => {
    const chart = chartRef.current,
      series = seriesRef.current,
      container = chartDiv.current;
    if (!chart || !series || !container || !analysis || !visibleLevels.length) {
      setZoneRects([]);
      return;
    }
    const update = () => {
      const band = Math.max(analysis.atr * 0.28, analysis.last * 0.0008);
      const zones = visibleLevels.flatMap((level) => {
        const high = series.priceToCoordinate(level.price + band),
          low = series.priceToCoordinate(level.price - band);
        if (high === null || low === null) return [];
        return [
          {
            top: Math.min(high, low),
            height: Math.max(6, Math.abs(low - high)),
            kind: level.kind,
            price: level.price,
            touches: level.touches,
            dragKey: level.dragKey,
            originalPrice: level.originalPrice,
            minPrice: level.minPrice,
            maxPrice: level.maxPrice,
            rank: level.rank,
          } as ZoneRect,
        ];
      });
      setZoneRects(zones);
    };
    update();
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
      observer.disconnect();
    };
  }, [analysis, visibleLevels]);
  useEffect(() => {
    const chart = chartRef.current,
      series = seriesRef.current,
      container = chartDiv.current;
    if (!chart || !series || !container || !analysis) {
      setConceptRects([]);
      setFibLines([]);
      return;
    }
    const update = () => {
      const completed = candles.filter((c) => c.closed),
        rightEdge = Math.max(0, container.clientWidth - 64),
        timeScale = chart.timeScale();
      const xAt = (index: number) =>
        completed[index]
          ? timeScale.timeToCoordinate(completed[index].time as Time)
          : null;
      const rectFor = (
        startIndex: number,
        endIndex: number,
        low: number,
        high: number,
        kind: ConceptRect["kind"],
        label: string,
        muted: boolean,
      ): ConceptRect[] => {
        const start = xAt(startIndex),
          end = xAt(endIndex),
          top = series.priceToCoordinate(high),
          bottom = series.priceToCoordinate(low);
        if (start === null || end === null || top === null || bottom === null)
          return [];
        const left = Math.max(0, Math.min(start, end)),
          right = Math.min(rightEdge, Math.max(start, end) + 18);
        return right <= left
          ? []
          : [
              {
                left,
                width: Math.max(12, right - left),
                top: Math.min(top, bottom),
                height: Math.max(5, Math.abs(bottom - top)),
                low,
                high,
                kind,
                label,
                muted,
              },
            ];
      };
      const rectangles: ConceptRect[] = [];
      if (concepts.fairValueGaps) {
        const active = analysis.smartMoney.fairValueGaps
            .filter((gap) => !gap.mitigated)
            .slice(-8),
          gaps = active.length
            ? active
            : analysis.smartMoney.fairValueGaps.slice(-4);
        for (const gap of gaps)
          rectangles.push(
            ...rectFor(
              gap.startIndex,
              gap.endIndex,
              gap.low,
              gap.high,
              `fvg-${gap.direction}` as ConceptRect["kind"],
              `${gap.direction === "bullish" ? "Bull" : "Bear"} FVG`,
              gap.mitigated,
            ),
          );
      }
      if (concepts.orderBlocks) {
        for (const block of analysis.smartMoney.orderBlocks.slice(-6))
          rectangles.push(
            ...rectFor(
              block.index,
              block.endIndex,
              block.low,
              block.high,
              `ob-${block.direction}` as ConceptRect["kind"],
              `${block.direction === "bullish" ? "Bull" : "Bear"} OB`,
              block.mitigated,
            ),
          );
      }
      setConceptRects(rectangles);
      if (concepts.fibonacci && fibonacciForDisplay) {
        const start = xAt(fibonacciForDisplay.startIndex),
          end = xAt(fibonacciForDisplay.endIndex);
        if (start !== null && end !== null) {
          const left = Math.max(0, Math.min(start, end));
          setFibLines(
            fibonacciForDisplay.levels.flatMap((level) => {
              const top = series.priceToCoordinate(level.price);
              return top === null
                ? []
                : [
                    {
                      left,
                      width: Math.max(20, rightEdge - left),
                      top,
                      ratio: level.ratio,
                      price: level.price,
                      name: fibName(level.ratio, fibonacciForDisplay.direction),
                    },
                  ];
            }),
          );
        } else setFibLines([]);
      } else setFibLines([]);
    };
    update();
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
      observer.disconnect();
    };
  }, [
    analysis,
    fibonacciForDisplay,
    candles,
    concepts.fibonacci,
    concepts.fairValueGaps,
    concepts.orderBlocks,
  ]);
  useEffect(() => {
    const chart = chartRef.current,
      series = seriesRef.current,
      container = chartDiv.current;
    if (!chart || !series || !container || !focusedPattern) {
      setPatternDrawing(null);
      return;
    }
    const completed = candles.filter((candle) => candle.closed);
    const update = () => {
      const timeScale = chart.timeScale();
      const coordinateAt = (index: number, price: number) => {
        const candle = completed[index];
        if (!candle) return null;
        const x = timeScale.timeToCoordinate(candle.time as Time);
        const y = series.priceToCoordinate(price);
        return x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)
          ? null
          : { x, y };
      };
      const segments = focusedPattern.segments.flatMap((segment) => {
        const from = coordinateAt(segment.from.index, segment.from.price);
        const to = coordinateAt(segment.to.index, segment.to.price);
        return from && to
          ? [{ x1: from.x, y1: from.y, x2: to.x, y2: to.y }]
          : [];
      });
      const points = focusedPattern.points.flatMap((point) => {
        const coordinate = coordinateAt(point.index, point.price);
        return coordinate ? [{ ...coordinate, label: point.label }] : [];
      });
      setPatternDrawing({ segments, points });
    };
    update();
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    window.addEventListener("pointermove", update);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
      observer.disconnect();
      window.removeEventListener("pointermove", update);
    };
  }, [candles, focusedPattern]);
  const current = candles.length ? candles[candles.length - 1] : null;
  const matchingPaperOrderBook = paperOrderBook?.provider === provider &&
    paperOrderBook.symbol === symbol
    ? paperOrderBook
    : null;
  const paperBookIsFresh = Boolean(
    matchingPaperOrderBook &&
    matchingPaperOrderBook.source === "websocket" &&
    paperBookFeedState === "live" &&
    Date.now() - matchingPaperOrderBook.updatedAt < 5000,
  );
  const paperExecutablePrice = matchingPaperOrderBook
    ? paperDirection === "LONG"
      ? matchingPaperOrderBook.bestAsk
      : matchingPaperOrderBook.bestBid
    : null;
  const paperLimitPriceValue = paperEntry.trim()
    ? Number(paperEntry)
    : current?.close ?? 0;
  const paperLimitIsMarketable = Boolean(paperBookIsFresh && matchingPaperOrderBook && (
    paperDirection === "LONG"
      ? paperLimitPriceValue >= matchingPaperOrderBook.bestAsk
      : paperLimitPriceValue <= matchingPaperOrderBook.bestBid
  ));
  const paperEntryValue = paperOrderType === "MARKET" || paperLimitIsMarketable
    ? paperExecutablePrice ?? current?.close ?? 0
    : paperLimitPriceValue;
  const paperStopDistance = Math.max(
    (analysis?.atr ?? paperEntryValue * 0.01) * 1.5,
    paperEntryValue * 0.001,
  );
  const defaultPaperStop = paperDirection === "LONG"
    ? paperEntryValue - paperStopDistance
    : paperEntryValue + paperStopDistance;
  const defaultPaperTarget = paperDirection === "LONG"
    ? paperEntryValue + paperStopDistance * 2
    : paperEntryValue - paperStopDistance * 2;
  const paperStopValue = paperStop.trim() ? Number(paperStop) : defaultPaperStop;
  const paperTargetValue = paperTarget.trim()
    ? Number(paperTarget)
    : defaultPaperTarget;
  const paperQuoteResult = current && (paperOrderType !== "MARKET" || paperBookIsFresh)
    ? calculatePaperQuote({
        direction: paperDirection,
        entry: paperEntryValue,
        stop: paperStopValue,
        target: paperTargetValue,
        riskPercent: Number(paperRiskPercent),
        leverage: Number(paperLeverage),
        maintenanceMarginPercent: Number(paperMaintenanceMarginPercent),
        feePercent: Number(paperFeePercent),
        balance: paperPortfolio.balance,
      })
    : {
        quote: null,
        error: current
          ? "Waiting for a synchronized live order book before market execution."
          : "Waiting for price data.",
      };
  const activePaperPosition = paperPortfolio.openPosition;
  const canSubmitPaperDirection = (direction: PaperDirection) => {
    if (!current || paperPortfolio.pendingOrder) return false;
    if (paperOrderType === "MARKET" && !paperBookIsFresh) return false;
    if (!activePaperPosition) return true;
    return activePaperPosition.provider === provider &&
      activePaperPosition.symbol === symbol &&
      activePaperPosition.direction !== direction &&
      paperOrderType === "MARKET";
  };
  const paperCanReverseAtMarket = Boolean(
    activePaperPosition && canSubmitPaperDirection(paperDirection),
  );
  const paperHistoryNetPnl = paperPortfolio.history.reduce(
    (total, trade) => total + trade.pnl,
    0,
  );
  const paperHistoryWins = paperPortfolio.history.filter((trade) => trade.pnl > 0).length;
  const paperHistoryWinRate = paperPortfolio.history.length
    ? (paperHistoryWins / paperPortfolio.history.length) * 100
    : 0;
  const visiblePaperHistory = paperPortfolio.history.filter((trade) =>
    paperHistoryFilter === "ALL" ||
    (paperHistoryFilter === "WINS" ? trade.pnl > 0 : trade.pnl <= 0),
  );
  const paperBookDepthMax = matchingPaperOrderBook
    ? Math.max(
        1,
        ...matchingPaperOrderBook.bids.map((level) => level.cumulativeQuote),
        ...matchingPaperOrderBook.asks.map((level) => level.cumulativeQuote),
      )
    : 1;
  const displayedPaperAsks = matchingPaperOrderBook
    ? [...matchingPaperOrderBook.asks].slice(0, 8).reverse()
    : [];
  const displayedPaperBids = matchingPaperOrderBook
    ? matchingPaperOrderBook.bids.slice(0, 8)
    : [];
  const watchedPaperTrade = activePaperPosition ?? paperPortfolio.pendingOrder;
  const watchedPaperTradeKind = activePaperPosition
    ? "position"
    : paperPortfolio.pendingOrder
      ? "order"
      : "inactive";
  const watchedPaperTradeId = watchedPaperTrade?.id ?? null;
  const watchedPaperProvider = watchedPaperTrade?.provider ?? null;
  const watchedPaperSymbol = watchedPaperTrade?.symbol ?? null;
  const matchedPaperLiveMark = activePaperPosition &&
    paperLiveMark?.positionId === activePaperPosition.id
    ? paperLiveMark
    : null;
  const matchedPendingLiveMark = paperPortfolio.pendingOrder &&
    paperLiveMark?.positionId === paperPortfolio.pendingOrder.id
    ? paperLiveMark
    : null;
  const chartPaperPrice = activePaperPosition &&
    activePaperPosition.provider === provider &&
    activePaperPosition.symbol === symbol &&
    current && Number.isFinite(current.close) && current.close > 0
    ? current.close
    : null;
  const exchangeMarkIsFresh = Boolean(
    matchedPaperLiveMark &&
    paperMarkFeedState === "live" &&
    Date.now() - matchedPaperLiveMark.updatedAt < 6000,
  );
  const paperMarkPrice = exchangeMarkIsFresh && matchedPaperLiveMark
    ? matchedPaperLiveMark.price
    : chartPaperPrice ?? activePaperPosition?.markPrice ?? activePaperPosition?.entry ?? 0;
  const paperMarkIsLive = Boolean(
    exchangeMarkIsFresh || (!exchangeMarkIsFresh && chartPaperPrice !== null && live),
  );
  const paperPriceSourceLabel = exchangeMarkIsFresh
    ? `EXCHANGE ${matchedPaperLiveMark?.markKind.toUpperCase()}`
    : chartPaperPrice !== null
      ? live ? "LIVE CHART LAST" : "CHART LAST"
      : "LAST SAVED PRICE";
  const paperUnrealizedPnl = activePaperPosition && paperMarkPrice > 0
    ? paperGrossPositionPnl(activePaperPosition, paperMarkPrice)
    : null;
  const paperEstimatedNetClosePnl = activePaperPosition && paperMarkPrice > 0
    ? paperPositionPnl(activePaperPosition, paperMarkPrice)
    : null;
  const paperUnrealizedReturn =
    paperUnrealizedPnl !== null && activePaperPosition && activePaperPosition.margin > 0
      ? (paperUnrealizedPnl / activePaperPosition.margin) * 100
      : null;
  const paperOutcomeClass = paperUnrealizedPnl === null
    ? ""
    : paperUnrealizedPnl > 0
      ? "positive"
      : paperUnrealizedPnl < 0
        ? "negative"
        : "neutral";
  const paperEquity = paperPortfolio.balance + (paperUnrealizedPnl ?? 0);
  const paperAvailable = paperPortfolio.balance -
    (activePaperPosition?.margin ?? 0) -
    (paperPortfolio.pendingOrder?.margin ?? 0);
  useEffect(() => {
    if (!watchedPaperTradeId || !watchedPaperProvider || !watchedPaperSymbol) {
      replacePaperLiveMark(null);
      setPaperMarkFeedState("inactive");
      return;
    }

    const positionId = watchedPaperTradeId;
    const markProvider = watchedPaperProvider;
    const markSymbol = watchedPaperSymbol;
    let cancelled = false;
    let retryTimer: number | undefined;
    let controller: AbortController | null = null;
    let retryDelay = 1200;
    replacePaperLiveMark(null);
    setPaperMarkFeedState("connecting");

    async function pollMarkPrice() {
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/mark-price?provider=${encodeURIComponent(markProvider)}&symbol=${encodeURIComponent(markSymbol)}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Price feed unavailable");
        const price = Number(body.price);
        if (!Number.isFinite(price) || price <= 0)
          throw new Error("Exchange returned an invalid mark price");
        if (cancelled) return;

        const updatedAt = Number(body.updatedAt) || Date.now();
        const mark: PaperLiveMark = {
          positionId,
          price,
          markKind: body.markKind === "mark" ? "mark" : "last",
          updatedAt,
        };
        replacePaperLiveMark(mark);
        setPaperMarkFeedState("live");
        processPaperMarketTick(positionId, price, updatedAt);
        retryDelay = 1200;
      } catch {
        if (!cancelled) {
          setPaperMarkFeedState("stale");
          retryDelay = Math.min(8000, Math.max(2000, retryDelay * 1.5));
        }
      } finally {
        if (!cancelled) retryTimer = window.setTimeout(pollMarkPrice, retryDelay);
      }
    }

    void pollMarkPrice();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      controller?.abort();
    };
  }, [
    watchedPaperTradeId,
    watchedPaperTradeKind,
    watchedPaperProvider,
    watchedPaperSymbol,
  ]);
  useEffect(() => {
    setPaperOrderBook(null);
    setPaperBookFeedState("connecting");
    const stream = new EventSource(
      `/api/orderbook/stream?provider=${encodeURIComponent(provider)}&symbol=${encodeURIComponent(symbol)}`,
    );
    stream.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data) as Record<string, unknown>;
        if (update.type === "state") {
          const state = String(update.state || "stale");
          if (["connecting", "live", "stale", "reconnecting", "syncing"].includes(state))
            setPaperBookFeedState(state as PaperBookFeedState);
          return;
        }
        if (update.type !== "book" || update.provider !== provider || update.symbol !== symbol) return;
        setPaperOrderBook({
          provider,
          symbol,
          marketType: String(update.marketType || "spot"),
          source: "websocket",
          bids: Array.isArray(update.bids) ? update.bids as PaperOrderBookLevel[] : [],
          asks: Array.isArray(update.asks) ? update.asks as PaperOrderBookLevel[] : [],
          bestBid: Number(update.bestBid),
          bestAsk: Number(update.bestAsk),
          midPrice: Number(update.midPrice),
          spread: Number(update.spread),
          spreadPercent: Number(update.spreadPercent),
          sequence: update.sequence === null ? null : String(update.sequence || ""),
          exchangeTime: Number(update.exchangeTime) || Date.now(),
          updatedAt: Number(update.updatedAt) || Date.now(),
        });
        setPaperBookFeedState("live");
      } catch {
        setPaperBookFeedState("stale");
      }
    };
    stream.onopen = () => {
      setPaperBookFeedState((state) => state === "live" ? state : "connecting");
    };
    stream.onerror = () => {
      setPaperBookFeedState((state) => state === "live" ? state : "reconnecting");
    };
    return () => {
      stream.close();
    };
  }, [provider, symbol]);
  useEffect(() => {
    if (!paperOrderBook || paperOrderBook.provider !== provider || paperOrderBook.symbol !== symbol) return;
    const updatedAt = paperOrderBook.updatedAt;
    const timer = window.setTimeout(() => {
      setPaperBookFeedState((state) => state === "live" ? "stale" : state);
    }, Math.max(0, 5000 - (Date.now() - updatedAt)));
    return () => window.clearTimeout(timer);
  }, [paperOrderBook?.updatedAt, paperOrderBook?.provider, paperOrderBook?.symbol, provider, symbol]);
  const activeTimeframeChange = current
    ? candleChangePercent(current)
    : timeframeChanges[interval];
  const selectedCandleMetrics = selectedCandle
    ? {
        body: Math.abs(
          selectedCandle.candle.close - selectedCandle.candle.open,
        ),
        upperWick:
          selectedCandle.candle.high -
          Math.max(selectedCandle.candle.open, selectedCandle.candle.close),
        lowerWick:
          Math.min(selectedCandle.candle.open, selectedCandle.candle.close) -
          selectedCandle.candle.low,
        change: candleChangePercent(selectedCandle.candle),
      }
    : null;
  useEffect(() => {
    const position = paperPortfolio.openPosition;
    const pendingOrder = paperPortfolio.pendingOrder;
    if (!position && pendingOrder) {
      const orderMatchesChart = pendingOrder.provider === provider &&
        pendingOrder.symbol === symbol && pendingOrder.interval === interval;
      if (!orderMatchesChart) return;

      for (const candle of candles) {
        if (candle.time < pendingOrder.placedAtTime) continue;
        const isLong = pendingOrder.direction === "LONG";
        const crossed = isLong
          ? (candle.closed && candle.time > pendingOrder.placedAtTime
              ? candle.low <= pendingOrder.limitPrice
              : candle.close <= pendingOrder.limitPrice)
          : (candle.closed && candle.time > pendingOrder.placedAtTime
              ? candle.high >= pendingOrder.limitPrice
              : candle.close >= pendingOrder.limitPrice);
        if (!crossed) continue;

        // A gap through a limit order receives the better opening price.
        const fillPrice = candle.time > pendingOrder.placedAtTime
          ? isLong
            ? Math.min(pendingOrder.limitPrice, candle.open)
            : Math.max(pendingOrder.limitPrice, candle.open)
          : isLong
            ? Math.min(pendingOrder.limitPrice, candle.close)
            : Math.max(pendingOrder.limitPrice, candle.close);
        const margin = pendingOrder.quantity * fillPrice / pendingOrder.leverage;
        const liquidationPrice = estimatePaperLiquidationPrice(
          fillPrice,
          pendingOrder.direction,
          pendingOrder.leverage,
          pendingOrder.maintenanceMarginPercent,
          pendingOrder.feeRate,
        );
        const positionOnFill: PaperPosition = {
          id: pendingOrder.id,
          direction: pendingOrder.direction,
          provider: pendingOrder.provider,
          symbol: pendingOrder.symbol,
          interval: pendingOrder.interval,
          openedAtTime: candle.time,
          entry: fillPrice,
          stop: pendingOrder.stop,
          target: pendingOrder.target,
          quantity: pendingOrder.quantity,
          leverage: pendingOrder.leverage,
          margin,
          liquidationPrice,
          riskAmount: Math.abs(fillPrice - pendingOrder.stop) * pendingOrder.quantity +
            pendingOrder.quantity * (fillPrice + pendingOrder.stop) * pendingOrder.feeRate,
          feeRate: pendingOrder.feeRate,
          markPrice: candle.close,
        };
        const portfolio = paperPortfolioRef.current;
        if (portfolio.pendingOrder?.id !== pendingOrder.id) return;
        const filledPortfolio: PaperPortfolio = {
          ...portfolio,
          openPosition: positionOnFill,
          pendingOrder: null,
        };
        const accountBalance = portfolio.balance;
        const sameCandleAsPlacement = candle.time === pendingOrder.placedAtTime;
        const liquidationHit = sameCandleAsPlacement
          ? (isLong
              ? fillPrice <= positionOnFill.liquidationPrice
              : fillPrice >= positionOnFill.liquidationPrice)
          : (isLong
              ? candle.open <= positionOnFill.liquidationPrice
              : candle.open >= positionOnFill.liquidationPrice);
        const stopHit = sameCandleAsPlacement
          ? (isLong ? fillPrice <= positionOnFill.stop : fillPrice >= positionOnFill.stop)
          : (isLong ? candle.low <= positionOnFill.stop : candle.high >= positionOnFill.stop);
        const targetHit = sameCandleAsPlacement
          ? (isLong ? fillPrice >= positionOnFill.target : fillPrice <= positionOnFill.target)
          : (isLong ? candle.high >= positionOnFill.target : candle.low <= positionOnFill.target);
        if (liquidationHit || stopHit || targetHit) {
          const reason = liquidationHit
            ? "Estimated liquidation"
            : stopHit
              ? "Stop hit"
              : "Target hit";
          const exitPrice = sameCandleAsPlacement
            ? fillPrice
            : liquidationHit
              ? candle.open
              : stopHit
                ? isLong
                  ? Math.min(candle.open, positionOnFill.stop)
                  : Math.max(candle.open, positionOnFill.stop)
                : positionOnFill.target;
          const closedPortfolio = recordPaperClose(
            filledPortfolio,
            positionOnFill,
            exitPrice,
            candle.time,
            reason,
          );
          replacePaperPortfolio(closedPortfolio);
          void publishCopyEvent("open", { position: positionOnFill, accountBalance });
          void publishCopyEvent("close", {
            positionId: positionOnFill.id,
            exitPrice,
            closedAtTime: candle.time,
            reason,
            pnl: closedPortfolio.history[0]?.pnl || 0,
          });
          setPaperError("");
          return;
        }
        replacePaperPortfolio(filledPortfolio);
        void publishCopyEvent("open", { position: positionOnFill, accountBalance });
        setPaperError("");
        return;
      }
      return;
    }
    if (
      !position ||
      position.provider !== provider ||
      position.symbol !== symbol ||
      position.interval !== interval
    ) return;

    const laterCandles = candles.filter(
      (candle) => candle.closed && candle.time > position.openedAtTime,
    );
    for (const candle of laterCandles) {
      const stopHit = position.direction === "LONG"
        ? candle.low <= position.stop
        : candle.high >= position.stop;
      const targetHit = position.direction === "LONG"
        ? candle.high >= position.target
        : candle.low <= position.target;
      const liquidationGap = position.direction === "LONG"
        ? candle.open <= position.liquidationPrice
        : candle.open >= position.liquidationPrice;
      // When one candle crosses both levels, use the stop first as a conservative fill assumption.
      if (liquidationGap || stopHit || targetHit) {
        const reason = liquidationGap
          ? "Estimated liquidation"
          : stopHit
            ? "Stop hit"
            : "Target hit";
        const triggerPrice = stopHit ? position.stop : position.target;
        const gapPrice = liquidationGap
          ? candle.open
          : stopHit
          ? position.direction === "LONG"
            ? Math.min(candle.open, triggerPrice)
            : Math.max(candle.open, triggerPrice)
          : triggerPrice;
        const portfolio = paperPortfolioRef.current;
        if (portfolio.openPosition?.id === position.id) {
          const closedPortfolio = recordPaperClose(
            portfolio,
            position,
            gapPrice,
            candle.time,
            reason,
          );
          replacePaperPortfolio(closedPortfolio);
          if (!position.copiedFrom)
            void publishCopyEvent("close", {
              positionId: position.id,
              exitPrice: gapPrice,
              closedAtTime: candle.time,
              reason,
              pnl: closedPortfolio.history[0]?.pnl || 0,
            });
        }
        return;
      }
    }
  }, [candles, interval, paperPortfolio.openPosition, paperPortfolio.pendingOrder, provider, symbol]);
  function focusChartPattern(pattern: ChartPattern) {
    const completed = candles.filter((candle) => candle.closed);
    const first = completed[pattern.startIndex];
    const last = completed[pattern.endIndex];
    const timeScale = chartRef.current?.timeScale();
    if (!first || !last || !timeScale) return;
    const firstChartIndex = candles.findIndex(
      (candle) => candle.time === first.time,
    );
    const lastChartIndex = candles.findIndex(
      (candle) => candle.time === last.time,
    );
    if (firstChartIndex < 0 || lastChartIndex < 0) return;
    const span = Math.max(1, lastChartIndex - firstChartIndex);
    const padding = Math.max(10, Math.ceil(span * 0.16));
    const secondsPerBar =
      completed.length > 1
        ? Math.max(1, completed[1].time - completed[0].time)
        : 60 * 60 * 4;
    setSelectedCandle(null);
    setFocusedPatternName(pattern.name);
    timeScale.setVisibleRange({
      from: (first.time - padding * secondsPerBar) as Time,
      to: (last.time + padding * secondsPerBar) as Time,
    });
  }
  function toggleIndicator(key: IndicatorKey) {
    setIndicators((current) => ({ ...current, [key]: !current[key] }));
  }
  function toggleConcept(key: ConceptKey) {
    setConcepts((current) => ({ ...current, [key]: !current[key] }));
  }
  function setLevelCount(kind: Level["kind"], count: number) {
    const ranks = Array.from({ length: count }, (_, index) => index);
    if (kind === "support") setSelectedSupportRanks(ranks);
    else setSelectedResistanceRanks(ranks);
  }
  function toggleLevel(kind: Level["kind"], index: number) {
    const update = (current: number[]) =>
      current.includes(index)
        ? current.filter((rank) => rank !== index)
        : [...current, index].sort((a, b) => a - b);
    if (kind === "support") {
      setSelectedSupportRanks(update);
      setShowSupportZones(true);
    } else {
      setSelectedResistanceRanks(update);
      setShowResistanceZones(true);
    }
  }
  function toggleZoneGroup(kind: Level["kind"], checked: boolean) {
    if (kind === "support") {
      setShowSupportZones(checked);
      if (checked && !selectedSupportRanks.length && supportLevels.length)
        setSelectedSupportRanks([0]);
    } else {
      setShowResistanceZones(checked);
      if (checked && !selectedResistanceRanks.length && resistanceLevels.length)
        setSelectedResistanceRanks([0]);
    }
  }
  function startLevelDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    zone: ZoneRect,
  ) {
    if (event.button !== 0) return;
    suppressZoneClickRef.current = false;
    setReturningLevelKey(null);
    zoneDragRef.current = {
      pointerId: event.pointerId,
      key: zone.dragKey,
      startY: event.clientY,
      startPrice: zone.price,
      currentPrice: zone.price,
      moved: false,
    };
    setDraggingLevelKey(zone.dragKey);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveLevelDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    zone: ZoneRect,
  ) {
    const drag = zoneDragRef.current;
    const series = seriesRef.current;
    const chartBounds = chartDiv.current?.getBoundingClientRect();
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.key !== zone.dragKey ||
      !series ||
      !chartBounds
    )
      return;
    if (Math.abs(event.clientY - drag.startY) >= 2) drag.moved = true;
    if (!drag.moved) return;
    const pointerPrice = series.coordinateToPrice(
      event.clientY - chartBounds.top,
    );
    if (pointerPrice === null) return;
    const nextPrice = Math.min(
      zone.maxPrice,
      Math.max(zone.minPrice, pointerPrice),
    );
    drag.currentPrice = nextPrice;
    setLevelOverrides((current) => ({
      ...current,
      [zone.dragKey]: nextPrice,
    }));
  }
  function saveLevelPosition(zone: ZoneRect, price: number) {
    setLevelOverrides((current) => {
      const next = { ...current };
      const sameAsDetected =
        Math.abs(price - zone.originalPrice) <=
        Math.max(Number.EPSILON, Math.abs(zone.originalPrice) * 1e-10);
      if (sameAsDetected) delete next[zone.dragKey];
      else next[zone.dragKey] = price;
      return next;
    });
  }
  function returnLevelToStart(zone: ZoneRect, price: number) {
    saveLevelPosition(zone, price);
    setReturningLevelKey(zone.dragKey);
    window.setTimeout(() => {
      setReturningLevelKey((current) =>
        current === zone.dragKey ? null : current,
      );
    }, 420);
  }
  function finishLevelDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    zone: ZoneRect,
  ) {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressZoneClickRef.current = drag.moved;
    zoneDragRef.current = null;
    setDraggingLevelKey(null);
    if (drag.moved) {
      const sameKindLevels =
        zone.kind === "support" ? supportLevels : resistanceLevels;
      const validTargets = sameKindLevels.filter(
        (level) =>
          level.price >= zone.minPrice - Number.EPSILON &&
          level.price <= zone.maxPrice + Number.EPSILON,
      );
      const nearestTarget = validTargets.reduce<Level | null>(
        (nearest, candidate) =>
          !nearest ||
          Math.abs(candidate.price - drag.currentPrice) <
            Math.abs(nearest.price - drag.currentPrice)
            ? candidate
            : nearest,
        null,
      );
      const validDropDistance = Math.max(
        (analysis?.atr ?? 0) * 0.4,
        Math.abs(drag.currentPrice) * 0.001,
      );
      if (
        nearestTarget &&
        Math.abs(nearestTarget.price - drag.currentPrice) <= validDropDistance
      )
        saveLevelPosition(zone, nearestTarget.price);
      else returnLevelToStart(zone, drag.startPrice);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (suppressZoneClickRef.current)
      window.setTimeout(() => {
        suppressZoneClickRef.current = false;
      }, 0);
  }
  function cancelLevelDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    zone: ZoneRect,
  ) {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    zoneDragRef.current = null;
    suppressZoneClickRef.current = false;
    setDraggingLevelKey(null);
    if (drag.moved) returnLevelToStart(zone, drag.startPrice);
  }
  function handleLevelClick(
    event: React.MouseEvent<HTMLButtonElement>,
    zone: ZoneRect,
  ) {
    if (suppressZoneClickRef.current) {
      event.preventDefault();
      return;
    }
    showLevelInfo(zone);
  }
  function showLevelInfo(level: Level) {
    setInfoDetail({
      title: `${level.kind === "support" ? "Support" : "Resistance"} zone · ${formatPrice(level.price)}`,
      description:
        level.kind === "support"
          ? "A repeat-tested price area below the latest completed close. The lowest detected support is listed first so you can deliberately choose which zones appear."
          : "A repeat-tested price area above the latest completed close. The highest detected resistance is listed first so you can deliberately choose which zones appear.",
      facts: [
        `${level.touches} confirmed pivot touches`,
        `ATR-sized zone around ${formatPrice(level.price)}`,
      ],
    });
  }
  function showConceptInfo(rect: ConceptRect) {
    const key: ConceptKey = rect.kind.startsWith("fvg")
      ? "fairValueGaps"
      : "orderBlocks";
    setInfoDetail({
      ...conceptInfo[key],
      facts: [
        `${rect.kind.includes("bullish") ? "Bullish" : "Bearish"} zone`,
        `${formatPrice(rect.low)} – ${formatPrice(rect.high)}`,
        rect.muted ? "Already mitigated or invalidated" : "Currently active",
      ],
    });
  }
  function showFibInfo(line: FibLineRect) {
    setInfoDetail({
      title: `${(line.ratio * 100).toFixed(line.ratio === 0 || line.ratio === 1 ? 0 : 1)}% · ${line.name}`,
      description: conceptInfo.fibonacci.description,
      facts: [
        `Level price: ${formatPrice(line.price)}`,
        fibonacciForDisplay
          ? `${fibonacciForDisplay.direction === "bullish" ? "Long" : "Short"} swing measurement`
          : "Swing measurement",
      ],
    });
  }
  function localSummary(a: Analysis) {
    const activeFvgs = a.smartMoney.fairValueGaps.filter(
        (gap) => !gap.mitigated,
      ).length,
      events = a.smartMoney.structureEvents,
      lastStructure = events[events.length - 1];
    return `Structure: ${a.trend}. ${a.recentStructure}. ${lastStructure ? `Latest SMC event: ${lastStructure.kind} ${lastStructure.direction}. ` : ""}Active fair value gaps: ${activeFvgs}; recent order blocks: ${a.smartMoney.orderBlocks.length}. EMA 20: ${a.indicators.ema20.toFixed(5)}, EMA 50: ${a.indicators.ema50.toFixed(5)}, SMA 200: ${a.indicators.sma200.toFixed(5)}, VWAP 50: ${a.indicators.vwap50.toFixed(5)}, RSI 14: ${a.indicators.rsi14.toFixed(1)}, MACD: ${a.indicators.macd.toFixed(5)}.\nBullish case: Watch for a confirmed close and hold above ${a.bullishTrigger?.toFixed(5) ?? "the nearest established resistance"}.\nBearish case: Watch for a confirmed break and failed retest below ${a.bearishTrigger?.toFixed(5) ?? "the nearest established support"}.\nThese are conditional observations, not trade signals.`;
  }
  async function askAi() {
    if (!analysis) return;
    setAiLoading(true);
    setAiText("");
    try {
      const r = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, provider, analysis }),
      });
      const j = await r.json();
      setAiText(
        r.ok
          ? j.text
          : `${localSummary(analysis)}\n\nAI unavailable: ${j.error}`,
      );
    } catch {
      setAiText(`${localSummary(analysis)}\n\nAI request failed.`);
    } finally {
      setAiLoading(false);
    }
  }
  function chooseMarket(market: Market) {
    if (market.provider) {
      setProvider(market.provider);
      setMarketScope(market.provider);
    }
    setSymbol(market.symbol);
    setMarketQuery("");
    setMarketMenu(false);
  }
  function generateSignal() {
    if (!analysis || !riskAcknowledged) return;
    try {
      setSignalPlan(buildRuleSignal(candles, analysis, signalFactors));
      setSignalError("");
    } catch (e) {
      setSignalError(
        e instanceof Error ? e.message : "Could not evaluate the current chart",
      );
    }
    setSignalModal(false);
  }
  function toggleSignalFactor(factor: SignalFactor) {
    const isSelected = signalFactors.includes(factor);
    if (isSelected && signalFactors.length <= 2) return;
    setSignalFactors((current) =>
      current.includes(factor)
        ? current.filter((selected) => selected !== factor)
        : SIGNAL_FACTORS.filter(
            (item) => item.id === factor || current.includes(item.id),
          ).map((item) => item.id),
    );
    setSignalPlan(null);
    setSignalError("");
  }
  function loadSignalIntoPaperSetup() {
    if (
      !signalPlan ||
      signalPlan.direction === "WAIT" ||
      signalPlan.entry === null ||
      signalPlan.stop === null ||
      signalPlan.target === null
    ) return;
    setPaperDirection(signalPlan.direction);
    setPaperOrderType("LIMIT");
    setPaperEntry(String(signalPlan.entry));
    setPaperStop(String(signalPlan.stop));
    setPaperTarget(String(signalPlan.target));
    setPaperError("");
  }
  function openPaperPosition(directionOverride: PaperDirection = paperDirection) {
    if (!current) {
      setPaperError("Wait for chart price data before opening a demo position.");
      setPaperDockExpanded(true);
      return;
    }
    const portfolioBeforeOrder = paperPortfolioRef.current;
    if (portfolioBeforeOrder.pendingOrder) {
      setPaperError("Cancel the pending order before placing another trade.");
      setPaperDockExpanded(true);
      return;
    }
    const existingPosition = portfolioBeforeOrder.openPosition;
    const isReversal = Boolean(
      existingPosition &&
      existingPosition.provider === provider &&
      existingPosition.symbol === symbol &&
      existingPosition.direction !== directionOverride,
    );
    if (existingPosition && !isReversal) {
      setPaperError(existingPosition.provider === provider && existingPosition.symbol === symbol
        ? `You already have an open ${existingPosition.direction}. Choose the opposite side to reverse it, or close it first.`
        : `Close the open ${existingPosition.symbol} position before trading another market.`);
      setPaperDockExpanded(true);
      return;
    }
    if (isReversal && paperOrderType !== "MARKET") {
      setPaperError("Switch to Market to close the current position and reverse against live order-book depth.");
      setPaperDockExpanded(true);
      return;
    }
    if (paperOrderType === "MARKET" && !paperBookIsFresh) {
      setPaperError("Market execution is paused until the selected exchange order book is synchronized and live.");
      setPaperDockExpanded(true);
      return;
    }
    const latestCompleted = [...candles].reverse().find((candle) => candle.closed);
    if (!latestCompleted) {
      setPaperError("A completed candle is needed to start the simulation.");
      setPaperDockExpanded(true);
      return;
    }
    const requestedEntry = paperOrderType === "MARKET"
      ? paperExecutablePrice ?? 0
      : paperEntry.trim()
        ? Number(paperEntry)
        : current.close;
    if (!Number.isFinite(requestedEntry) || requestedEntry <= 0) {
      setPaperError("Enter a valid price for the limit order.");
      setPaperDockExpanded(true);
      return;
    }
    const isMarketableLimit = paperOrderType === "LIMIT" && (
      directionOverride === "LONG"
        ? paperBookIsFresh && requestedEntry >= (matchingPaperOrderBook?.bestAsk ?? Number.POSITIVE_INFINITY)
        : paperBookIsFresh && requestedEntry <= (matchingPaperOrderBook?.bestBid ?? 0)
    );
    const fillsImmediately = paperOrderType === "MARKET" || isMarketableLimit;
    const executionLevels = matchingPaperOrderBook
      ? directionOverride === "LONG"
        ? matchingPaperOrderBook.asks
        : matchingPaperOrderBook.bids
      : [];
    const limitExecutionPrice = paperOrderType === "LIMIT" ? requestedEntry : undefined;
    let entryValue = fillsImmediately
      ? paperExecutablePrice ?? requestedEntry
      : requestedEntry;
    let stopValue = 0;
    let targetValue = 0;
    let quoteResult: ReturnType<typeof calculatePaperQuote> = { quote: null, error: "" };
    const isCurrentDirection = directionOverride === paperDirection;
    let quoteBalance = portfolioBeforeOrder.balance;
    const updateQuoteForEntry = (price: number) => {
      const stopDistance = Math.max(
        (analysis?.atr ?? price * 0.01) * 1.5,
        price * 0.001,
      );
      stopValue = isCurrentDirection && paperStop.trim()
        ? Number(paperStop)
        : directionOverride === "LONG"
          ? price - stopDistance
          : price + stopDistance;
      targetValue = isCurrentDirection && paperTarget.trim()
        ? Number(paperTarget)
        : directionOverride === "LONG"
          ? price + stopDistance * 2
          : price - stopDistance * 2;
      quoteResult = calculatePaperQuote({
        direction: directionOverride,
        entry: price,
        stop: stopValue,
        target: targetValue,
        riskPercent: Number(paperRiskPercent),
        leverage: Number(paperLeverage),
        maintenanceMarginPercent: Number(paperMaintenanceMarginPercent),
        feePercent: Number(paperFeePercent),
        balance: quoteBalance,
      });
    };

    let reversalExitPrice = 0;
    if (isReversal && existingPosition && matchingPaperOrderBook && paperBookIsFresh) {
      const closeSide = existingPosition.direction === "LONG" ? "sell" : "buy";
      const closeLevels = existingPosition.direction === "LONG"
        ? matchingPaperOrderBook.bids
        : matchingPaperOrderBook.asks;
      const closeFill = estimatePaperBookFill(closeLevels, existingPosition.quantity, undefined, closeSide);
      if (!closeFill.complete) {
        setPaperError("The live book does not show enough depth to close the open position safely.");
        setPaperDockExpanded(true);
        return;
      }
      reversalExitPrice = closeFill.averagePrice;
    }
    const reversalClosedAt = Math.floor(Date.now() / 1000);
    const portfolioAfterReversal = isReversal && existingPosition
      ? recordPaperClose(
          portfolioBeforeOrder,
          existingPosition,
          reversalExitPrice,
          reversalClosedAt,
          "Closed manually",
        )
      : portfolioBeforeOrder;
    quoteBalance = portfolioAfterReversal.balance;

    if (fillsImmediately && (!matchingPaperOrderBook || !paperBookIsFresh)) {
      setPaperError("A synchronized live order book is required for an immediate fill. The limit order was not placed.");
      setPaperDockExpanded(true);
      return;
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      updateQuoteForEntry(entryValue);
      if (!quoteResult.quote || !fillsImmediately) break;
      const fill = estimatePaperBookFill(
        executionLevels,
        quoteResult.quote.quantity,
        limitExecutionPrice,
        directionOverride === "LONG" ? "buy" : "sell",
      );
      if (!fill.complete) {
        setPaperError("There is not enough visible depth to fill this order size. Reduce risk or choose a more liquid market.");
        setPaperDockExpanded(true);
        return;
      }
      if (Math.abs(fill.averagePrice - entryValue) <= Math.max(entryValue * 1e-10, 1e-12)) break;
      entryValue = fill.averagePrice;
    }
    updateQuoteForEntry(entryValue);
    if (!quoteResult.quote) {
      setPaperDirection(directionOverride);
      if (!isCurrentDirection) {
        setPaperStop("");
        setPaperTarget("");
      }
      setPaperError(quoteResult.error);
      setPaperDockExpanded(true);
      return;
    }
    if (fillsImmediately) {
      const finalFill = estimatePaperBookFill(
        executionLevels,
        quoteResult.quote.quantity,
        limitExecutionPrice,
        directionOverride === "LONG" ? "buy" : "sell",
      );
      if (!finalFill.complete) {
        setPaperError("The book changed before the simulated order could be filled. Please retry against the refreshed depth.");
        setPaperDockExpanded(true);
        return;
      }
      entryValue = finalFill.averagePrice;
      updateQuoteForEntry(entryValue);
      if (!quoteResult.quote) {
        setPaperError(quoteResult.error);
        setPaperDockExpanded(true);
        return;
      }
    }
    if (isReversal && existingPosition) {
      replacePaperPortfolio(portfolioAfterReversal);
      void publishCopyEvent("close", {
        positionId: existingPosition.id,
        exitPrice: reversalExitPrice,
        closedAtTime: reversalClosedAt,
        reason: "Closed manually",
        pnl: portfolioAfterReversal.history[0]?.pnl || 0,
      });
    }
    if (!isCurrentDirection) {
      setPaperDirection(directionOverride);
      setPaperStop("");
      setPaperTarget("");
    }
    const quote = quoteResult.quote;
    const tradeId = `${provider}-${symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (!fillsImmediately) {
      const pendingOrder: PaperPendingOrder = {
        id: tradeId,
        direction: directionOverride,
        provider,
        symbol,
        interval,
        placedAtTime: current.time,
        limitPrice: entryValue,
        stop: stopValue,
        target: targetValue,
        quantity: quote.quantity,
        leverage: Number(paperLeverage),
        margin: quote.margin,
        maintenanceMarginPercent: Number(paperMaintenanceMarginPercent),
        liquidationPrice: quote.liquidationPrice,
        riskAmount: quote.stopLoss,
        feeRate: quote.feeRate,
      };
      replacePaperPortfolio({
        ...paperPortfolioRef.current,
        pendingOrder,
      });
      setPaperError("");
      return;
    }
    const position: PaperPosition = {
      id: tradeId,
      direction: directionOverride,
      provider,
      symbol,
      interval,
      openedAtTime: current.time,
      entry: entryValue,
      stop: stopValue,
      target: targetValue,
      quantity: quote.quantity,
      leverage: Number(paperLeverage),
      margin: quote.margin,
      liquidationPrice: quote.liquidationPrice,
      riskAmount: quote.stopLoss,
      feeRate: quote.feeRate,
      markPrice: paperMarkPrice > 0 ? paperMarkPrice : current.close,
    };
    const accountBalance = paperPortfolioRef.current.balance;
    replacePaperPortfolio({
      ...paperPortfolioRef.current,
      openPosition: position,
      pendingOrder: null,
    });
    void publishCopyEvent("open", { position, accountBalance });
    setPaperError("");
  }
  function cancelPendingPaperOrder() {
    const pendingOrder = paperPortfolioRef.current.pendingOrder;
    if (!pendingOrder) return;
    replacePaperPortfolio({
      ...paperPortfolioRef.current,
      pendingOrder: null,
    });
    setPaperError("");
  }
  function closePaperPositionAtMark() {
    const position = paperPortfolioRef.current.openPosition;
    if (!position) return;
    const portfolio = paperPortfolioRef.current;
    if (portfolio.openPosition?.id !== position.id) return;
    if (
      position.provider !== provider ||
      position.symbol !== symbol ||
      !paperBookIsFresh ||
      !matchingPaperOrderBook
    ) {
      setPaperError("Select the open position’s market and wait for its live order book before closing.");
      setPaperDockExpanded(true);
      return;
    }
    const closeSide = position.direction === "LONG" ? "sell" : "buy";
    const closeLevels = position.direction === "LONG"
      ? matchingPaperOrderBook.bids
      : matchingPaperOrderBook.asks;
    const closeFill = estimatePaperBookFill(closeLevels, position.quantity, undefined, closeSide);
    if (!closeFill.complete) {
      setPaperError("There is not enough visible order-book depth to close the full position. Try again after depth updates.");
      setPaperDockExpanded(true);
      return;
    }
    const exitPrice = closeFill.averagePrice;
    const closedAtTime = Math.floor(Date.now() / 1000);
    const closedPortfolio = recordPaperClose(
      portfolio,
      position,
      exitPrice,
      closedAtTime,
      "Closed manually",
    );
    replacePaperPortfolio(closedPortfolio);
    if (!position.copiedFrom)
      void publishCopyEvent("close", {
        positionId: position.id,
        exitPrice,
        closedAtTime,
        reason: "Closed manually",
        pnl: closedPortfolio.history[0]?.pnl || 0,
      });
  }
  async function saveCopyProfile() {
    setCopySaving(true);
    setCopyError("");
    try {
      const currentPosition = paperPortfolioRef.current.openPosition;
      const currentTrade =
        currentPosition && !currentPosition.copiedFrom
          ? { position: currentPosition, accountBalance: paperPortfolioRef.current.balance }
          : undefined;
      const response = await fetch("/api/copy-trading/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          displayName: copyNameDraft,
          isPublic: copyShareDraft,
          ...(copyShareDraft && currentTrade ? { currentTrade } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your trader profile.");
      const nextSnapshot = copySnapshotRef.current
        ? { ...copySnapshotRef.current, me: body.profile }
        : null;
      if (nextSnapshot) {
        copySnapshotRef.current = nextSnapshot;
        setCopySnapshot(nextSnapshot);
      }
      setCopyNameDraft(body.profile.displayName);
      setCopyShareDraft(body.profile.isPublic);
      setCopyStatus(body.profile.isPublic ? "Your demo trades are shared live." : "Your demo trades are private.");
      window.setTimeout(() => void syncCopyTrading(), 0);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Could not save your trader profile.");
    } finally {
      setCopySaving(false);
    }
  }
  async function updateCopyFollow(
    trader: CopyProfile,
    enabled: boolean,
    copyScale: number,
  ) {
    setCopyError("");
    setCopySaving(true);
    try {
      const response = await fetch("/api/copy-trading/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ traderId: trader.id, enabled, copyScale }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update copy settings.");
      setCopyScaleDrafts((current) => ({ ...current, [trader.id]: copyScale }));
      const current = copySnapshotRef.current;
      if (current) {
        const follow: CopyFollow = { traderId: trader.id, enabled, copyScale };
        const nextSnapshot = {
          ...current,
          follows: [
            follow,
            ...current.follows.filter((item) => item.traderId !== trader.id),
          ],
        };
        copySnapshotRef.current = nextSnapshot;
        setCopySnapshot(nextSnapshot);
      }
      if (enabled)
        setCopyStatus(`Following ${trader.displayName} · waiting for their next demo trade.`);
      else
        setCopyStatus(`Paused new entries from ${trader.displayName}; any open copied position will still follow their exit.`);
      window.setTimeout(() => void syncCopyTrading(), 0);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Could not update copy settings.");
    } finally {
      setCopySaving(false);
    }
  }
  async function sendChat(prompt = chatInput) {
    const content = prompt.trim();
    if (!content || chatLoading || !chatProviders[chatProvider]) return;
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content,
    };
    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setChatInput("");
    setChatError("");
    setChatLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aiProvider: chatProvider,
          messages: nextMessages.slice(-16).map(({ role, content }) => ({
            role,
            content,
          })),
          chartContext: includeChartContext && analysis ? analysis : undefined,
          symbol,
          interval,
          exchange: provider,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI chat is unavailable");
      setChatMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: body.text,
          provider: body.provider,
        },
      ]);
    } catch (chatRequestError) {
      setChatError(
        chatRequestError instanceof Error
          ? chatRequestError.message
          : "AI chat request failed",
      );
    } finally {
      setChatLoading(false);
    }
  }
  function submitChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendChat();
  }
  return (
    <div className="app">
      <header>
        <div className="logo">
          <ScanLine size={20} color="#31d69b" />
          <span>
            CHART<span className="accent">AI</span>
          </span>
        </div>
        <select
          className="exchange"
          aria-label="Exchange"
          value={marketScope}
          onChange={(e) => {
            const next = e.target.value;
            setMarketScope(next);
            if (next === "all") return;
            const set = markets.filter((market) => market.provider === next);
            const fallback =
              set.find((market) => market.symbol === symbol) ||
              set.find((market) => market.symbol === "BTCUSDT") ||
              set.find((market) => market.symbol === "BTCUSDC") ||
              set[0];
            setProvider(next);
            if (fallback) setSymbol(fallback.symbol);
          }}
        >
          <option value="all">All exchanges</option>
          {exchanges.map((x) => (
            <option value={x.id} key={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <div
          className={`market-control search-market${marketMenu ? " open" : ""}`}
        >
          <span className="market-count">
            {marketsLoading
              ? "Loading all markets…"
              : `${marketsInScope.length.toLocaleString()} coin pairs · ${marketScope === "all" ? `across ${loadedMarketProviderCount}/6 exchanges` : exchanges.find((exchange) => exchange.id === marketScope)?.name || "selected exchange"}${marketFailuresInScope.length ? ` · retrying ${marketFailuresInScope.length} feed${marketFailuresInScope.length === 1 ? "" : "s"}` : ""}`}
          </span>
          <Search size={14} />
          <input
            role="combobox"
            aria-label={
              marketScope === "all"
                ? "Search all exchange markets"
                : `Search ${exchanges.find((exchange) => exchange.id === marketScope)?.name || "exchange"} markets`
            }
            aria-expanded={marketMenu}
            aria-controls="market-results"
            autoComplete="off"
            value={
              marketMenu
                ? marketQuery
                : selectedMarket
                  ? `${selectedMarket.baseAsset}/${selectedMarket.quoteAsset}`
                  : symbol
            }
            placeholder="Search any ticker or coin"
            onFocus={() => {
              setMarketQuery("");
              setMarketMenu(true);
            }}
            onClick={() => {
              if (!marketMenu) {
                setMarketQuery("");
                setMarketMenu(true);
              }
            }}
            onChange={(e) => {
              setMarketQuery(e.target.value);
              setMarketMenu(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && marketMatches[0])
                chooseMarket(marketMatches[0]);
              if (e.key === "Escape") setMarketMenu(false);
            }}
            onBlur={() => window.setTimeout(() => setMarketMenu(false), 150)}
          />
          {marketMenu && (
            <div className="market-results" id="market-results" role="listbox">
              {marketMatches.length ? (
                marketMatches.map((market) => {
                  const venue =
                    exchanges.find(
                      (exchange) => exchange.id === market.provider,
                    )?.name || market.provider;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={
                        market.provider === provider && market.symbol === symbol
                      }
                      className={
                        market.provider === provider && market.symbol === symbol
                          ? "active"
                          : ""
                      }
                      key={`${market.provider}-${market.symbol}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseMarket(market)}
                    >
                      <strong>{market.baseAsset}</strong>
                      <span>/{market.quoteAsset}</span>
                      <small>{venue}</small>
                    </button>
                  );
                })
              ) : (
                <div className="no-markets">
                  {marketsLoading
                    ? "Loading exchange listings…"
                    : marketFailuresInScope.length
                      ? "Exchange feeds are temporarily unavailable. Any cached pairs remain searchable; feeds retry automatically."
                      : "No matching market across connected exchanges"}
                </div>
              )}
              {filteredMarkets.length > marketMatches.length && (
                <div className="market-results-note">
                  Showing {marketMatches.length} of{" "}
                  {filteredMarkets.length.toLocaleString()} matches · type to
                  narrow the list
                </div>
              )}
            </div>
          )}
        </div>
        <div className="times">
          {intervals.map((t) => {
            const change =
              t === interval ? activeTimeframeChange : timeframeChanges[t];
            return (
              <button
                key={t}
                className={interval === t ? "active" : ""}
                aria-label={`${t} timeframe${change === undefined ? "" : `, ${formatPercent(change)} change`}`}
                onClick={() => setIntervalValue(t)}
              >
                <span>{t}</span>
                {change !== undefined && (
                  <small className={change >= 0 ? "up" : "down"}>
                    {formatPercent(change)}
                  </small>
                )}
              </button>
            );
          })}
        </div>
        <div className="status">
          <span className={live ? "dot live" : "dot"} />
          {live ? "LIVE STREAM" : "OFFLINE"}
        </div>
      </header>
      <main>
        <section className="chart-pane">
          <div className="chart-heading">
            <div>
              <div className="eyebrow">
                {exchanges.find((e) => e.id === provider)?.name.toUpperCase()} ·{" "}
                {interval.toUpperCase()}
              </div>
              <h1>
                {symbol}{" "}
                <span className="price">
                  {current
                    ? current.close.toLocaleString(undefined, {
                        maximumFractionDigits: 8,
                      })
                    : "—"}
                </span>
                {activeTimeframeChange !== undefined && (
                  <span
                    className={`price-change ${activeTimeframeChange >= 0 ? "up" : "down"}`}
                  >
                    {formatPercent(activeTimeframeChange)}
                  </span>
                )}
              </h1>
              {current && (
                <div className="ohlc">
                  <span>
                    O <b>{current.open.toLocaleString()}</b>
                  </span>
                  <span>
                    H <b>{current.high.toLocaleString()}</b>
                  </span>
                  <span>
                    L <b>{current.low.toLocaleString()}</b>
                  </span>
                  <span>
                    C{" "}
                    <b
                      className={current.close >= current.open ? "up" : "down"}
                    >
                      {current.close.toLocaleString()}
                    </b>
                  </span>
                  <span>
                    Vol{" "}
                    <b>
                      {current.volume.toLocaleString(undefined, {
                        notation: "compact",
                        maximumFractionDigits: 2,
                      })}
                    </b>
                  </span>
                </div>
              )}
              {activeRangeStats && activeRangeLabel && (
                <div
                  className="daily-range"
                  aria-label={`${activeRangeLabel.toLowerCase()} price range`}
                >
                  <span
                    className="daily-high"
                    title={`${activeRangeLabel.toLowerCase()} high from available coin history`}
                  >
                    {activeRangeLabel} ATH{" "}
                    <b>{formatPrice(activeRangeStats.high)}</b>
                  </span>
                  <span
                    className="daily-low"
                    title={`${activeRangeLabel.toLowerCase()} low from available coin history`}
                  >
                    {activeRangeLabel} ATL{" "}
                    <b>{formatPrice(activeRangeStats.low)}</b>
                  </span>
                </div>
              )}
            </div>
            <div className="toolbar">
              <div className="indicator-menu">
                <button
                  className={
                    Object.values(indicators).some(Boolean) ? "selected" : ""
                  }
                  onClick={() => {
                    setIndicatorMenu((v) => !v);
                    setZoneMenu(false);
                    setConceptMenu(false);
                  }}
                >
                  <SlidersHorizontal size={15} /> Indicators{" "}
                  <span className="tool-count">
                    {Object.values(indicators).filter(Boolean).length}
                  </span>
                </button>
                {indicatorMenu && (
                  <div className="indicator-popover">
                    {(Object.keys(indicatorLabels) as IndicatorKey[]).map(
                      (key) => (
                        <div className="option-row" key={key}>
                          <label>
                            <input
                              type="checkbox"
                              checked={indicators[key]}
                              onChange={() => toggleIndicator(key)}
                            />
                            <span className={`swatch ${key}`} />
                            {indicatorLabels[key]}
                          </label>
                          <button
                            className="option-info"
                            aria-label={`Explain ${indicatorLabels[key]}`}
                            onClick={() => setInfoDetail(indicatorInfo[key])}
                          >
                            <CircleHelp size={14} />
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
              <div className="concept-menu">
                <button
                  className={
                    Object.values(concepts).some(Boolean) ? "selected" : ""
                  }
                  onClick={() => {
                    setConceptMenu((v) => !v);
                    setIndicatorMenu(false);
                    setZoneMenu(false);
                  }}
                >
                  <GitBranch size={15} /> SMC & Fib{" "}
                  <span className="tool-count">
                    {Object.values(concepts).filter(Boolean).length}
                  </span>
                </button>
                {conceptMenu && (
                  <div className="concept-popover">
                    {(Object.keys(conceptInfo) as ConceptKey[]).map((key) => (
                      <div className="option-row" key={key}>
                        <label>
                          <input
                            type="checkbox"
                            checked={concepts[key]}
                            onChange={() => toggleConcept(key)}
                          />
                          <span
                            className={`swatch ${key === "fairValueGaps" ? "fvg" : key === "orderBlocks" ? "orderblock" : key}`}
                          />
                          {conceptInfo[key].title}
                        </label>
                        <button
                          className="option-info"
                          aria-label={`Explain ${conceptInfo[key].title}`}
                          onClick={() => setInfoDetail(conceptInfo[key])}
                        >
                          <CircleHelp size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="fib-direction-control">
                      <span>Fibonacci swing direction</span>
                      <div role="group" aria-label="Fibonacci swing direction">
                        {([
                          ["auto", "Auto"],
                          ["long", "Long"],
                          ["short", "Short"],
                        ] as const).map(([mode, label]) => (
                          <button
                            type="button"
                            key={mode}
                            className={fibDirectionMode === mode ? "active" : ""}
                            aria-pressed={fibDirectionMode === mode}
                            onClick={() => setFibDirectionMode(mode)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <small>
                        Short retracements anchor from the swing high down to the low.
                      </small>
                    </div>
                  </div>
                )}
              </div>
              <div className="zone-menu">
                <button
                  className={
                    showSupportZones ||
                    showResistanceZones ||
                    rangeLevelPeriod !== "off"
                      ? "selected"
                      : ""
                  }
                  onClick={() => {
                    setZoneMenu((v) => !v);
                    setIndicatorMenu(false);
                    setConceptMenu(false);
                  }}
                >
                  <Settings2 size={15} /> Zones{" "}
                  <span className="tool-count">
                    {visibleLevels.length +
                      (activeRangeStats ? 2 : 0)}
                  </span>
                </button>
                {zoneMenu && (
                  <div className="zone-popover">
                    <div className="level-setting range-period-setting">
                      <span>
                        <i className="swatch daily-range-swatch" /> ATH / ATL
                        period
                      </span>
                      <select
                        aria-label="ATH and ATL display period"
                        value={rangeLevelPeriod}
                        onChange={(event) =>
                          setRangeLevelPeriod(event.target.value as RangePeriod)
                        }
                      >
                        <option value="off">Off</option>
                        {(Object.keys(rangePeriodLabels) as Exclude<
                          RangePeriod,
                          "off"
                        >[]).map((period) => (
                          <option
                            value={period}
                            disabled={!rangeStats[period]}
                            key={period}
                          >
                            {rangePeriodLabels[period]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={showSupportZones}
                        onChange={(e) =>
                          toggleZoneGroup("support", e.target.checked)
                        }
                      />
                      <span className="swatch support-zone" /> Support zones
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={showResistanceZones}
                        onChange={(e) =>
                          toggleZoneGroup("resistance", e.target.checked)
                        }
                      />
                      <span className="swatch resistance-zone" /> Resistance
                      zones
                    </label>
                    <div className="level-setting">
                      <span>Support count</span>
                      <select
                        aria-label="Support level count"
                        value={selectedSupportRanks.length}
                        disabled={!showSupportZones}
                        onChange={(e) =>
                          setLevelCount("support", +e.target.value)
                        }
                      >
                        {Array.from(
                          { length: supportLevels.length + 1 },
                          (_, count) => count,
                        ).map((count) => (
                          <option value={count} key={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </div>
                    {showSupportZones && (
                      <div className="level-choice-list">
                        <small>Lowest support first</small>
                        {supportLevels.map((level, index) => (
                          <div className="level-choice" key={level.price}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selectedSupportRanks.includes(index)}
                                onChange={() => toggleLevel("support", index)}
                              />
                              S{index + 1} · {formatPrice(level.price)}
                            </label>
                            <button
                              className="option-info"
                              aria-label={`Explain support ${formatPrice(level.price)}`}
                              onClick={() => showLevelInfo(level)}
                            >
                              <CircleHelp size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="level-setting">
                      <span>Resistance count</span>
                      <select
                        aria-label="Resistance level count"
                        value={selectedResistanceRanks.length}
                        disabled={!showResistanceZones}
                        onChange={(e) =>
                          setLevelCount("resistance", +e.target.value)
                        }
                      >
                        {Array.from(
                          { length: resistanceLevels.length + 1 },
                          (_, count) => count,
                        ).map((count) => (
                          <option value={count} key={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </div>
                    {showResistanceZones && (
                      <div className="level-choice-list">
                        <small>Highest resistance first</small>
                        {resistanceLevels.map((level, index) => (
                          <div className="level-choice" key={level.price}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selectedResistanceRanks.includes(
                                  index,
                                )}
                                onChange={() =>
                                  toggleLevel("resistance", index)
                                }
                              />
                              R{index + 1} · {formatPrice(level.price)}
                            </label>
                            <button
                              className="option-info"
                              aria-label={`Explain resistance ${formatPrice(level.price)}`}
                              onClick={() => showLevelInfo(level)}
                            >
                              <CircleHelp size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="zone-drag-hint">
                      Drag a visible zone up or down. Valid drops snap to the
                      next same-type detected level; invalid drops return to
                      their starting position.
                    </p>
                    {Object.keys(levelOverrides).length > 0 && (
                      <button
                        className="reset-zones"
                        onClick={() => setLevelOverrides({})}
                      >
                        <RefreshCcw size={13} /> Reset moved zones
                      </button>
                    )}
                    <button
                      className="hide-zones"
                      onClick={() => {
                        setShowSupportZones(false);
                        setShowResistanceZones(false);
                      }}
                    >
                      <Layers size={13} /> Hide all zones
                    </button>
                  </div>
                )}
              </div>
              <button
                className={showPivots ? "selected" : ""}
                onClick={() => setShowPivots((v) => !v)}
              >
                <Activity size={15} /> Pivots
              </button>
              <button
                className="toolbar-info"
                aria-label="Explain confirmed pivots"
                title="Explain confirmed pivots"
                onClick={() => setInfoDetail(pivotInfo)}
              >
                <CircleHelp size={15} />
              </button>
              <button
                title="Reload candles"
                onClick={() => setReload((x) => x + 1)}
              >
                <RefreshCcw size={15} />
              </button>
            </div>
          </div>
          <div className="chart-stage">
            <div className="chart-area" ref={chartDiv} />
            {selectedCandle && selectedCandleMetrics && (
              <section className="candle-inspector" aria-live="polite">
                <div className="candle-inspector-head">
                  <div>
                    <span>CLICKED CANDLE</span>
                    <strong>
                      {selectedCandle.readings[0]?.name || "Price candle"}
                    </strong>
                  </div>
                  <button
                    aria-label="Close candle inspector"
                    onClick={() => setSelectedCandle(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
                <time>
                  {new Date(
                    selectedCandle.candle.time * 1000,
                  ).toLocaleString()}
                </time>
                <div className={`candle-visual-card ${selectedCandle.candle.close >= selectedCandle.candle.open ? "bullish" : "bearish"}`}>
                  <CandleIllustration candle={selectedCandle.candle} />
                  <div>
                    <span>SELECTED CANDLE SHAPE</span>
                    <strong>
                      {selectedCandle.candle.close >= selectedCandle.candle.open
                        ? "Up-close candle"
                        : "Down-close candle"}
                    </strong>
                    <p>Body and wick proportions are drawn from this candle’s prices.</p>
                  </div>
                </div>
                <div className="candle-reading-list">
                  {selectedCandle.readings.map((reading) => (
                    <div className={reading.direction} key={reading.name}>
                      <b>{reading.name}</b>
                      <p>{reading.description}</p>
                    </div>
                  ))}
                </div>
                <div className="candle-measurements">
                  <span>
                    O <b>{formatPrice(selectedCandle.candle.open)}</b>
                  </span>
                  <span>
                    H <b>{formatPrice(selectedCandle.candle.high)}</b>
                  </span>
                  <span>
                    L <b>{formatPrice(selectedCandle.candle.low)}</b>
                  </span>
                  <span>
                    C <b>{formatPrice(selectedCandle.candle.close)}</b>
                  </span>
                  <span>
                    BODY <b>{formatPrice(selectedCandleMetrics.body)}</b>
                  </span>
                  <span>
                    UPPER WICK{" "}
                    <b>{formatPrice(selectedCandleMetrics.upperWick)}</b>
                  </span>
                  <span>
                    LOWER WICK{" "}
                    <b>{formatPrice(selectedCandleMetrics.lowerWick)}</b>
                  </span>
                  <span>
                    CHANGE{" "}
                    <b>{formatPercent(selectedCandleMetrics.change)}</b>
                  </span>
                </div>
              </section>
            )}
            <div className="active-indicator-legend">
              {(Object.keys(indicators) as IndicatorKey[])
                .filter((key) => indicators[key])
                .map((key) => (
                  <button
                    key={key}
                    onClick={() => setInfoDetail(indicatorInfo[key])}
                    title={`Explain ${indicatorLabels[key]}`}
                  >
                    <span className={`swatch ${key}`} />
                    {indicatorLabels[key]}
                    <CircleHelp size={11} />
                  </button>
                ))}
            </div>
            <div className="zone-layer">
              {zoneRects.map((zone) => (
                <div
                  className={`zone-rect ${zone.kind}${draggingLevelKey === zone.dragKey ? " dragging" : ""}${returningLevelKey === zone.dragKey ? " returning" : ""}`}
                  style={{ top: zone.top, height: zone.height }}
                  key={zone.dragKey}
                >
                  <button
                    aria-label={`Drag ${zone.kind} ${zone.rank} at ${formatPrice(zone.price)} or click for details`}
                    title="Drag to another valid same-type level · Invalid drops return"
                    onPointerDown={(event) => startLevelDrag(event, zone)}
                    onPointerMove={(event) => moveLevelDrag(event, zone)}
                    onPointerUp={(event) => finishLevelDrag(event, zone)}
                    onPointerCancel={(event) => cancelLevelDrag(event, zone)}
                    onClick={(event) => handleLevelClick(event, zone)}
                  >
                    {zone.kind} {zone.rank} · {formatPrice(zone.price)} ·{" "}
                    {zone.touches} touches
                  </button>
                </div>
              ))}
            </div>
            <div className="concept-layer">
              {conceptRects.map((rect, index) => (
                <div
                  className={`concept-rect ${rect.kind}${rect.muted ? " muted" : ""}`}
                  style={{
                    left: rect.left,
                    width: rect.width,
                    top: rect.top,
                    height: rect.height,
                  }}
                  key={`${rect.kind}-${rect.left}-${rect.top}-${index}`}
                >
                  <button
                    aria-label={`Explain ${rect.label}`}
                    onClick={() => showConceptInfo(rect)}
                  >
                    {rect.label}
                  </button>
                </div>
              ))}
              {fibLines.map((line, index) => (
                <div
                  className={`fib-line fib-${String(line.ratio).replace(".", "-")}`}
                  style={{ left: line.left, width: line.width, top: line.top }}
                  key={`${line.ratio}-${index}`}
                >
                  <button
                    aria-label={`Explain Fibonacci ${(line.ratio * 100).toFixed(1)} percent`}
                    onClick={() => showFibInfo(line)}
                  >
                    {(line.ratio * 100).toFixed(
                      line.ratio === 0 || line.ratio === 1 ? 0 : 1,
                    )}
                    % · {line.name} · {formatPrice(line.price)}
                  </button>
                </div>
              ))}
            </div>
            {focusedPattern && patternDrawing && (
              <>
                <svg
                  className={`pattern-drawing-layer ${focusedPattern.direction}`}
                  aria-label={`${focusedPattern.name} marked on chart`}
                  role="img"
                >
                  {patternDrawing.segments.map((segment, index) => (
                    <line
                      key={`pattern-segment-${index}`}
                      x1={segment.x1}
                      y1={segment.y1}
                      x2={segment.x2}
                      y2={segment.y2}
                    />
                  ))}
                  {patternDrawing.points.map((point, index) => (
                    <g key={`pattern-point-${index}`}>
                      <circle cx={point.x} cy={point.y} r="4" />
                      <text x={point.x + 7} y={point.y - 7}>
                        {point.label}
                      </text>
                    </g>
                  ))}
                </svg>
                <div className={`pattern-focus-label ${focusedPattern.direction}`} role="status">
                  <span>{focusedPattern.name} · MARKED ON CHART</span>
                  <button
                    aria-label={`Clear ${focusedPattern.name} chart highlight`}
                    title="Clear pattern highlight"
                    onClick={() => setFocusedPatternName(null)}
                  >
                    <X size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
          {loading && <div className="floating">Loading live candles…</div>}
          {error && <div className="error">{error}</div>}
          <div className="footnote">
            Click any candle to identify it · Drag to pan · Scroll or pinch to
            zoom · SMC, patterns and Fibonacci recalculate from completed
            candles
          </div>
        </section>
        <aside>
          <div className="panel-head">
            <div>
              <div className="eyebrow">MARKET INTELLIGENCE</div>
              <h2>
                <BrainCircuit size={18} color="#32d59c" /> AI Analyst
              </h2>
            </div>
            <div className="panel-head-actions">
              <AnimatedCompanion
                onActivate={() => chatInputRef.current?.focus()}
              />
              <span className="pill">BETA</span>
            </div>
          </div>
          <div className="side-content">
            <section className="ai-chat" aria-labelledby="ai-chat-title">
              <div className="chat-title-row">
                <div>
                  <div className="eyebrow">ASK ABOUT ANYTHING</div>
                  <h3 id="ai-chat-title">
                    <MessageSquareText size={16} /> Chat with AI
                  </h3>
                </div>
                <label className="provider-choice">
                  <span>Model provider</span>
                  <select
                    aria-label="AI provider"
                    value={chatProvider}
                    onChange={(event) =>
                      setChatProvider(event.target.value as AiProvider)
                    }
                  >
                    <option value="venice" disabled={!chatProviders.venice}>
                      Venice AI{chatProviders.venice ? "" : " · not set"}
                    </option>
                    <option value="gemini" disabled={!chatProviders.gemini}>
                      Gemini{chatProviders.gemini ? "" : " · not set"}
                    </option>
                  </select>
                </label>
              </div>
              <div className="chat-options">
                <label
                  className={analysis ? "context-toggle" : "context-toggle off"}
                >
                  <input
                    type="checkbox"
                    checked={includeChartContext && Boolean(analysis)}
                    disabled={!analysis}
                    onChange={(event) =>
                      setIncludeChartContext(event.target.checked)
                    }
                  />
                  <span>
                    {analysis
                      ? `Use ${symbol} · ${interval} chart context`
                      : "Chart context unavailable"}
                  </span>
                </label>
                <button
                  className="clear-chat"
                  aria-label="Clear AI conversation"
                  title="Clear conversation"
                  disabled={!chatMessages.length || chatLoading}
                  onClick={() => {
                    setChatMessages([]);
                    setChatError("");
                  }}
                >
                  <Trash2 size={13} /> Clear
                </button>
              </div>
              <div className="chat-messages" aria-live="polite">
                {!chatMessages.length && (
                  <div className="chat-empty">
                    Ask about this chart, a crypto concept, or any general
                    reasoning question.
                    <div className="chat-prompts">
                      <button
                        disabled={!analysis || chatLoading}
                        onClick={() =>
                          void sendChat(
                            "Explain the current chart structure in plain language.",
                          )
                        }
                      >
                        Explain this chart
                      </button>
                      <button
                        disabled={chatLoading}
                        onClick={() =>
                          void sendChat(
                            "What is a fair value gap in crypto chart analysis?",
                          )
                        }
                      >
                        Explain FVG
                      </button>
                    </div>
                  </div>
                )}
                {chatMessages.map((message) => (
                  <article
                    className={`chat-message ${message.role}`}
                    key={message.id}
                  >
                    <div>
                      {message.role === "user"
                        ? "YOU"
                        : message.provider === "venice"
                          ? "VENICE AI"
                          : "GEMINI"}
                    </div>
                    <p>{message.content}</p>
                  </article>
                ))}
                {chatLoading && (
                  <div className="chat-thinking">
                    <span /> <span /> <span />
                    {chatProvider === "venice" ? "Venice" : "Gemini"} is
                    thinking
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              {chatError && <div className="chat-error">{chatError}</div>}
              <form className="chat-composer" onSubmit={submitChat}>
                <textarea
                  ref={chatInputRef}
                  aria-label="Message AI"
                  placeholder="Ask about the chart, crypto, or anything else…"
                  rows={2}
                  maxLength={4000}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  aria-label="Send message"
                  title="Send message"
                  disabled={
                    !chatInput.trim() ||
                    chatLoading ||
                    !chatProviders[chatProvider]
                  }
                >
                  <Send size={15} />
                </button>
              </form>
              <p className="chat-note">
                Enter to send · Shift+Enter for a new line. Market discussion is
                educational, not financial advice.
              </p>
            </section>
            <div className="separator" />
            <div className="eyebrow">TREND CLASSIFICATION</div>
            <div className={`trend ${analysis?.trend.toLowerCase() || ""}`}>
              {analysis?.trend || "Waiting for candles"}
            </div>
            <p className="muted">
              {analysis?.recentStructure ||
                "Load market data to view structural analysis."}
            </p>
            <div className="pattern-heading">
              <div className="eyebrow">TECHNICAL CHART PATTERNS</div>
              <span>{analysis?.patterns.length || 0} detected</span>
            </div>
            {analysis?.patterns.length ? (
              <div className="pattern-list">
                {analysis.patterns.map((pattern) => (
                  <button
                    className={`pattern-card ${pattern.direction}${focusedPatternName === pattern.name ? " focused" : ""}`}
                    key={`${pattern.name}-${pattern.startIndex}`}
                    aria-pressed={focusedPatternName === pattern.name}
                    title={`${pattern.description} Click to locate and mark this pattern on the chart.`}
                    onClick={() => focusChartPattern(pattern)}
                  >
                    <PatternThumbnail
                      name={pattern.name}
                      direction={pattern.direction}
                    />
                    <span>{pattern.name}</span>
                    <small>{pattern.direction}</small>
                    <strong>{pattern.confidence}%</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted compact">
                No confirmed double top/bottom, head and shoulders, triangle,
                wedge, or flag pattern in the current completed-candle window.
              </p>
            )}
            <div className="separator" />
            <div className="eyebrow">INDICATOR SNAPSHOT</div>
            <div className="indicator-grid">
              <button
                className="info-card"
                onClick={() => setInfoDetail(indicatorInfo.ema20)}
              >
                <span>EMA 20</span>
                <strong>
                  {analysis
                    ? analysis.indicators.ema20.toFixed(
                        analysis.last >= 10 ? 2 : 5,
                      )
                    : "—"}
                </strong>
              </button>
              <button
                className="info-card"
                onClick={() => setInfoDetail(indicatorInfo.ema50)}
              >
                <span>EMA 50</span>
                <strong>
                  {analysis
                    ? analysis.indicators.ema50.toFixed(
                        analysis.last >= 10 ? 2 : 5,
                      )
                    : "—"}
                </strong>
              </button>
              <button
                className="info-card"
                onClick={() => setInfoDetail(rsiInfo)}
              >
                <span>RSI 14</span>
                <strong
                  className={
                    analysis && analysis.indicators.rsi14 >= 70
                      ? "hot"
                      : analysis && analysis.indicators.rsi14 <= 30
                        ? "cool"
                        : ""
                  }
                >
                  {analysis ? analysis.indicators.rsi14.toFixed(1) : "—"}
                </strong>
              </button>
            </div>
            <div className="separator" />
            <div className="eyebrow">SMART MONEY CONCEPTS</div>
            <div className="smc-grid">
              <button
                className="info-card"
                onClick={() => setInfoDetail(conceptInfo.fairValueGaps)}
              >
                <span>ACTIVE FVG</span>
                <strong>
                  {analysis
                    ? analysis.smartMoney.fairValueGaps.filter(
                        (gap) => !gap.mitigated,
                      ).length
                    : "—"}
                </strong>
              </button>
              <button
                className="info-card"
                onClick={() => setInfoDetail(conceptInfo.orderBlocks)}
              >
                <span>ORDER BLOCKS</span>
                <strong>
                  {analysis ? analysis.smartMoney.orderBlocks.length : "—"}
                </strong>
              </button>
              <button
                className="info-card"
                onClick={() => setInfoDetail(conceptInfo.structure)}
              >
                <span>LAST STRUCTURE</span>
                <strong>
                  {analysis?.smartMoney.structureEvents.slice(-1)[0]?.kind ??
                    "—"}
                </strong>
              </button>
              <button
                className="info-card"
                onClick={() => setInfoDetail(conceptInfo.fibonacci)}
              >
                <span>FIB 61.8% · GOLDEN RATIO</span>
                <strong>
                  {fibonacciForDisplay?.levels
                    .find((level) => level.ratio === 0.618)
                    ?.price.toFixed((analysis?.last ?? 0) >= 10 ? 2 : 5) ?? "—"}
                </strong>
              </button>
            </div>
            <div className="separator" />
            <div className="eyebrow">VISIBLE SUPPORT & RESISTANCE</div>
            <div className="levels">
              {visibleLevels.length ? (
                visibleLevels.map((level, i) => (
                  <button
                    className="level"
                    key={i}
                    onClick={() => showLevelInfo(level)}
                  >
                    <span className={level.kind}>
                      {level.kind.toUpperCase()}
                    </span>
                    <strong>
                      {level.price.toFixed(level.price >= 10 ? 2 : 5)}
                    </strong>
                    <small>{level.touches} touches</small>
                    <CircleHelp size={12} />
                  </button>
                ))
              ) : (
                <p className="muted">
                  {!showSupportZones && !showResistanceZones
                    ? "Support and resistance zones are hidden."
                    : "No repeat-tested levels detected."}
                </p>
              )}
            </div>
            <div className="separator" />
            <div className="eyebrow">SCENARIO TRIGGERS</div>
            <div className="scenario">
              <span>Potential long trigger</span>
              <strong>{analysis?.bullishTrigger?.toFixed(5) ?? "N/A"}</strong>
            </div>
            <div className="scenario">
              <span>Potential short trigger</span>
              <strong>{analysis?.bearishTrigger?.toFixed(5) ?? "N/A"}</strong>
            </div>
            <div className="separator" />
            <div className="action-grid">
              <button
                className="analyze"
                disabled={!analysis || aiLoading}
                aria-busy={aiLoading}
                onClick={askAi}
              >
                <span className="action-icon">
                  <CandlestickChart size={17} aria-hidden="true" />
                </span>
                <span className="action-copy">
                  <strong>{aiLoading ? "Analysing…" : "Explain chart"}</strong>
                  <small>AI summary of the current chart</small>
                </span>
                <ChevronRight className="action-arrow" size={15} aria-hidden="true" />
              </button>
              <button
                className="generate-signal"
                disabled={!analysis}
                onClick={() => {
                  setSignalError("");
                  if (riskAcknowledged) generateSignal();
                  else setSignalModal(true);
                }}
              >
                <span className="action-icon">
                  <Activity size={17} aria-hidden="true" />
                </span>
                <span className="action-copy">
                  <strong>
                    {riskAcknowledged && signalPlan ? "Refresh signal" : "Generate signal"}
                  </strong>
                  <small>Instant local analysis · no AI required</small>
                </span>
                <ChevronRight className="action-arrow" size={15} aria-hidden="true" />
              </button>
            </div>
            <section className="signal-settings">
              <button
                className="signal-settings-toggle"
                type="button"
                aria-expanded={signalSettingsOpen}
                aria-controls="signal-settings-panel"
                onClick={() => setSignalSettingsOpen((open) => !open)}
              >
                <Settings2 size={15} aria-hidden="true" />
                <span>Signal confirmation checks</span>
                <small>{signalFactors.length} selected</small>
                <ChevronRight
                  size={14}
                  className={signalSettingsOpen ? "expanded" : ""}
                  aria-hidden="true"
                />
              </button>
              {signalSettingsOpen && (
                <div className="signal-settings-panel" id="signal-settings-panel">
                  <p>
                    Choose at least two checks. Every selected check must agree;
                    a recent confirmed structure break is always required.
                  </p>
                  <div className="signal-factor-grid">
                    {SIGNAL_FACTORS.map((factor) => {
                      const checked = signalFactors.includes(factor.id);
                      return (
                        <label className="signal-factor" key={factor.id}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={checked && signalFactors.length <= 2}
                            onChange={() => toggleSignalFactor(factor.id)}
                          />
                          <span>
                            <strong>{factor.label}</strong>
                            <small>{factor.description}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <small className="signal-factor-note">
                    SMA 200 needs 200 completed candles. Settings are saved on this device.
                  </small>
                </div>
              )}
            </section>
            {aiText && <ChartInsight text={aiText} />}
            {signalError && <div className="signal-error">{signalError}</div>}
            {signalPlan && (
              <section
                className={`signal-output ${signalPlan.direction.toLowerCase()}`}
                aria-live="polite"
              >
                <div className="signal-heading">
                  <div className="signal-title-row">
                    <span className="signal-badge">{signalPlan.direction}</span>
                    <span className="signal-engine-tag">RULE-BASED · NO AI</span>
                  </div>
                  <small>
                    {interval} · {signalPlan.time
                      ? new Date(signalPlan.time * 1000).toLocaleString()
                      : "Waiting for candle data"}
                  </small>
                </div>
                <p className="signal-summary">{signalPlan.summary}</p>
                <p className="signal-checks-used">
                  Checks used: {signalPlan.selectedFactors
                    .map((factor) => SIGNAL_FACTORS.find((item) => item.id === factor)?.label)
                    .filter(Boolean)
                    .join(" · ") || "none"}
                  {" · structure break required"}
                </p>
                <div className="signal-levels">
                  {signalPlan.direction === "WAIT" ? (
                    <>
                      <div>
                        <span>LONG trigger · close above</span>
                        <strong>
                          {signalPlan.buyTrigger === null
                            ? "—"
                            : formatPrice(signalPlan.buyTrigger)}
                        </strong>
                      </div>
                      <div>
                        <span>SHORT trigger · close below</span>
                        <strong>
                          {signalPlan.sellTrigger === null
                            ? "—"
                            : formatPrice(signalPlan.sellTrigger)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <span>{signalPlan.direction} entry · candle close</span>
                        <strong>{formatPrice(signalPlan.entry ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Exit if invalidated</span>
                        <strong>{formatPrice(signalPlan.stop ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Target reference</span>
                        <strong>{formatPrice(signalPlan.target ?? 0)}</strong>
                      </div>
                      <div>
                        <span>Potential reward : risk</span>
                        <strong>
                          {signalPlan.rewardRisk === null
                            ? "—"
                            : `${signalPlan.rewardRisk.toFixed(2)} : 1`}
                        </strong>
                      </div>
                    </>
                  )}
                </div>
                {signalPlan.reasons.length > 0 && (
                  <details className="signal-reasons">
                    <summary>Why this result?</summary>
                    <ul>
                      {signalPlan.reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="signal-chart-note">
                  {signalPlan.direction === "WAIT"
                    ? "Watch levels are drawn on the chart. No entry or exit is active."
                    : "Entry, invalidation, and target are marked on the chart. These are reference levels, not orders."}
                </div>
              </section>
            )}
            {!/\b(?:risk note|not financial advice)\b/i.test(aiText) && (
              <p className="signal-warning">
                <ShieldAlert size={13} /> Signals are educational chart scenarios,
                not financial advice. Crypto markets are volatile; a setup can fail.
              </p>
            )}
            {createPortal(
              <div
                ref={paperDockRef}
                id="paper-dock"
                className={`paper-dock${paperDockExpanded ? " is-expanded" : ""}${paperFullscreen ? " is-fullscreen" : ""}`}
              >
                {paperDockExpanded && (
            <section className="paper-trading paper-dock-panel" id="paper-dock-panel" aria-labelledby="paper-trading-title">
              <div className="paper-heading">
                <span className="paper-icon"><Wallet size={16} aria-hidden="true" /></span>
                <span className="paper-title-copy">
                  <strong id="paper-trading-title">Demo trading</strong>
                  <small>Paper positions · saved on this device</small>
                </span>
                <span className="paper-mode-tag">SIMULATION</span>
                <button
                  className="paper-fullscreen-toggle"
                  type="button"
                  aria-label={paperFullscreen ? "Exit chart and demo trading workspace" : "Show chart alongside demo trading"}
                  aria-pressed={paperFullscreen}
                  title={paperFullscreen ? "Exit chart and trading workspace" : "Show chart and trading side by side"}
                  onClick={togglePaperFullscreen}
                >
                  {paperFullscreen ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
                  <span>{paperFullscreen ? "Exit workspace" : "Chart + trading"}</span>
                </button>
              </div>
              <div className="paper-account-grid">
                <div><span>Balance</span><strong>{formatMoney(paperPortfolio.balance)}</strong></div>
                <div><span>Equity</span><strong>{formatMoney(paperEquity)}</strong></div>
                <div><span>Available</span><strong>{formatMoney(paperAvailable)}</strong></div>
                <div>
                  <span>Unrealized P&amp;L</span>
                  <strong className={paperOutcomeClass}>
                    {paperUnrealizedPnl === null ? "—" : formatSignedMoney(paperUnrealizedPnl)}
                  </strong>
                  {paperUnrealizedReturn !== null && (
                    <small className={`paper-account-return ${paperOutcomeClass}`}>
                      {formatSignedPercent(paperUnrealizedReturn)} ROE · before close fees
                    </small>
                  )}
                </div>
              </div>

              {paperPortfolio.pendingOrder && (
                <div className={`paper-pending-order ${paperPortfolio.pendingOrder.direction.toLowerCase()}`}>
                  <div className="paper-pending-copy">
                    <span className="paper-position-badge">PENDING · {paperPortfolio.pendingOrder.direction} LIMIT</span>
                    <strong>{paperPortfolio.pendingOrder.symbol} · {formatPrice(paperPortfolio.pendingOrder.limitPrice)}</strong>
                    <small>
                      {paperPortfolio.pendingOrder.provider.toUpperCase()} · {paperPortfolio.pendingOrder.interval}
                      {matchedPendingLiveMark
                        ? ` · Mark ${formatPrice(matchedPendingLiveMark.price)}`
                        : " · waiting for mark"}
                      {` · Reserved ${formatMoney(paperPortfolio.pendingOrder.margin)}`}
                      {paperMarkFeedState === "live"
                        ? " · live price watch"
                        : " · reconnecting to its market price"}
                    </small>
                  </div>
                  <button type="button" onClick={cancelPendingPaperOrder}>Cancel order</button>
                </div>
              )}

              {activePaperPosition && (
                <div className={`paper-open-position ${activePaperPosition.direction.toLowerCase()}`}>
                  <div className="paper-open-heading">
                    <span className="paper-position-badge">OPEN · {activePaperPosition.direction}</span>
                    <strong>{activePaperPosition.symbol}</strong>
                    <small>{activePaperPosition.provider.toUpperCase()} · ISOLATED · {activePaperPosition.interval}</small>
                  </div>
                  {paperUnrealizedPnl !== null && paperUnrealizedReturn !== null && (
                    <div className={`paper-position-performance ${paperOutcomeClass}`} aria-live="polite">
                      <div className="paper-performance-value">
                        <span className="paper-performance-label">Unrealized P&amp;L · before fees</span>
                        <strong>{formatSignedMoney(paperUnrealizedPnl)}</strong>
                      </div>
                      <div className="paper-performance-return">
                        <span>ROE · live price-to-market</span>
                        <strong>{formatSignedPercent(paperUnrealizedReturn)}</strong>
                      </div>
                      {paperEstimatedNetClosePnl !== null && (
                        <div className="paper-performance-net">
                          <span>Est. net if closed now · after round-trip fees</span>
                          <strong className={paperEstimatedNetClosePnl >= 0 ? "positive" : "negative"}>
                            {formatSignedMoney(paperEstimatedNetClosePnl)}
                          </strong>
                        </div>
                      )}
                      <span className={`paper-mark-status${paperMarkIsLive ? "" : " stale"}`}>
                        {paperMarkIsLive
                          ? paperPriceSourceLabel
                          : paperMarkFeedState === "connecting"
                            ? `CONNECTING · ${paperPriceSourceLabel}`
                            : paperMarkFeedState === "stale"
                              ? `FEED DELAYED · ${paperPriceSourceLabel}`
                              : paperPriceSourceLabel}
                      </span>
                      {matchedPaperLiveMark && (
                        <small className="paper-mark-time">
                          Updated {new Date(matchedPaperLiveMark.updatedAt).toLocaleTimeString()}
                        </small>
                      )}
                    </div>
                  )}
                  <div className="paper-position-levels">
                    <div><span>Entry price</span><strong>{formatPrice(activePaperPosition.entry)}</strong></div>
                    <div className={paperOutcomeClass}><span>P&amp;L price</span><strong>{formatPrice(paperMarkPrice)}</strong></div>
                    <div><span>Position size</span><strong>{activePaperPosition.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
                    <div><span>Initial margin</span><strong>{formatMoney(activePaperPosition.margin)}</strong></div>
                    <div><span>Leverage · mode</span><strong>{activePaperPosition.leverage}× · Isolated</strong></div>
                    <div><span>Stop loss</span><strong>{formatPrice(activePaperPosition.stop)}</strong></div>
                    <div><span>Take profit</span><strong>{formatPrice(activePaperPosition.target)}</strong></div>
                    <div><span>Est. liquidation</span><strong>{formatPrice(activePaperPosition.liquidationPrice)}</strong></div>
                  </div>
                  <button
                    className="paper-close-button"
                    type="button"
                    disabled={!paperBookIsFresh || activePaperPosition.provider !== provider || activePaperPosition.symbol !== symbol}
                    onClick={closePaperPositionAtMark}
                  >
                    Close against live {activePaperPosition.direction === "LONG" ? "bids" : "asks"}
                  </button>
                </div>
              )}

              <div className="paper-terminal-layout">
                <section className="paper-orderbook-panel" aria-label={`${symbol} live order book`}>
                  <div className="paper-orderbook-heading">
                    <span><strong>Order book</strong><small>{provider.toUpperCase()} · {matchingPaperOrderBook?.marketType.toUpperCase() || "MARKET"} · {symbol}</small></span>
                    <span className={`paper-book-status ${paperBookFeedState}`}>
                      {paperBookFeedState === "live" ? "LIVE · WS" : paperBookFeedState === "connecting" ? "CONNECTING" : paperBookFeedState === "syncing" ? "SYNCING" : paperBookFeedState === "reconnecting" ? "RECONNECTING" : paperBookFeedState === "stale" ? "STALE" : "PAUSED"}
                    </span>
                  </div>
                  <div className="paper-book-columns"><span>Price</span><span>Size</span><span>Total</span></div>
                  {matchingPaperOrderBook ? (
                    <>
                      <div className="paper-book-side asks">
                        {displayedPaperAsks.map((level) => (
                          <button
                            type="button"
                            key={`ask-${level.price}`}
                            className="paper-book-level ask"
                            style={{ "--depth": `${Math.min(100, (level.cumulativeQuote / paperBookDepthMax) * 100)}%` } as React.CSSProperties}
                            title="Use this ask price as a limit price"
                            onClick={() => {
                              setPaperOrderType("LIMIT");
                              setPaperEntry(String(level.price));
                              setPaperError("");
                            }}
                          >
                            <span>{formatPrice(level.price)}</span>
                            <span>{level.size.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
                            <span>{level.cumulativeQuote.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })}</span>
                          </button>
                        ))}
                      </div>
                      <div className="paper-book-mid">
                        <strong>{formatPrice(matchingPaperOrderBook.midPrice)}</strong>
                        <span>Spread {formatPrice(matchingPaperOrderBook.spread)} · {matchingPaperOrderBook.spreadPercent.toFixed(3)}%</span>
                      </div>
                      <div className="paper-book-side bids">
                        {displayedPaperBids.map((level) => (
                          <button
                            type="button"
                            key={`bid-${level.price}`}
                            className="paper-book-level bid"
                            style={{ "--depth": `${Math.min(100, (level.cumulativeQuote / paperBookDepthMax) * 100)}%` } as React.CSSProperties}
                            title="Use this bid price as a limit price"
                            onClick={() => {
                              setPaperOrderType("LIMIT");
                              setPaperEntry(String(level.price));
                              setPaperError("");
                            }}
                          >
                            <span>{formatPrice(level.price)}</span>
                            <span>{level.size.toLocaleString(undefined, { maximumFractionDigits: 5 })}</span>
                            <span>{level.cumulativeQuote.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 2 })}</span>
                          </button>
                        ))}
                      </div>
                      <div className="paper-book-updated">WS received {new Date(matchingPaperOrderBook.updatedAt).toLocaleTimeString()} · exchange {new Date(matchingPaperOrderBook.exchangeTime).toLocaleTimeString()}</div>
                    </>
                  ) : (
                    <div className="paper-book-empty">
                      {paperBookFeedState === "stale"
                        ? "This market’s public depth is temporarily unavailable."
                        : "Connecting to the exchange’s public depth feed…"}
                    </div>
                  )}
                </section>
                <div className="paper-ticket-column">
              <div className="paper-setup">
                <div className="paper-section-heading">
                  <span>
                    <strong>Position setup</strong>
                    <small>Choose an order type, then set direction and protection</small>
                  </span>
                </div>
                <div className="paper-order-switch" role="group" aria-label="Demo order type">
                  <button
                    type="button"
                    className={paperOrderType === "MARKET" ? "active" : ""}
                    aria-pressed={paperOrderType === "MARKET"}
                    onClick={() => {
                      setPaperOrderType("MARKET");
                      setPaperEntry("");
                      setPaperStop("");
                      setPaperTarget("");
                      setPaperError("");
                    }}
                  >Market</button>
                  <button
                    type="button"
                    className={paperOrderType === "LIMIT" ? "active" : ""}
                    aria-pressed={paperOrderType === "LIMIT"}
                    onClick={() => {
                      setPaperOrderType("LIMIT");
                      setPaperEntry(current ? String(current.close) : "");
                      setPaperStop("");
                      setPaperTarget("");
                      setPaperError("");
                    }}
                  >Limit</button>
                </div>
                <p className="paper-order-note">
                  {paperOrderType === "MARKET"
                    ? `Market buy takes asks; market sell takes bids${paperExecutablePrice ? ` · best price ${formatPrice(paperExecutablePrice)}` : " · waiting for live depth"}. Final entry uses depth-weighted fill.`
                    : paperLimitIsMarketable
                      ? "This limit crosses the live book and will fill only against available depth at your limit price or better."
                      : "The limit stays pending until the chart price reaches it. Reserved margin is released if you cancel."}
                </p>
                <div className="paper-direction-switch" role="group" aria-label="Demo position direction">
                  <button
                    type="button"
                    className={paperDirection === "LONG" ? "active long" : ""}
                    aria-pressed={paperDirection === "LONG"}
                    onClick={() => {
                      setPaperDirection("LONG");
                      setPaperStop("");
                      setPaperTarget("");
                      setPaperError("");
                    }}
                  ><ArrowUpRight size={14} /> LONG</button>
                  <button
                    type="button"
                    className={paperDirection === "SHORT" ? "active short" : ""}
                    aria-pressed={paperDirection === "SHORT"}
                    onClick={() => {
                      setPaperDirection("SHORT");
                      setPaperStop("");
                      setPaperTarget("");
                      setPaperError("");
                    }}
                  ><ArrowDownRight size={14} /> SHORT</button>
                  {signalPlan && signalPlan.direction !== "WAIT" && (
                    <button className="paper-load-signal" type="button" onClick={loadSignalIntoPaperSetup}>
                      Load signal levels
                    </button>
                  )}
                </div>
                <div className="paper-input-grid paper-level-inputs">
                  {paperOrderType === "MARKET" ? (
                    <label>Market price
                      <input type="number" aria-label="Current executable market price" value={paperExecutablePrice ? String(paperExecutablePrice) : ""} placeholder="Waiting for live book" readOnly />
                    </label>
                  ) : (
                    <label>Limit price
                      <input type="number" min="0" step="any" placeholder="Limit price" value={paperEntry || (current ? String(current.close) : "")} onChange={(event) => setPaperEntry(event.target.value)} />
                    </label>
                  )}
                  <label>Stop
                    <input type="number" min="0" step="any" placeholder="—" value={paperStop || (current ? String(defaultPaperStop) : "")} onChange={(event) => setPaperStop(event.target.value)} />
                  </label>
                  <label>Target
                    <input type="number" min="0" step="any" placeholder="—" value={paperTarget || (current ? String(defaultPaperTarget) : "")} onChange={(event) => setPaperTarget(event.target.value)} />
                  </label>
                </div>
                <div className="paper-input-grid paper-risk-inputs">
                  <label>Risk per trade
                    <span className="paper-suffix-field"><input type="number" min="0.1" max="5" step="0.1" value={paperRiskPercent} onChange={(event) => setPaperRiskPercent(event.target.value)} /><i>%</i></span>
                  </label>
                  <label>Leverage
                    <span className="paper-suffix-field"><input type="number" min="1" max="50" step="1" value={paperLeverage} onChange={(event) => setPaperLeverage(event.target.value)} /><i>×</i></span>
                  </label>
                  <details className="paper-costs">
                    <summary>Cost assumptions</summary>
                    <div className="paper-input-grid">
                      <label>Maintenance margin
                        <span className="paper-suffix-field"><input type="number" min="0.01" max="10" step="0.01" value={paperMaintenanceMarginPercent} onChange={(event) => setPaperMaintenanceMarginPercent(event.target.value)} /><i>%</i></span>
                      </label>
                      <label>Fee per side
                        <span className="paper-suffix-field"><input type="number" min="0" max="1" step="0.01" value={paperFeePercent} onChange={(event) => setPaperFeePercent(event.target.value)} /><i>%</i></span>
                      </label>
                    </div>
                  </details>
                </div>

                {paperQuoteResult.quote ? (
                  <>
                    <div className="paper-quote-heading">
                      <strong>Trade estimate</strong>
                      <span>Updates with your setup</span>
                    </div>
                    <div className="paper-quote-grid">
                      <div><span>Position size</span><strong>{paperQuoteResult.quote.quantity.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
                      <div><span>Notional · margin</span><strong>{formatMoney(paperQuoteResult.quote.notional)} · {formatMoney(paperQuoteResult.quote.margin)}</strong></div>
                      <div><span>Loss at stop</span><strong className="negative">−{formatMoney(paperQuoteResult.quote.stopLoss)}</strong></div>
                      <div><span>Net at target</span><strong className="positive">+{formatMoney(paperQuoteResult.quote.targetProfit)}</strong></div>
                      <div><span>Reward : risk</span><strong>{paperQuoteResult.quote.rewardRisk.toFixed(2)} : 1</strong></div>
                      <div><span>Est. liquidation</span><strong>{formatPrice(paperQuoteResult.quote.liquidationPrice)}</strong></div>
                      {paperQuoteResult.quote.isLeverageCapped && (
                        <p className="paper-cap-note">Size is capped by demo balance and leverage.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="paper-form-error">{paperQuoteResult.error}</p>
                )}
                {paperError && <p className="paper-form-error" role="alert">{paperError}</p>}
                <button
                  className={`paper-open-button ${paperDirection.toLowerCase()}`}
                  type="button"
                  disabled={!paperQuoteResult.quote || !canSubmitPaperDirection(paperDirection)}
                  onClick={() => openPaperPosition()}
                >
                  {activePaperPosition
                    ? paperCanReverseAtMarket
                      ? `Close ${activePaperPosition.direction} · open ${paperDirection}`
                      : "Manage the open demo position first"
                    : paperPortfolio.pendingOrder
                      ? "Cancel the pending order first"
                    : paperOrderType === "LIMIT"
                      ? `Place ${paperDirection} limit order`
                      : `Open ${paperDirection} market position`}
                </button>
                <p className="paper-disclaimer">
                  Local simulation only; no orders are sent. Prices and unrealized P&amp;L refresh from the selected market feed while this app is open (mark price where available, otherwise last traded price). Limit, stop, target, and liquidation events are simulated; funding, slippage, partial fills, venue fee tiers, and exchange risk tiers are not modeled.
                </p>
              </div>
                </div>
              </div>

              {paperFullscreen && (
                <section className="paper-terminal-activity" aria-label="Demo account activity">
                  <div className="paper-terminal-tabs" role="tablist" aria-label="Demo order activity">
                    {([
                      ["POSITIONS", `Positions ${activePaperPosition ? "(1)" : "(0)"}`],
                      ["OPEN_ORDERS", `Open orders ${paperPortfolio.pendingOrder ? "(1)" : "(0)"}`],
                      ["TRADE_HISTORY", `Trade history (${paperPortfolio.history.length})`],
                    ] as const).map(([tab, label]) => (
                      <button
                        type="button"
                        role="tab"
                        key={tab}
                        aria-selected={paperTerminalTab === tab}
                        className={paperTerminalTab === tab ? "active" : ""}
                        onClick={() => setPaperTerminalTab(tab)}
                      >{label}</button>
                    ))}
                  </div>
                  <div className="paper-terminal-tabpanel" role="tabpanel">
                    {paperTerminalTab === "POSITIONS" ? (
                      activePaperPosition ? (
                        <div className="paper-terminal-position-row">
                          <div className="paper-terminal-position-heading">
                            <span className={`paper-history-direction ${activePaperPosition.direction.toLowerCase()}`}>{activePaperPosition.direction}</span>
                            <strong>{activePaperPosition.symbol}</strong>
                            <small>{activePaperPosition.provider.toUpperCase()} · {activePaperPosition.leverage}× · Isolated</small>
                          </div>
                          <div><span>Entry</span><strong>{formatPrice(activePaperPosition.entry)}</strong></div>
                          <div><span>Mark</span><strong>{formatPrice(paperMarkPrice)}</strong></div>
                          <div className={paperOutcomeClass}><span>Unrealized · gross</span><strong>{paperUnrealizedPnl === null ? "—" : formatSignedMoney(paperUnrealizedPnl)}</strong></div>
                          <div><span>Est. net close</span><strong className={paperEstimatedNetClosePnl !== null && paperEstimatedNetClosePnl >= 0 ? "positive" : "negative"}>{paperEstimatedNetClosePnl === null ? "—" : formatSignedMoney(paperEstimatedNetClosePnl)}</strong></div>
                          <button className="paper-terminal-close" type="button" disabled={!paperBookIsFresh || activePaperPosition.provider !== provider || activePaperPosition.symbol !== symbol} onClick={closePaperPositionAtMark}>Close at live depth</button>
                        </div>
                      ) : (
                        <p className="paper-history-empty">No open demo positions.</p>
                      )
                    ) : paperTerminalTab === "OPEN_ORDERS" ? (
                      paperPortfolio.pendingOrder ? (
                        <div className="paper-terminal-position-row">
                          <div className="paper-terminal-position-heading">
                            <span className={`paper-history-direction ${paperPortfolio.pendingOrder.direction.toLowerCase()}`}>LIMIT · {paperPortfolio.pendingOrder.direction}</span>
                            <strong>{paperPortfolio.pendingOrder.symbol}</strong>
                            <small>{paperPortfolio.pendingOrder.provider.toUpperCase()} · placed {new Date(paperPortfolio.pendingOrder.placedAtTime * 1000).toLocaleString()}</small>
                          </div>
                          <div><span>Limit price</span><strong>{formatPrice(paperPortfolio.pendingOrder.limitPrice)}</strong></div>
                          <div><span>Reserved margin</span><strong>{formatMoney(paperPortfolio.pendingOrder.margin)}</strong></div>
                          <div><span>Stop / target</span><strong>{formatPrice(paperPortfolio.pendingOrder.stop)} / {formatPrice(paperPortfolio.pendingOrder.target)}</strong></div>
                          <button className="paper-terminal-close" type="button" onClick={cancelPendingPaperOrder}>Cancel order</button>
                        </div>
                      ) : (
                        <p className="paper-history-empty">No pending demo orders.</p>
                      )
                    ) : (
                      <div className="paper-history-content">
                        {paperPortfolio.history.length > 0 ? (
                          <>
                            <div className="paper-history-stats">
                              <div><span>Net realized P&amp;L</span><strong className={paperHistoryNetPnl >= 0 ? "positive" : "negative"}>{formatSignedMoney(paperHistoryNetPnl)}</strong></div>
                              <div><span>Win rate</span><strong>{paperHistoryWinRate.toFixed(1)}%</strong></div>
                              <div><span>Winning trades</span><strong>{paperHistoryWins} / {paperPortfolio.history.length}</strong></div>
                            </div>
                            <div className="paper-history-filters" role="group" aria-label="Filter trade history">
                              {(["ALL", "WINS", "LOSSES"] as const).map((filter) => (
                                <button type="button" key={filter} className={paperHistoryFilter === filter ? "active" : ""} aria-pressed={paperHistoryFilter === filter} onClick={() => setPaperHistoryFilter(filter)}>
                                  {filter === "ALL" ? "All trades" : filter === "WINS" ? "Winners" : "Losers"}
                                </button>
                              ))}
                            </div>
                            <div className="paper-history-list">
                              {visiblePaperHistory.length > 0 ? visiblePaperHistory.map((trade) => (
                                <article className="paper-history-trade" key={trade.id}>
                                  <div className="paper-history-trade-heading">
                                    <div className="paper-history-instrument">
                                      <span className={`paper-history-direction ${trade.direction.toLowerCase()}`}>{trade.direction}</span>
                                      <strong>{trade.symbol}</strong>
                                      <small>{trade.provider.toUpperCase()} · {new Date(trade.closedAtTime * 1000).toLocaleString()}</small>
                                    </div>
                                    <div className={`paper-history-result ${trade.pnl >= 0 ? "positive" : "negative"}`}>
                                      <strong>{formatSignedMoney(trade.pnl)}</strong>
                                      <small>{formatSignedPercent(trade.margin > 0 ? (trade.pnl / trade.margin) * 100 : 0)} on margin</small>
                                    </div>
                                  </div>
                                  <div className="paper-history-trade-levels">
                                    <div><span>Entry</span><strong>{formatPrice(trade.entry)}</strong></div>
                                    <div><span>Exit</span><strong>{formatPrice(trade.exitPrice)}</strong></div>
                                    <div><span>Size · leverage</span><strong>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} · {trade.leverage}×</strong></div>
                                    <div><span>Close reason</span><strong>{trade.reason}</strong></div>
                                  </div>
                                  <div className="paper-history-trade-footer">
                                    <span>Closed {new Date(trade.closedAtTime * 1000).toLocaleString()}</span>
                                    <button type="button" onClick={() => downloadPaperPnlCard(trade)} aria-label={`Download P and L card for ${trade.direction} ${trade.symbol}`}><Download size={13} aria-hidden="true" /> Download P&amp;L card</button>
                                  </div>
                                </article>
                              )) : <p className="paper-history-empty">No {paperHistoryFilter === "WINS" ? "winning" : "losing"} trades yet.</p>}
                            </div>
                          </>
                        ) : <p className="paper-history-empty">Closed demo trades will appear here.</p>}
                      </div>
                    )}
                  </div>
                </section>
              )}

              <section className="copy-trading" aria-labelledby="copy-trading-title">
                <div className="copy-heading">
                  <span className="copy-icon"><Users size={15} aria-hidden="true" /></span>
                  <span>
                    <strong id="copy-trading-title">Demo copy trading</strong>
                    <small><Radio size={10} aria-hidden="true" /> {copyStatus}</small>
                  </span>
                </div>
                <p className="copy-description">
                  Follow public demo traders. New LONG/SHORT entries and exits mirror into your own simulated account at your selected risk scale; an already-open trade is not joined mid-way.
                </p>
                <p className="copy-storage-note">
                  {copySnapshot?.storageMode === "persistent"
                    ? "Persistent shared room · updates while the app is open"
                    : copySnapshot?.storageMode === "local-memory"
                      ? "Local shared room · same server only; server restart clears trader profiles"
                      : "Connecting to shared storage…"}
                </p>
                <div className="copy-profile-form">
                  <label>
                    Your trader name
                    <input
                      maxLength={24}
                      value={copyNameDraft}
                      onChange={(event) => setCopyNameDraft(event.target.value)}
                      placeholder="Choose a name"
                    />
                  </label>
                  <label className="copy-share-toggle">
                    <input
                      type="checkbox"
                      checked={copyShareDraft}
                      onChange={(event) => setCopyShareDraft(event.target.checked)}
                    />
                    <span>Let other users copy my demo trades</span>
                  </label>
                  <button
                    className="copy-save-button"
                    type="button"
                    disabled={copySaving || !copySnapshot}
                    onClick={() => void saveCopyProfile()}
                  >
                    {copySaving ? "Saving…" : "Save sharing settings"}
                  </button>
                </div>
                {copyError && <p className="copy-error" role="alert">{copyError}</p>}
                <div className="copy-trader-list">
                  <div className="copy-list-heading">
                    <strong>Traders to copy</strong>
                    <span>{copySnapshot?.traders.filter((trader) =>
                      trader.id !== copySnapshot.me.id &&
                      (trader.isPublic || copySnapshot.follows.some((follow) => follow.traderId === trader.id)),
                    ).length ?? 0} available</span>
                  </div>
                  {copySnapshot ? (
                    copySnapshot.traders
                      .filter((trader) =>
                        trader.id !== copySnapshot.me.id &&
                        (trader.isPublic || copySnapshot.follows.some((follow) => follow.traderId === trader.id)),
                      )
                      .map((trader) => {
                        const follow = copySnapshot.follows.find((item) => item.traderId === trader.id);
                        const copyScale = copyScaleDrafts[trader.id] ?? follow?.copyScale ?? 100;
                        return (
                          <article className="copy-trader-card" key={trader.id}>
                            <div className="copy-trader-topline">
                              <div>
                                <strong>{trader.displayName}</strong>
                                <small>{trader.totalTrades} closed demo trades · {formatMoney(trader.realizedPnl)} realized</small>
                              </div>
                              <span className={trader.currentTrade ? "copy-live-tag active" : "copy-live-tag"}>
                                {trader.currentTrade ? "IN TRADE" : "FLAT"}
                              </span>
                            </div>
                            {trader.currentTrade && (
                              <div className={`copy-current-trade ${trader.currentTrade.position.direction.toLowerCase()}`}>
                                <b>{trader.currentTrade.position.direction}</b>
                                <span>{trader.currentTrade.position.symbol} · {trader.currentTrade.position.interval}</span>
                                <small>Entry {formatPrice(trader.currentTrade.position.entry)}</small>
                              </div>
                            )}
                            <div className="copy-trader-actions">
                              <label>
                                Copy size
                                <select
                                  value={copyScale}
                                  onChange={(event) => {
                                    const nextScale = Number(event.target.value);
                                    setCopyScaleDrafts((current) => ({ ...current, [trader.id]: nextScale }));
                                    if (follow?.enabled)
                                      void updateCopyFollow(trader, true, nextScale);
                                  }}
                                  aria-label={`Copy size for ${trader.displayName}`}
                                >
                                  {[50, 75, 100, 150, 200].map((scale) => <option value={scale} key={scale}>{scale}% of their risk</option>)}
                                </select>
                              </label>
                              <button
                                className={follow?.enabled ? "copy-follow-button following" : "copy-follow-button"}
                                type="button"
                                disabled={copySaving}
                                onClick={() => void updateCopyFollow(trader, !follow?.enabled, copyScale)}
                              >
                                <Copy size={12} aria-hidden="true" />
                                {follow?.enabled ? "Pause" : follow ? "Resume" : "Copy trader"}
                              </button>
                            </div>
                          </article>
                        );
                      })
                  ) : (
                    <p className="copy-empty">Connecting to the shared demo room…</p>
                  )}
                  {copySnapshot && !copySnapshot.traders.some((trader) => trader.id !== copySnapshot.me.id && (trader.isPublic || copySnapshot.follows.some((follow) => follow.traderId === trader.id))) && (
                    <p className="copy-empty">No demo traders are sharing yet. Share your own demo trades to appear here.</p>
                  )}
                </div>
                <p className="copy-disclaimer">Simulation only. Copying runs while this app is open, uses your demo balance, and never sends orders to an exchange.</p>
              </section>

              {!paperFullscreen && <details className="paper-history">
                <summary>
                  <span className="paper-history-summary-title">
                    <strong>Trade history</strong>
                    <small>{paperPortfolio.history.length} closed</small>
                  </span>
                  <span className="paper-history-summary-total">
                    <small>Realized P&amp;L</small>
                    <strong className={paperHistoryNetPnl >= 0 ? "positive" : "negative"}>
                      {formatSignedMoney(paperHistoryNetPnl)}
                    </strong>
                  </span>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                {paperPortfolio.history.length > 0 ? (
                  <div className="paper-history-content">
                    <div className="paper-history-stats">
                      <div><span>Net realized P&amp;L</span><strong className={paperHistoryNetPnl >= 0 ? "positive" : "negative"}>{formatSignedMoney(paperHistoryNetPnl)}</strong></div>
                      <div><span>Win rate</span><strong>{paperHistoryWinRate.toFixed(1)}%</strong></div>
                      <div><span>Winning trades</span><strong>{paperHistoryWins} / {paperPortfolio.history.length}</strong></div>
                    </div>
                    <div className="paper-history-filters" role="group" aria-label="Filter trade history">
                      {(["ALL", "WINS", "LOSSES"] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          className={paperHistoryFilter === filter ? "active" : ""}
                          aria-pressed={paperHistoryFilter === filter}
                          onClick={() => setPaperHistoryFilter(filter)}
                        >
                          {filter === "ALL" ? "All trades" : filter === "WINS" ? "Winners" : "Losers"}
                        </button>
                      ))}
                    </div>
                    <div className="paper-history-list">
                      {visiblePaperHistory.length > 0 ? visiblePaperHistory.map((trade) => (
                        <article className="paper-history-trade" key={trade.id}>
                          <div className="paper-history-trade-heading">
                            <div className="paper-history-instrument">
                              <span className={`paper-history-direction ${trade.direction.toLowerCase()}`}>{trade.direction}</span>
                              <strong>{trade.symbol}</strong>
                              <small>{trade.provider.toUpperCase()} · {new Date(trade.closedAtTime * 1000).toLocaleString()}</small>
                            </div>
                            <div className={`paper-history-result ${trade.pnl >= 0 ? "positive" : "negative"}`}>
                              <strong>{formatSignedMoney(trade.pnl)}</strong>
                              <small>{formatSignedPercent(trade.margin > 0 ? (trade.pnl / trade.margin) * 100 : 0)} on margin</small>
                            </div>
                          </div>
                          <div className="paper-history-trade-levels">
                            <div><span>Entry</span><strong>{formatPrice(trade.entry)}</strong></div>
                            <div><span>Exit</span><strong>{formatPrice(trade.exitPrice)}</strong></div>
                            <div><span>Size · leverage</span><strong>{trade.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} · {trade.leverage}×</strong></div>
                            <div><span>Close reason</span><strong>{trade.reason}</strong></div>
                          </div>
                          <div className="paper-history-trade-footer">
                            <span>Closed {new Date(trade.closedAtTime * 1000).toLocaleString()}</span>
                            <button type="button" onClick={() => downloadPaperPnlCard(trade)} aria-label={`Download P and L card for ${trade.direction} ${trade.symbol}`}>
                              <Download size={13} aria-hidden="true" /> Download P&amp;L card
                            </button>
                          </div>
                        </article>
                      )) : (
                        <p className="paper-history-empty">No {paperHistoryFilter === "WINS" ? "winning" : "losing"} trades yet.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="paper-history-empty">Closed demo trades will appear here with their realized P&amp;L and downloadable cards.</p>
                )}
              </details>}
            </section>
                )}
                <div className="paper-dock-bar" aria-label="Demo trading controls">
                  <div className="paper-dock-summary">
                    <span className="paper-icon"><Wallet size={15} aria-hidden="true" /></span>
                    <span className="paper-dock-copy">
                      <strong>Demo</strong>
                      <small title={activePaperPosition ? `${activePaperPosition.direction} · ${activePaperPosition.symbol}` : paperPortfolio.pendingOrder ? `${paperPortfolio.pendingOrder.direction} LIMIT · ${paperPortfolio.pendingOrder.symbol}` : symbol}>
                        {activePaperPosition
                          ? `OPEN ${activePaperPosition.direction} · ${activePaperPosition.symbol}`
                          : paperPortfolio.pendingOrder
                            ? `PENDING ${paperPortfolio.pendingOrder.direction} LIMIT · ${paperPortfolio.pendingOrder.symbol}`
                            : `${symbol} · ${formatMoney(paperPortfolio.balance)}`}
                      </small>
                      {activePaperPosition && paperUnrealizedPnl !== null && paperUnrealizedReturn !== null && (
                        <small className={`paper-dock-pnl ${paperOutcomeClass}`}>
                          {formatSignedMoney(paperUnrealizedPnl)} · {formatSignedPercent(paperUnrealizedReturn)}
                        </small>
                      )}
                    </span>
                  </div>
                  <label className="paper-dock-leverage">
                    <span>LEV</span>
                    <select
                      aria-label="Demo leverage"
                      value={paperLeverage}
                      onChange={(event) => setPaperLeverage(event.target.value)}
                      disabled={Boolean(activePaperPosition || paperPortfolio.pendingOrder)}
                    >
                      {[1, 2, 3, 5, 10, 20, 50].map((leverage) => (
                        <option value={leverage} key={leverage}>{leverage}×</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="paper-dock-action long"
                    type="button"
                    disabled={!canSubmitPaperDirection("LONG")}
                    title={activePaperPosition
                      ? activePaperPosition.direction === "LONG"
                        ? "A LONG position is already open"
                        : canSubmitPaperDirection("LONG")
                          ? "Close the SHORT and open a LONG against live asks and bids"
                          : "Switch to Market to reverse, or manage the existing position first"
                      : paperPortfolio.pendingOrder
                        ? "Cancel the pending order first"
                        : "Open a LONG demo position against live asks and depth"}
                    aria-label={activePaperPosition?.direction === "SHORT" && canSubmitPaperDirection("LONG")
                      ? "Close SHORT and open LONG against live order-book depth"
                      : "Open LONG demo position"}
                    onClick={() => openPaperPosition("LONG")}
                  ><ArrowUpRight size={14} aria-hidden="true" /><span>LONG</span></button>
                  <button
                    className="paper-dock-action short"
                    type="button"
                    disabled={!canSubmitPaperDirection("SHORT")}
                    title={activePaperPosition
                      ? activePaperPosition.direction === "SHORT"
                        ? "A SHORT position is already open"
                        : canSubmitPaperDirection("SHORT")
                          ? "Close the LONG and open a SHORT against live bids and asks"
                          : "Switch to Market to reverse, or manage the existing position first"
                      : paperPortfolio.pendingOrder
                        ? "Cancel the pending order first"
                        : "Open a SHORT demo position against live bids and depth"}
                    aria-label={activePaperPosition?.direction === "LONG" && canSubmitPaperDirection("SHORT")
                      ? "Close LONG and open SHORT against live order-book depth"
                      : "Open SHORT demo position"}
                    onClick={() => openPaperPosition("SHORT")}
                  ><ArrowDownRight size={14} aria-hidden="true" /><span>SHORT</span></button>
                  <button
                    className={`paper-dock-expand${paperDockExpanded ? " expanded" : ""}`}
                    type="button"
                    aria-label={paperDockExpanded ? "Collapse demo trading details" : "Expand demo trading details"}
                    aria-expanded={paperDockExpanded}
                    aria-controls="paper-dock-panel"
                    onClick={() => setPaperDockExpanded((expanded) => !expanded)}
                  ><ChevronDown size={16} aria-hidden="true" /></button>
                </div>
              </div>,
              document.body,
            )}
            <p className="smallprint">
              Signals use completed candles and transparent trend, structure,
              momentum, and ATR rules. Gemini is only used for optional explanations.
            </p>
          </div>
        </aside>
      </main>
      <footer>
        <span>CHART AI · Phase 1</span>
        <span>
          Charts powered by{" "}
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            TradingView Lightweight Charts™
          </a>{" "}
          · Market data: Binance / Bybit / OKX / Aster / Hyperliquid / MEXC · No
          financial advice
        </span>
      </footer>
      {signalModal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSignalModal(false);
          }}
        >
          <div
            className="risk-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="risk-title"
          >
            <button
              className="modal-close"
              aria-label="Close signal warning"
              onClick={() => setSignalModal(false)}
            >
              <X size={17} />
            </button>
            <div className="risk-icon">
              <ShieldAlert size={22} />
            </div>
            <h3 id="risk-title">Before reviewing a signal</h3>
            <p>
              These rule-based chart scenarios are educational only and are{" "}
              <strong>not financial advice</strong>. They can be inaccurate,
              incomplete, delayed, or entirely wrong.
            </p>
            <p>
              You are solely responsible for any decision, loss, or risk from
              following a generated setup. Nothing here executes a trade.
            </p>
            <label className="risk-check">
              <input
                type="checkbox"
                checked={riskAcknowledged}
                onChange={(e) => setRiskAcknowledged(e.target.checked)}
              />
              <span>
                I understand that I use this signal entirely at my own risk.
              </span>
            </label>
            <div className="modal-actions">
              <button
                className="cancel-signal"
                onClick={() => setSignalModal(false)}
              >
                Cancel
              </button>
              <button
                className="confirm-signal"
                disabled={!riskAcknowledged}
                onClick={generateSignal}
              >
                <Activity size={15} /> I understand — review
              </button>
            </div>
          </div>
        </div>
      )}
      {infoDetail && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInfoDetail(null);
          }}
        >
          <div
            className="info-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="indicator-info-title"
          >
            <button
              className="modal-close"
              aria-label="Close indicator explanation"
              onClick={() => setInfoDetail(null)}
            >
              <X size={17} />
            </button>
            <div className="info-icon">
              <CircleHelp size={22} />
            </div>
            <div className="eyebrow">INDICATOR EXPLAINER</div>
            <h3 id="indicator-info-title">{infoDetail.title}</h3>
            <p>{infoDetail.description}</p>
            {infoDetail.facts?.length ? (
              <ul>
                {infoDetail.facts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
            ) : null}
            <button className="info-done" onClick={() => setInfoDetail(null)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
