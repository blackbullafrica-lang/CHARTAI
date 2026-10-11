export type PaperDirection = "LONG" | "SHORT";
export type PaperDirectionMode = "auto" | "long" | "short";

export type PaperPosition = {
  id: string;
  direction: PaperDirection;
  provider: string;
  symbol: string;
  interval: string;
  openedAtTime: number;
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  leverage: number;
  margin: number;
  liquidationPrice: number;
  riskAmount: number;
  feeRate: number;
  markPrice: number;
  copiedFrom?: {
    traderId: string;
    traderName: string;
    positionId: string;
  };
};

export type PaperPendingOrder = {
  id: string;
  direction: PaperDirection;
  provider: string;
  symbol: string;
  interval: string;
  placedAtTime: number;
  limitPrice: number;
  stop: number;
  target: number;
  quantity: number;
  leverage: number;
  margin: number;
  maintenanceMarginPercent: number;
  liquidationPrice: number;
  riskAmount: number;
  feeRate: number;
};

export type PaperClosedTrade = PaperPosition & {
  exitPrice: number;
  pnl: number;
  closedAtTime: number;
  reason: "Stop hit" | "Target hit" | "Estimated liquidation" | "Closed manually";
};

export type PaperPortfolio = {
  balance: number;
  openPosition: PaperPosition | null;
  pendingOrder: PaperPendingOrder | null;
  history: PaperClosedTrade[];
};

export type PaperSetup = {
  direction: PaperDirection;
  entry: number;
  stop: number;
  target: number;
  riskPercent: number;
  leverage: number;
  maintenanceMarginPercent: number;
  feePercent: number;
  balance: number;
};

export type PaperQuote = {
  quantity: number;
  notional: number;
  margin: number;
  riskBudget: number;
  stopLoss: number;
  targetProfit: number;
  rewardRisk: number;
  liquidationPrice: number;
  isLeverageCapped: boolean;
  feeRate: number;
};

export type PaperBookLevel = { price: number; size: number };

export type PaperBookFill = {
  averagePrice: number;
  filledQuantity: number;
  quoteNotional: number;
  complete: boolean;
};

export const PAPER_INITIAL_BALANCE = 10_000;
export const PAPER_STORAGE_KEY = "chart-ai.paper-trading.v1";

export function estimatePaperBookFill(
  levels: PaperBookLevel[],
  quantity: number,
  limitPrice?: number,
  side: "buy" | "sell" = "buy",
): PaperBookFill {
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { averagePrice: 0, filledQuantity: 0, quoteNotional: 0, complete: false };
  let remaining = quantity;
  let filledQuantity = 0;
  let quoteNotional = 0;
  for (const level of levels) {
    if (!Number.isFinite(level.price) || level.price <= 0 || !Number.isFinite(level.size) || level.size <= 0)
      continue;
    if (limitPrice !== undefined && (
      (side === "buy" && level.price > limitPrice) ||
      (side === "sell" && level.price < limitPrice)
    )) break;
    const filledAtLevel = Math.min(remaining, level.size);
    filledQuantity += filledAtLevel;
    quoteNotional += filledAtLevel * level.price;
    remaining -= filledAtLevel;
    if (remaining <= Math.max(quantity * 1e-10, 1e-12)) break;
  }
  const complete = remaining <= Math.max(quantity * 1e-8, 1e-10);
  return {
    averagePrice: filledQuantity > 0 ? quoteNotional / filledQuantity : 0,
    filledQuantity,
    quoteNotional,
    complete,
  };
}

export function estimatePaperLiquidationPrice(
  entry: number,
  direction: PaperDirection,
  leverage: number,
  maintenanceMarginPercent: number,
  feeRate = 0,
): number {
  const maintenanceRate = maintenanceMarginPercent / 100;
  const price = direction === "LONG"
    ? entry * (1 - 1 / leverage + feeRate) / (1 - maintenanceRate - feeRate)
    : entry * (1 + 1 / leverage - feeRate) / (1 + maintenanceRate + feeRate);
  return Math.max(0, price);
}

export function createPaperPortfolio(): PaperPortfolio {
  return { balance: PAPER_INITIAL_BALANCE, openPosition: null, pendingOrder: null, history: [] };
}

