import type { Analysis, Candle } from "./analysis";

export type SignalDirection = "LONG" | "SHORT" | "WAIT";
export const SIGNAL_FACTORS = [
  { id: "trend", label: "Swing trend", description: "Higher highs/lows or lower highs/lows" },
  { id: "ema", label: "EMA 20 / 50", description: "Price and fast/slow EMA alignment" },
  { id: "sma200", label: "SMA 200", description: "Longer-term price trend filter" },
  { id: "vwap", label: "Rolling VWAP", description: "Price location vs recent volume-weighted price" },
  { id: "rsi", label: "RSI 14", description: "Momentum in a directionally useful range" },
  { id: "macd", label: "MACD", description: "MACD line vs its signal line" },
  { id: "volume", label: "Volume expansion", description: "Break candle volume vs prior 20 candles" },
] as const;

export type SignalFactor = (typeof SIGNAL_FACTORS)[number]["id"];
export const DEFAULT_SIGNAL_FACTORS: SignalFactor[] = [
  "trend",
  "ema",
  "vwap",
  "rsi",
  "macd",
];

export function isSignalFactor(value: unknown): value is SignalFactor {
  return SIGNAL_FACTORS.some((factor) => factor.id === value);
}

export type RuleSignal = {
  direction: SignalDirection;
  time: number;
  summary: string;
  reasons: string[];
  entry: number | null;
  stop: number | null;
  target: number | null;
  buyTrigger: number | null;
  sellTrigger: number | null;
  rewardRisk: number | null;
  selectedFactors: SignalFactor[];
};

const emptyLevels = {
  entry: null,
  stop: null,
  target: null,
  rewardRisk: null,
};

/**
 * Produce an explainable chart setup from completed candles only.
 * A directional result requires a recent structure break plus agreement from
 * every selected confirmation factor. Otherwise the result stays WAIT.
 */
