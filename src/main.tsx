import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  RefreshCcw,
  ScanLine,
  Layers,
  ChevronRight,
  SlidersHorizontal,
  GitBranch,
  Settings2,
  Search,
  Sparkles,
  ShieldAlert,
  X,
  CircleHelp,
  MessageSquareText,
  Send,
  Trash2,
} from "lucide-react";
import { analyze, type Analysis, type Candle, type Level } from "./analysis";
import "./style.css";
const intervals = ["5m", "15m", "1h", "4h", "1d", "1w"];
const exchanges = [
  { id: "binance", name: "Binance Spot" },
  { id: "bybit", name: "Bybit Linear" },
  { id: "okx", name: "OKX Spot" },
  { id: "aster", name: "Aster Perpetual" },
  { id: "hyperliquid", name: "Hyperliquid Perps" },
  { id: "mexc", name: "MEXC Spot" },
];
type Market = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  apiSymbol?: string;
  provider?: string;
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
type InfoDetail = { title: string; description: string; facts?: string[] };
type AiProvider = "gemini" | "venice";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: AiProvider;
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
      "Retracement levels are measured between the most recent significant swing extremes. They are reference areas where reactions may occur, not guaranteed support or resistance.",
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
  const [provider, setProvider] = useState("mexc");
  const [reload, setReload] = useState(0);
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalValue] = useState("4h");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
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
  const [concepts, setConcepts] = useState<Record<ConceptKey, boolean>>({
    fibonacci: false,
    fairValueGaps: false,
    orderBlocks: false,
    structure: false,
  });
  const [conceptMenu, setConceptMenu] = useState(false);
  const [conceptRects, setConceptRects] = useState<ConceptRect[]>([]);
  const [fibLines, setFibLines] = useState<FibLineRect[]>([]);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [signalModal, setSignalModal] = useState(false);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [signalLoading, setSignalLoading] = useState(false);
  const [signalText, setSignalText] = useState("");
  const [signalError, setSignalError] = useState("");
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
  const candlesRef = useRef<Candle[]>([]);
  const marketsRef = useRef<Market[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const zoneDragRef = useRef<{
    pointerId: number;
    key: string;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressZoneClickRef = useRef(false);
  const analysis = useMemo(() => {
    try {
      return candles.length ? analyze(candles) : null;
    } catch {
      return null;
    }
  }, [candles]);
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
  const selectedMarket = useMemo(
    () =>
      markets.find(
        (market) => market.provider === provider && market.symbol === symbol,
      ),
    [markets, provider, symbol],
  );
  const marketMatches = useMemo(() => {
    const query = marketQuery.trim().toUpperCase();
    return (
      query
        ? markets.filter((market) =>
            `${market.symbol} ${market.baseAsset}/${market.quoteAsset}`
              .toUpperCase()
              .includes(query),
          )
        : markets
    ).slice(0, 120);
  }, [markets, marketQuery]);
  useEffect(() => {
    setLevelOverrides({});
    setDraggingLevelKey(null);
    zoneDragRef.current = null;
  }, [provider, symbol, interval]);
  useEffect(() => {
    marketsRef.current = markets;
  }, [markets]);
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
    setMarketsLoading(true);
    setMarkets([]);
    setMarketQuery("");
    setMarketMenu(false);
    fetch("/api/markets?provider=all")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Markets unavailable");
        return body.markets as Market[];
      })
      .then((next) => {
        if (!cancelled) {
          setMarkets(next);
          setMarketsLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setMarketsLoading(false);
          setError(e instanceof Error ? e.message : "Failed to load markets");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const available = markets.filter((market) => market.provider === provider);
    if (markets.length && !available.length) {
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
  }, [markets, provider, symbol]);
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
    return () => {
      levelPriceLinesRef.current = [];
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
    let retry: number | undefined;
    let heartbeat: number | undefined;
    setLoading(true);
    setError("");
    setLive(false);
    setCandles([]);
    candlesRef.current = [];
    setAiText("");
    setSignalText("");
    setSignalError("");
    async function load() {
      try {
        const response = await fetch(
          `/api/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&provider=${provider}`,
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Market data unavailable");
        if (cancelled) return;
        candlesRef.current = body.candles;
        setCandles(body.candles);
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
          setError(
            e instanceof Error ? e.message : "Failed to load market data",
          );
          setLoading(false);
        }
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
      setCandles(next);
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
          retry = window.setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => ws?.close();
    }
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      window.clearInterval(heartbeat);
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
    if (showPivots)
      markers.push(
        ...analysis.pivots.slice(-8).flatMap((p) =>
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
    markersRef.current?.setMarkers(
      markers.sort((a, b) => (a.time as number) - (b.time as number)),
    );
  }, [analysis, showPivots, concepts.structure, candles]);
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const priceLine of levelPriceLinesRef.current)
      series.removePriceLine(priceLine);
    levelPriceLinesRef.current = [];
    if (!visibleLevels.length) {
      series.applyOptions({ autoscaleInfoProvider: undefined });
      return;
    }
    series.applyOptions({
      autoscaleInfoProvider: (
        original: Parameters<AutoscaleInfoProvider>[0],
      ) => {
        const info = original();
        if (!info || !info.priceRange) return info;
        const selectedPrices = visibleLevels.map((level) => level.price);
        const minValue = Math.min(info.priceRange.minValue, ...selectedPrices);
        const maxValue = Math.max(info.priceRange.maxValue, ...selectedPrices);
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
    levelPriceLinesRef.current = visibleLevels.map((level) => {
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
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    return () => {
      for (const priceLine of levelPriceLinesRef.current)
        series.removePriceLine(priceLine);
      levelPriceLinesRef.current = [];
      series.applyOptions({ autoscaleInfoProvider: undefined });
    };
  }, [visibleLevels]);
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
      if (concepts.fibonacci && analysis.fibonacci) {
        const start = xAt(analysis.fibonacci.startIndex),
          end = xAt(analysis.fibonacci.endIndex);
        if (start !== null && end !== null) {
          const left = Math.max(0, Math.min(start, end));
          setFibLines(
            analysis.fibonacci.levels.flatMap((level) => {
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
                      name: fibName(level.ratio, analysis.fibonacci!.direction),
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
    candles,
    concepts.fibonacci,
    concepts.fairValueGaps,
    concepts.orderBlocks,
  ]);
  const current = candles.length ? candles[candles.length - 1] : null;
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
    zoneDragRef.current = {
      pointerId: event.pointerId,
      key: zone.dragKey,
      startY: event.clientY,
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
    setLevelOverrides((current) => ({
      ...current,
      [zone.dragKey]: nextPrice,
    }));
  }
  function finishLevelDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressZoneClickRef.current = drag.moved;
    zoneDragRef.current = null;
    setDraggingLevelKey(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (suppressZoneClickRef.current)
      window.setTimeout(() => {
        suppressZoneClickRef.current = false;
      }, 0);
  }
  function cancelLevelDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = zoneDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    zoneDragRef.current = null;
    suppressZoneClickRef.current = false;
    setDraggingLevelKey(null);
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
        analysis?.fibonacci
          ? `${analysis.fibonacci.direction === "bullish" ? "Bullish" : "Bearish"} swing measurement`
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
    if (market.provider) setProvider(market.provider);
    setSymbol(market.symbol);
    setMarketQuery("");
    setMarketMenu(false);
  }
  async function generateSignal() {
    if (!analysis || !riskAcknowledged) return;
    setSignalLoading(true);
    setSignalText("");
    setSignalError("");
    setSignalModal(false);
    try {
      const response = await fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval,
          provider,
          analysis,
          riskAcknowledged: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Signal unavailable");
      setSignalText(body.text);
    } catch (e) {
      setSignalError(
        e instanceof Error ? e.message : "AI signal request failed",
      );
    } finally {
      setSignalLoading(false);
      setRiskAcknowledged(false);
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
          value={provider}
          onChange={(e) => {
            const next = e.target.value,
              set = markets.filter((market) => market.provider === next),
              fallback =
                set.find((market) => market.symbol === "BTCUSDT") ||
                set.find((market) => market.symbol === "BTCUSDC") ||
                set[0];
            setProvider(next);
            if (fallback) setSymbol(fallback.symbol);
          }}
        >
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
              : `${markets.length.toLocaleString()} markets · ${new Set(markets.map((market) => market.provider)).size} exchanges`}
          </span>
          <Search size={14} />
          <input
            role="combobox"
            aria-label="Search all exchange markets"
            aria-expanded={marketMenu}
            aria-controls="market-results"
            autoComplete="off"
            disabled={marketsLoading}
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
                  No matching market across connected exchanges
                </div>
              )}
            </div>
          )}
        </div>
        <div className="times">
          {intervals.map((t) => (
            <button
              key={t}
              className={interval === t ? "active" : ""}
              onClick={() => setIntervalValue(t)}
            >
              {t}
            </button>
          ))}
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
                  </div>
                )}
              </div>
              <div className="zone-menu">
                <button
                  className={
                    showSupportZones || showResistanceZones ? "selected" : ""
                  }
                  onClick={() => {
                    setZoneMenu((v) => !v);
                    setIndicatorMenu(false);
                    setConceptMenu(false);
                  }}
                >
                  <Settings2 size={15} /> Zones{" "}
                  <span className="tool-count">{visibleLevels.length}</span>
                </button>
                {zoneMenu && (
                  <div className="zone-popover">
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
                      Drag a visible zone up or down. It stops at the next
                      detected support or resistance level.
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
                  className={`zone-rect ${zone.kind}${draggingLevelKey === zone.dragKey ? " dragging" : ""}`}
                  style={{ top: zone.top, height: zone.height }}
                  key={zone.dragKey}
                >
                  <button
                    aria-label={`Drag ${zone.kind} ${zone.rank} at ${formatPrice(zone.price)} or click for details`}
                    title="Drag vertically between adjacent levels · Click for details"
                    onPointerDown={(event) => startLevelDrag(event, zone)}
                    onPointerMove={(event) => moveLevelDrag(event, zone)}
                    onPointerUp={finishLevelDrag}
                    onPointerCancel={cancelLevelDrag}
                    onClick={(event) => handleLevelClick(event, zone)}
                  >
                    ↕ {zone.kind} {zone.rank} · {formatPrice(zone.price)} ·{" "}
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
          </div>
          {loading && <div className="floating">Loading live candles…</div>}
          {error && <div className="error">{error}</div>}
          <div className="footnote">
            Drag to pan · Scroll or pinch to zoom · SMC zones and Fibonacci
            recalculate from completed candles · Indicators update live
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
            <span className="pill">BETA</span>
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
                  {analysis?.fibonacci?.levels
                    .find((level) => level.ratio === 0.618)
                    ?.price.toFixed(analysis.last >= 10 ? 2 : 5) ?? "—"}
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
              <span>Potential bullish break</span>
              <strong>{analysis?.bullishTrigger?.toFixed(5) ?? "N/A"}</strong>
            </div>
            <div className="scenario">
              <span>Potential bearish break</span>
              <strong>{analysis?.bearishTrigger?.toFixed(5) ?? "N/A"}</strong>
            </div>
            <div className="separator" />
            <div className="action-grid">
              <button
                className="analyze"
                disabled={!analysis || aiLoading}
                onClick={askAi}
              >
                <BrainCircuit size={16} />
                {aiLoading ? "Analysing…" : "Explain chart"}
              </button>
              <button
                className="generate-signal"
                disabled={!analysis || signalLoading}
                onClick={() => setSignalModal(true)}
              >
                <Sparkles size={16} />
                {signalLoading ? "Generating…" : "Generate signal"}
              </button>
            </div>
            {aiText && <div className="insights">{aiText}</div>}
            {signalError && <div className="signal-error">{signalError}</div>}
            {signalText && (
              <div className="signal-output">
                <div>
                  <ShieldAlert size={15} /> EDUCATIONAL SIGNAL · NFA
                </div>
                {signalText}
              </div>
            )}
            <p className="signal-warning">
              <ShieldAlert size={13} /> AI signals are not financial advice.
              They may be wrong and are followed entirely at your own risk.
            </p>
            <p className="smallprint">
              Rule-based SMC, Fibonacci and indicator analysis uses completed
              candles and cannot guarantee future market movements.
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
            <h3 id="risk-title">Before generating a signal</h3>
            <p>
              AI-generated market signals are educational only and are{" "}
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
                <Sparkles size={15} /> I understand — generate
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
createRoot(document.getElementById("root")!).render(<App />);