export function readPaperPortfolio(): PaperPortfolio {
  try {
    const saved: unknown = JSON.parse(
      window.localStorage.getItem(PAPER_STORAGE_KEY) ?? "null",
    );
    if (!saved || typeof saved !== "object") return createPaperPortfolio();
    const candidate = saved as Partial<PaperPortfolio>;
    if (
      typeof candidate.balance !== "number" ||
      !Number.isFinite(candidate.balance) ||
      candidate.balance <= 0
    ) return createPaperPortfolio();
    const pending = candidate.pendingOrder;
    const validPending = !candidate.openPosition && pending &&
      (pending.direction === "LONG" || pending.direction === "SHORT") &&
      typeof pending.provider === "string" &&
      typeof pending.symbol === "string" &&
      typeof pending.interval === "string" &&
      [
        pending.placedAtTime,
        pending.limitPrice,
        pending.stop,
        pending.target,
        pending.quantity,
        pending.leverage,
        pending.margin,
        pending.maintenanceMarginPercent,
        pending.liquidationPrice,
        pending.riskAmount,
        pending.feeRate,
      ].every((value) => typeof value === "number" && Number.isFinite(value)) &&
      pending.limitPrice > 0 && pending.quantity > 0 && pending.leverage >= 1;
    return {
      balance: candidate.balance,
      openPosition:
        candidate.openPosition &&
        typeof candidate.openPosition.entry === "number" &&
        Number.isFinite(candidate.openPosition.entry) &&
        (candidate.openPosition.direction === "LONG" ||
          candidate.openPosition.direction === "SHORT")
          ? candidate.openPosition
          : null,
      pendingOrder: validPending ? pending : null,
      history: Array.isArray(candidate.history)
        ? candidate.history.slice(0, 500)
        : [],
    };
  } catch {
    return createPaperPortfolio();
  }
}

export function calculatePaperQuote(setup: PaperSetup): {
  quote: PaperQuote | null;
  error: string;
} {
  const { direction, entry, stop, target, riskPercent, leverage } = setup;
  const maintenanceMarginRate = setup.maintenanceMarginPercent / 100;
  const feeRate = setup.feePercent / 100;
  if (![entry, stop, target, riskPercent, leverage, setup.balance].every(Number.isFinite))
    return { quote: null, error: "Enter valid numbers for the trade setup." };
  if (entry <= 0 || stop <= 0 || target <= 0 || setup.balance <= 0)
    return { quote: null, error: "Prices and demo balance must be above zero." };
  if (riskPercent < 0.1 || riskPercent > 5)
    return { quote: null, error: "Risk per trade must be between 0.1% and 5%." };
  if (leverage < 1 || leverage > 50)
    return { quote: null, error: "Leverage must be between 1× and 50×." };
  if (
    maintenanceMarginRate <= 0 ||
    maintenanceMarginRate >= 1 / leverage ||
    setup.feePercent < 0 ||
    setup.feePercent > 1
  ) return { quote: null, error: "Check the maintenance margin and fee assumptions." };

  const isLong = direction === "LONG";
  if (isLong ? stop >= entry || target <= entry : stop <= entry || target >= entry)
    return {
      quote: null,
      error: `For a ${direction}, the stop and target must be on the correct sides of entry.`,
    };

  const riskBudget = setup.balance * riskPercent / 100;
  const riskPerUnit = Math.abs(entry - stop);
  const riskSizedQuantity =
    riskBudget / (riskPerUnit + (entry + stop) * feeRate);
  const leverageCappedQuantity = setup.balance * leverage / entry;
  const quantity = Math.min(riskSizedQuantity, leverageCappedQuantity);
  const notional = quantity * entry;
  const margin = notional / leverage;
  const stopFees = quantity * (entry + stop) * feeRate;
  const targetFees = quantity * (entry + target) * feeRate;
  const grossStopLoss = riskPerUnit * quantity;
  const grossTargetProfit = Math.abs(target - entry) * quantity;
  const stopLoss = grossStopLoss + stopFees;
  const targetProfit = grossTargetProfit - targetFees;
  const liquidationPrice = estimatePaperLiquidationPrice(
    entry,
    direction,
    leverage,
    setup.maintenanceMarginPercent,
    feeRate,
  );
  if (isLong ? liquidationPrice >= stop : liquidationPrice <= stop)
    return {
      quote: null,
      error: "The estimated liquidation level is reached before your stop. Reduce leverage or move the stop closer to entry.",
    };
  if (targetProfit <= 0)
    return { quote: null, error: "Estimated fees exceed the potential target profit." };

  return {
    quote: {
      quantity,
      notional,
      margin,
      riskBudget,
      stopLoss,
      targetProfit,
      rewardRisk: targetProfit / stopLoss,
      liquidationPrice,
      isLeverageCapped: leverageCappedQuantity < riskSizedQuantity,
      feeRate,
    },
    error: "",
  };
}

export function paperPositionPnl(
  position: PaperPosition,
  exitPrice: number,
): number {
  const grossPnl = paperGrossPositionPnl(position, exitPrice);
  const feeRate = Number.isFinite(position.feeRate) && position.feeRate >= 0
    ? position.feeRate
    : 0;
  const roundTripFees =
    position.quantity * (position.entry + exitPrice) * feeRate;
  return grossPnl - roundTripFees;
}

export function paperGrossPositionPnl(
  position: Pick<PaperPosition, "direction" | "entry" | "quantity">,
  markPrice: number,
): number {
  const sign = position.direction === "LONG" ? 1 : -1;
  return (markPrice - position.entry) * position.quantity * sign;
}
