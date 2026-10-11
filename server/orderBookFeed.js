import protobuf from "protobufjs";
import WebSocket from "ws";

const productTypes = {
  binance: "spot",
  bybit: "linear perpetual",
  okx: "spot",
  aster: "USDT perpetual",
  hyperliquid: "perpetual",
  mexc: "spot",
};

const apiBases = {
  binance: process.env.BINANCE_API_URL || "https://data-api.binance.vision",
  bybit: process.env.BYBIT_API_URL || "https://api.bybit.com",
  okx: process.env.OKX_API_URL || "https://www.okx.com",
  aster: process.env.ASTER_API_URL || "https://fapi.asterdex.com",
  hyperliquid: process.env.HYPERLIQUID_API_URL || "https://api.hyperliquid.xyz",
  mexc: process.env.MEXC_API_URL || "https://api.mexc.com",
};

const mexcProto = protobuf.parse(`
  syntax = "proto3";
  message PublicAggreDepthV3ApiItem {
    string price = 1;
    string quantity = 2;
  }
  message PublicAggreDepthsV3Api {
    repeated PublicAggreDepthV3ApiItem asks = 1;
    repeated PublicAggreDepthV3ApiItem bids = 2;
    string eventType = 3;
    string fromVersion = 4;
    string toVersion = 5;
    int64 lastOrderCreateTime = 6;
  }
  message PushDataV3ApiWrapper {
    string channel = 1;
    PublicAggreDepthsV3Api publicAggreDepths = 313;
    optional string symbol = 3;
    optional string symbolId = 4;
    optional int64 createTime = 5;
    optional int64 sendTime = 6;
  }
`).root.lookupType("PushDataV3ApiWrapper");

const asSequence = (value) => {
  try {
    if (value === undefined || value === null || value === "") return null;
    return BigInt(value);
  } catch {
    return null;
  }
};

const rowValues = (row) => {
  if (Array.isArray(row)) return [row[0], row[1]];
  return [row?.price ?? row?.px, row?.quantity ?? row?.size ?? row?.sz];
};

const rowsToMap = (rows) => {
  const levels = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const [rawPrice, rawSize] = rowValues(row);
    const price = Number(rawPrice);
    const size = Number(rawSize);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0)
      levels.set(String(rawPrice), size);
  }
  return levels;
};

const applyRows = (levels, rows) => {
  for (const row of Array.isArray(rows) ? rows : []) {
    const [rawPrice, rawSize] = rowValues(row);
    const price = Number(rawPrice);
    const size = Number(rawSize);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size)) continue;
    const key = String(rawPrice);
    if (size <= 0) levels.delete(key);
    else levels.set(key, size);
  }
};

const sortedRows = (levels, descending) => [...levels]
  .map(([rawPrice, size]) => ({ price: Number(rawPrice), size }))
  .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.size > 0)
  .sort((left, right) => descending
    ? right.price - left.price
    : left.price - right.price);