export function buildRuleSignal(
  candles: Candle[],
  analysis: Analysis,
  selectedFactors: SignalFactor[] = DEFAULT_SIGNAL_FACTORS,
): RuleSignal {
  const completed = candles.filter((candle) => candle.closed);
  const latest = completed[completed.length - 1];
  const lastIndex = completed.length - 1;
  const atr = analysis.atr;

  const swingCandles = completed.slice(-20);
  const swingHigh = swingCandles.length
    ? Math.max(...swingCandles.map((candle) => candle.high))
    : NaN;
  const swingLow = swingCandles.length
    ? Math.min(...swingCandles.map((candle) => candle.low))
    : NaN;
  const buyTrigger =
    analysis.bullishTrigger !== null && analysis.bullishTrigger > analysis.last
      ? analysis.bullishTrigger
      : Math.max(swingHigh, analysis.last + atr * 0.25);
  const sellTrigger =
    analysis.bearishTrigger !== null && analysis.bearishTrigger < analysis.last
      ? analysis.bearishTrigger
      : Math.min(swingLow, analysis.last - atr * 0.25);

  const wait = (summary: string, reasons: string[] = []): RuleSignal => ({
    direction: "WAIT",
    time: latest?.time ?? 0,
    summary,
    reasons,
    ...emptyLevels,
    buyTrigger: Number.isFinite(buyTrigger) ? buyTrigger : null,
    sellTrigger: Number.isFinite(sellTrigger) ? sellTrigger : null,
    selectedFactors: [...selectedFactors],
  });

  if (!latest || completed.length < 50) {
    return wait("Waiting for at least 50 completed candles to evaluate a setup.");
  }
  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(analysis.last)) {
    return wait("Volatility data is unavailable, so entry levels cannot be calculated safely.");
  }

  const { ema20, ema50, vwap50, rsi14, macd, macdSignal } = analysis.indicators;
  if (![ema20, ema50, vwap50, rsi14, macd, macdSignal].every(Number.isFinite)) {
    return wait("Some chart indicators are unavailable. Wait for valid market data.");
  }
  if (
    selectedFactors.includes("sma200") &&
    completed.length >= 200 &&
    !Number.isFinite(analysis.indicators.sma200)
  ) {
    return wait("SMA 200 is unavailable for this market data. Try another pair or remove that check.");
  }

  const recentEvents = analysis.smartMoney.structureEvents.filter(
    (event) => event.index >= lastIndex - 2 && event.index <= lastIndex,
  );
  const bullishBreak = [...recentEvents]
    .reverse()
    .find((event) => event.direction === "bullish");
  const bearishBreak = [...recentEvents]
    .reverse()
    .find((event) => event.direction === "bearish");

  if (selectedFactors.length < 2) {
    return wait("Choose at least two confirmation checks before looking for a directional setup.");
  }

  const recentVolumes = completed.slice(-21, -1).map((candle) => candle.volume);
  const averageRecentVolume =
    recentVolumes.reduce((sum, volume) => sum + volume, 0) /
    Math.max(recentVolumes.length, 1);
  const factorChecks: Record<
    SignalFactor,
    { bullish: boolean; bearish: boolean; bullishReason: string; bearishReason: string; waitReason: string }
  > = {
    trend: {
      bullish: analysis.trend === "Bullish",
      bearish: analysis.trend === "Bearish",
      bullishReason: "Swing structure is bullish (higher high and higher low)",
      bearishReason: "Swing structure is bearish (lower high and lower low)",
      waitReason: "Swing structure is mixed",
    },
    ema: {
      bullish: latest.close > ema20 && ema20 > ema50,
      bearish: latest.close < ema20 && ema20 < ema50,
      bullishReason: "Price and EMA 20/50 are aligned bullish",
      bearishReason: "Price and EMA 20/50 are aligned bearish",
      waitReason: "Price and EMA 20/50 are not aligned",
    },
    sma200: {
      bullish: completed.length >= 200 && latest.close > analysis.indicators.sma200,
      bearish: completed.length >= 200 && latest.close < analysis.indicators.sma200,
      bullishReason: "Price is above SMA 200",
      bearishReason: "Price is below SMA 200",
      waitReason:
        completed.length < 200
          ? `SMA 200 needs 200 completed candles (${completed.length} loaded)`
          : "Price is at SMA 200",
    },
    vwap: {
      bullish: latest.close > vwap50,
      bearish: latest.close < vwap50,
      bullishReason: "Price is above rolling VWAP 50",
      bearishReason: "Price is below rolling VWAP 50",
      waitReason: "Price is at rolling VWAP 50",
    },
    rsi: {
      bullish: rsi14 >= 52 && rsi14 <= 68,
      bearish: rsi14 >= 32 && rsi14 <= 48,
      bullishReason: `RSI 14 is bullish at ${rsi14.toFixed(1)}`,
      bearishReason: `RSI 14 is bearish at ${rsi14.toFixed(1)}`,
      waitReason: `RSI 14 at ${rsi14.toFixed(1)} is neutral or stretched`,
    },
    macd: {
      bullish: macd > macdSignal,
      bearish: macd < macdSignal,
      bullishReason: "MACD is above its signal line",
      bearishReason: "MACD is below its signal line",
      waitReason: "MACD and its signal line are equal",
    },
    volume: {
      bullish:
        averageRecentVolume > 0 &&
        latest.volume >= averageRecentVolume * 1.2 &&
        latest.close > latest.open,
      bearish:
        averageRecentVolume > 0 &&
        latest.volume >= averageRecentVolume * 1.2 &&
        latest.close < latest.open,
      bullishReason: "Bullish candle volume is at least 1.2× the prior 20-candle average",
      bearishReason: "Bearish candle volume is at least 1.2× the prior 20-candle average",
      waitReason: "The latest candle has no 1.2× directional volume expansion",
    },
  };
  const activeChecks = selectedFactors.map((factor) => ({
    factor,
    ...factorChecks[factor],
  }));
  const bullishFilters = activeChecks.every((check) => check.bullish);
  const bearishFilters = activeChecks.every((check) => check.bearish);
  const bullishReasons = activeChecks.map((check) =>
    check.bullish ? check.bullishReason : check.waitReason,
  );
  const bearishReasons = activeChecks.map((check) =>
    check.bearish ? check.bearishReason : check.waitReason,
  );

  const bullishConfirmed =
    bullishFilters &&
    bullishBreak !== undefined &&
    latest.close > bullishBreak.price &&
    latest.close - bullishBreak.price <= atr * 0.75 &&
    latest.close > latest.open;
  const bearishConfirmed =
    bearishFilters &&
    bearishBreak !== undefined &&
    latest.close < bearishBreak.price &&
    bearishBreak.price - latest.close <= atr * 0.75 &&
    latest.close < latest.open;

  if (bullishConfirmed && bearishConfirmed) {
    return wait("The chart has conflicting directional conditions. Wait for a clearer setup.");
  }

  const buildDirectionalPlan = (direction: "LONG" | "SHORT"): RuleSignal => {
    const isLong = direction === "LONG";
    const entry = latest.close;
    const nearbyLevels = analysis.levels.filter((level) =>
      isLong
        ? level.kind === "support" && level.price < entry
        : level.kind === "resistance" && level.price > entry,
    );
    const invalidationLevel = isLong
      ? nearbyLevels.sort((a, b) => b.price - a.price)[0]
      : nearbyLevels.sort((a, b) => a.price - b.price)[0];
    const atrStop = entry + (isLong ? -1.2 : 1.2) * atr;
    const structuralStop = invalidationLevel
      ? invalidationLevel.price + (isLong ? -0.15 : 0.15) * atr
      : atrStop;
    const stop = isLong
      ? Math.min(atrStop, structuralStop)
      : Math.max(atrStop, structuralStop);
    const risk = Math.abs(entry - stop);

    if (!Number.isFinite(risk) || risk < atr * 0.25 || risk > atr * 2.6) {
      return wait(
        "A confirmed break is present, but a sensible invalidation level is too close or too far away. Wait for a better entry area.",
        ["The setup is not published when its structural risk is outside the 0.25–2.6 ATR range."],
      );
    }

    const profitLevels = analysis.levels.filter((level) =>
      isLong
        ? level.kind === "resistance" && level.price > entry
        : level.kind === "support" && level.price < entry,
    );
    const nextBarrier = isLong
      ? profitLevels.sort((a, b) => a.price - b.price)[0]
      : profitLevels.sort((a, b) => b.price - a.price)[0];
    const maxTarget = entry + (isLong ? 2 : -2) * risk;
    const target = nextBarrier
      ? isLong
        ? Math.min(maxTarget, nextBarrier.price - atr * 0.05)
        : Math.max(maxTarget, nextBarrier.price + atr * 0.05)
      : maxTarget;
    const reward = (target - entry) * (isLong ? 1 : -1);
    const rewardRisk = reward / risk;

    if (reward <= 0 || !Number.isFinite(rewardRisk) || rewardRisk < 1.5) {
      return wait(
        "The breakout is confirmed, but nearby support or resistance leaves less than 1.5:1 potential reward-to-risk. Wait for more room.",
        ["The next chart barrier is used to avoid setting a target through nearby structure."],
      );
    }

    return {
      direction,
      time: latest.time,
      summary: isLong
        ? "LONG setup confirmed on a completed candle with every selected check aligned."
        : "SHORT setup confirmed on a completed candle with every selected check aligned.",
      reasons: [
        ...(isLong ? bullishReasons : bearishReasons),
        `Recent ${isLong ? "bullish" : "bearish"} ${isLong ? bullishBreak?.kind : bearishBreak?.kind} confirmed by a candle close`,
      ],
      entry,
      stop,
      target,
      buyTrigger: null,
      sellTrigger: null,
      rewardRisk,
      selectedFactors: [...selectedFactors],
    };
  };

  if (bullishConfirmed) return buildDirectionalPlan("LONG");
  if (bearishConfirmed) return buildDirectionalPlan("SHORT");

  if (bullishFilters && !bullishBreak) {
    return wait("Your selected checks align bullish, but there is no recent confirmed structure break.", [
      ...bullishReasons,
      "Wait for a completed candle to close above the long trigger before reassessing.",
    ]);
  }
  if (bearishFilters && !bearishBreak) {
    return wait("Your selected checks align bearish, but there is no recent confirmed structure break.", [
      ...bearishReasons,
      "Wait for a completed candle to close below the short trigger before reassessing.",
    ]);
  }
  if (bullishBreak && latest.close - bullishBreak.price > atr * 0.75) {
    return wait("The bullish break is already extended. Avoid chasing; wait for a pullback and a fresh confirmation.");
  }
  if (bearishBreak && bearishBreak.price - latest.close > atr * 0.75) {
    return wait("The bearish break is already extended. Avoid chasing; wait for a pullback and a fresh confirmation.");
  }
  return wait(
    `Selected checks do not fully agree (${Math.max(activeChecks.filter((check) => check.bullish).length, activeChecks.filter((check) => check.bearish).length)}/${activeChecks.length} aligned). Wait for confirmation.`,
    [
      ...activeChecks.map((check) =>
        check.bullish
          ? check.bullishReason
          : check.bearish
            ? check.bearishReason
            : check.waitReason,
      ),
      "Every selected check and a recent structure break must agree before a directional plan is shown.",
    ],
  );
}