async function fetchSnapshot(provider, symbol) {
  const base = apiBases[provider];
  let url;
  if (provider === "binance") {
    url = new URL("/api/v3/depth", base);
    url.search = new URLSearchParams({ symbol, limit: "1000" }).toString();
  } else if (provider === "aster") {
    url = new URL("/fapi/v1/depth", base);
    url.search = new URLSearchParams({ symbol, limit: "1000" }).toString();
  } else if (provider === "mexc") {
    url = new URL("/api/v3/depth", base);
    url.search = new URLSearchParams({ symbol, limit: "1000" }).toString();
  } else {
    throw new Error("This venue sends its initial order book over WebSocket.");
  }

  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(9000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${provider} depth snapshot returned ${response.status}`);
  const body = await response.json();
  if (provider === "mexc" && body.code !== undefined && Number(body.code) !== 0)
    throw new Error(body.msg || "MEXC depth snapshot unavailable");
  const snapshot = body.data && provider === "mexc" ? body.data : body;
  if (!Array.isArray(snapshot.bids) || !Array.isArray(snapshot.asks))
    throw new Error(`${provider} returned an invalid depth snapshot`);
  return {
    bids: snapshot.bids,
    asks: snapshot.asks,
    sequence: snapshot.lastUpdateId,
    exchangeTime: Number(snapshot.timestamp ?? snapshot.ts ?? snapshot.time) || Date.now(),
  };
}

function upstreamConfig(provider, symbol, market) {
  const lower = symbol.toLowerCase();
  if (provider === "binance")
    return { url: `wss://stream.binance.com:443/ws/${lower}@depth@100ms`, mode: "sequenced" };
  if (provider === "aster")
    return { url: `wss://fstream.asterdex.com/ws/${lower}@depth@100ms`, mode: "sequenced" };
  if (provider === "bybit")
    return { url: "wss://stream.bybit.com/v5/public/linear", mode: "bybit" };
  if (provider === "okx")
    return { url: "wss://ws.okx.com/ws/v5/public", mode: "okx" };
  if (provider === "hyperliquid")
    return { url: "wss://api.hyperliquid.xyz/ws", mode: "hyperliquid" };
  if (provider === "mexc")
    return { url: "wss://wbs-api.mexc.com/ws", mode: "mexc" };
  throw new Error("Unsupported order book venue");
}

export class LiveOrderBookFeed {
  constructor({ provider, symbol, market, onBook, onState }) {
    this.provider = provider;
    this.symbol = symbol;
    this.market = market;
    this.onBook = onBook;
    this.onState = onState;
    this.productType = productTypes[provider] || "spot";
    this.config = upstreamConfig(provider, symbol, market);
    this.stopped = false;
    this.socket = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.emitTimer = null;
    this.retryCount = 0;
    this.buffer = [];
    this.ready = false;
    this.awaitingFirstUpdate = false;
    this.bids = new Map();
    this.asks = new Map();
    this.sequence = null;
    this.exchangeTime = 0;
    this.lastPublishedAt = 0;
    this.needsSnapshot = this.config.mode === "sequenced" || this.config.mode === "mexc";
  }

  start() {
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.emitTimer);
    clearInterval(this.pingTimer);
    this.socket?.removeAllListeners();
    this.socket?.terminate();
    this.socket = null;
  }

  sendState(state, message = "") {
    if (this.stopped) return;
    this.onState?.({ type: "state", state, message, provider: this.provider, symbol: this.symbol });
  }

  connect() {
    if (this.stopped) return;
    this.ready = false;
    this.awaitingFirstUpdate = false;
    this.buffer = [];
    this.bids.clear();
    this.asks.clear();
    this.sequence = null;
    this.sendState(this.retryCount ? "reconnecting" : "connecting");

    const socket = new WebSocket(this.config.url, {
      handshakeTimeout: 9000,
      perMessageDeflate: false,
    });
    this.socket = socket;
    socket.on("open", () => {
      this.retryCount = 0;
      this.subscribe();
      if (this.needsSnapshot) void this.bootstrapSnapshot(socket);
      this.startHeartbeat(socket);
    });
    socket.on("message", (data, isBinary) => {
      if (socket !== this.socket || this.stopped) return;
      try {
        this.handleMessage(data, isBinary);
      } catch (error) {
        this.reconnect(error instanceof Error ? error.message : "Invalid order book update");
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (socket !== this.socket || this.stopped) return;
      clearInterval(this.pingTimer);
      this.socket = null;
      this.ready = false;
      this.sendState("reconnecting", "The exchange feed disconnected; reconnecting.");
      this.scheduleReconnect();
    });
  }

  subscribe() {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (this.config.mode === "bybit") {
      socket.send(JSON.stringify({ op: "subscribe", args: [`orderbook.50.${this.symbol}`] }));
    } else if (this.config.mode === "okx") {
      socket.send(JSON.stringify({
        op: "subscribe",
        args: [{ channel: "books", instId: this.market.apiSymbol || this.symbol.replace(/(USDT|USDC|BTC|ETH)$/, "-$1") }],
      }));
    } else if (this.config.mode === "hyperliquid") {
      socket.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: this.market.apiSymbol || this.symbol } }));
    } else if (this.config.mode === "mexc") {
      socket.send(JSON.stringify({
        method: "SUBSCRIPTION",
        params: [`spot@public.aggre.depth.v3.api.pb@100ms@${this.symbol}`],
      }));
    }
  }

  startHeartbeat(socket) {
    clearInterval(this.pingTimer);
    if (this.config.mode === "bybit") {
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: "ping" }));
      }, 20000);
    } else if (this.config.mode === "okx") {
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 20000);
    } else if (this.config.mode === "mexc") {
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "PING" }));
      }, 20000);
    } else if (this.config.mode === "hyperliquid") {
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ method: "ping" }));
      }, 30000);
    }
  }

  async bootstrapSnapshot(socket) {
    try {
      const snapshot = await fetchSnapshot(this.provider, this.symbol);
      if (this.stopped || socket !== this.socket) return;
      this.bids = rowsToMap(snapshot.bids);
      this.asks = rowsToMap(snapshot.asks);
      this.sequence = asSequence(snapshot.sequence);
      this.exchangeTime = snapshot.exchangeTime;
      this.awaitingFirstUpdate = true;
      const buffered = this.buffer;
      this.buffer = [];
      for (const update of buffered) {
        const previousSequence = this.sequence;
        if (!this.applySequenced(update, this.awaitingFirstUpdate)) {
          this.reconnect("Depth update sequence gap; rebuilding the exchange book.");
          return;
        }
        if (this.sequence !== previousSequence) this.awaitingFirstUpdate = false;
      }
      this.ready = true;
      this.publish(true);
      this.sendState("live");
    } catch (error) {
      if (this.stopped || socket !== this.socket) return;
      this.reconnect(error instanceof Error ? error.message : "Could not initialize exchange depth");
    }
  }

  decodeMessage(data, isBinary) {
    if (this.config.mode === "mexc" && isBinary) {
      const decoded = mexcProto.decode(data);
      return mexcProto.toObject(decoded, { longs: String, defaults: true });
    }
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    return JSON.parse(text);
  }

  handleMessage(data, isBinary) {
    const message = this.decodeMessage(data, isBinary);
    if (this.config.mode === "sequenced") {
      if (message.data && message.stream) this.handleSequenced(message.data);
      else this.handleSequenced(message);
    } else if (this.config.mode === "mexc") {
      const update = message.publicAggreDepths;
      if (!update) return;
      const normalized = {
        bids: update.bids || [],
        asks: update.asks || [],
        fromVersion: update.fromVersion,
        toVersion: update.toVersion,
        exchangeTime: Number(message.sendTime || update.lastOrderCreateTime || Date.now()),
      };
      if (!this.ready) this.bufferUpdate(normalized);
      else if (!this.applyLiveSequenced(normalized)) {
        this.reconnect("MEXC depth version gap; rebuilding the exchange book.");
      } else {
        this.publish();
        this.sendState("live");
      }
    } else if (this.config.mode === "bybit") {
      this.handleBybit(message);
    } else if (this.config.mode === "okx") {
      this.handleOkx(message);
    } else if (this.config.mode === "hyperliquid") {
      this.handleHyperliquid(message);
    }
  }

  handleSequenced(update) {
    if (update?.e !== "depthUpdate" || !update.bids && !update.b && !update.a && !update.asks) return;
    const normalized = {
      bids: update.bids || update.b || [],
      asks: update.asks || update.a || [],
      firstUpdateId: update.U,
      finalUpdateId: update.u,
      previousUpdateId: update.pu,
      exchangeTime: Number(update.T || update.E || Date.now()),
    };
    if (!this.ready) this.bufferUpdate(normalized);
    else if (!this.applyLiveSequenced(normalized)) {
      this.reconnect("Exchange depth sequence gap; rebuilding the local book.");
    } else {
      this.publish();
      this.sendState("live");
    }
  }

  bufferUpdate(update) {
    this.buffer.push(update);
    if (this.buffer.length > 1500)
      this.reconnect("Too many buffered depth updates; restarting synchronization.");
  }

  applySequenced(update, initializing) {
    if (this.provider === "mexc") {
      const first = asSequence(update.fromVersion);
      const last = asSequence(update.toVersion);
      if (first === null || last === null || this.sequence === null) return false;
      if (last <= this.sequence) return true;
      if (first > this.sequence + 1n) return false;
      if (!initializing && first !== this.sequence + 1n) return false;
      applyRows(this.bids, update.bids);
      applyRows(this.asks, update.asks);
      this.sequence = last;
      this.exchangeTime = update.exchangeTime || Date.now();
      return true;
    }

    const first = asSequence(update.firstUpdateId);
    const last = asSequence(update.finalUpdateId);
    if (first === null || last === null || this.sequence === null) return false;
    if (last <= this.sequence) return true;
    if (initializing) {
      if (last < this.sequence + 1n || first > this.sequence + 1n) return false;
    } else if (this.provider === "aster") {
      const previous = asSequence(update.previousUpdateId);
      if (previous === null || previous !== this.sequence) return false;
    } else if (first > this.sequence + 1n) {
      return false;
    }
    applyRows(this.bids, update.bids);
    applyRows(this.asks, update.asks);
    this.sequence = last;
    this.exchangeTime = update.exchangeTime || Date.now();
    return true;
  }

  applyLiveSequenced(update) {
    const previousSequence = this.sequence;
    const applied = this.applySequenced(update, this.awaitingFirstUpdate);
    if (applied && this.sequence !== previousSequence) this.awaitingFirstUpdate = false;
    return applied;
  }

  handleBybit(message) {
    if (message.op === "ping" || message.op === "pong" || !message.data) return;
    if (message.success === false || message.retCode && message.retCode !== 0)
      throw new Error(message.retMsg || "Bybit rejected the order book subscription");
    const data = message.data;
    if (message.type === "snapshot") {
      this.bids = rowsToMap(data.b);
      this.asks = rowsToMap(data.a);
      this.sequence = asSequence(data.u);
    } else {
      applyRows(this.bids, data.b);
      applyRows(this.asks, data.a);
      if (data.u !== undefined) this.sequence = asSequence(data.u);
    }
    this.exchangeTime = Number(message.cts || message.ts || Date.now());
    this.ready = true;
    this.publish();
    this.sendState("live");
  }

  handleOkx(message) {
    if (message.event) {
      if (message.event === "error") throw new Error(message.msg || "OKX rejected the order book subscription");
      return;
    }
    if (!Array.isArray(message.data) || !message.data.length) return;
    const data = message.data[0];
    if (message.action === "snapshot") {
      this.bids = rowsToMap(data.bids);
      this.asks = rowsToMap(data.asks);
      this.sequence = asSequence(data.seqId);
    } else if (message.action === "update") {
      const previous = asSequence(data.prevSeqId);
      const sequence = asSequence(data.seqId);
      if (sequence !== null && this.sequence !== null && sequence <= this.sequence) return;
      if (previous !== null && this.sequence !== null && previous !== this.sequence) {
        this.reconnect("OKX depth sequence gap; rebuilding the exchange book.");
        return;
      }
      applyRows(this.bids, data.bids);
      applyRows(this.asks, data.asks);
      this.sequence = sequence;
    } else {
      return;
    }
    this.exchangeTime = Number(data.ts || Date.now());
    this.ready = true;
    this.publish();
    this.sendState("live");
  }

  handleHyperliquid(message) {
    if (message.channel !== "l2Book" || !message.data?.levels) return;
    this.bids = rowsToMap(message.data.levels[0]);
    this.asks = rowsToMap(message.data.levels[1]);
    this.exchangeTime = Number(message.data.time || Date.now());
    this.sequence = null;
    this.ready = true;
    this.publish();
    this.sendState("live");
  }

  reconnect(message) {
    if (this.stopped || this.reconnectTimer) return;
    this.ready = false;
    this.sendState("syncing", message);
    const socket = this.socket;
    if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    else this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.retryCount += 1;
    const delay = Math.min(1000 * (2 ** Math.min(this.retryCount - 1, 4)), 15000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  publish(immediate = false) {
    if (!this.ready || this.stopped) return;
    if (!immediate && Date.now() - this.lastPublishedAt < 100) {
      if (!this.emitTimer) {
        this.emitTimer = setTimeout(() => {
          this.emitTimer = null;
          this.publish(true);
        }, 100 - (Date.now() - this.lastPublishedAt));
      }
      return;
    }
    const bids = sortedRows(this.bids, true).slice(0, 50);
    const asks = sortedRows(this.asks, false).slice(0, 50);
    if (!bids.length || !asks.length) {
      this.sendState("stale", "The exchange has not sent both sides of this book yet.");
      return;
    }
    const bestBid = bids[0].price;
    const bestAsk = asks[0].price;
    if (bestBid >= bestAsk) {
      this.reconnect("The exchange book became crossed; rebuilding the depth snapshot.");
      return;
    }
    const normalize = (rows) => {
      let cumulativeQuote = 0;
      return rows.map((level) => {
        const quoteSize = level.price * level.size;
        cumulativeQuote += quoteSize;
        return { ...level, quoteSize, cumulativeQuote };
      });
    };
    const receivedAt = Date.now();
    this.lastPublishedAt = receivedAt;
    this.onBook?.({
      type: "book",
      provider: this.provider,
      symbol: this.symbol,
      marketType: this.productType,
      source: "websocket",
      bids: normalize(bids),
      asks: normalize(asks),
      bestBid,
      bestAsk,
      midPrice: (bestBid + bestAsk) / 2,
      spread: bestAsk - bestBid,
      spreadPercent: ((bestAsk - bestBid) / ((bestBid + bestAsk) / 2)) * 100,
      sequence: this.sequence === null ? null : String(this.sequence),
      exchangeTime: this.exchangeTime || receivedAt,
      updatedAt: receivedAt,
    });
  }
}

export function marketTypeFor(provider) {
  return productTypes[provider] || "spot";
}
