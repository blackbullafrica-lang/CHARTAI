import express from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const router = express.Router();
const memory = {
  profiles: new Map(),
  follows: new Map(),
  events: [],
  nextEventId: 1,
};
const SESSION_COOKIE = "chartai_demo_user";
const LOCAL_SESSION_SECRET = "chart-ai-local-demo-session-only";

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url && !key) return null;
  if (!url || !key) throw new Error("Copy trading storage is only partially configured");
  return { url, key };
}

function signingSecret(config) {
  return process.env.DEMO_TRADING_SECRET || config?.key || LOCAL_SESSION_SECRET;
}

function signUserId(userId, secret) {
  return createHmac("sha256", secret).update(userId).digest("base64url");
}

function cookieUser(req, res, config) {
  const secret = signingSecret(config);
  const token = (req.headers.cookie || "")
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (token) {
    const [userId, signature, extra] = decodeURIComponent(token).split(".");
    if (
      !extra &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId || "") &&
      signature
    ) {
      const expected = Buffer.from(signUserId(userId, secret));
      const supplied = Buffer.from(signature);
      if (expected.length === supplied.length && timingSafeEqual(expected, supplied))
        return userId;
    }
  }
  const userId = randomUUID();
  const value = encodeURIComponent(`${userId}.${signUserId(userId, secret)}`);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
  );
  return userId;
}

async function supabaseRequest(config, path, init = {}) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok)
    throw new Error(body?.message || body?.hint || `Copy trading database returned ${response.status}`);
  return body;
}

function normalizeProfile(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    isPublic: Boolean(row.is_public),
    currentTrade: row.current_trade || null,
    realizedPnl: Number(row.realized_pnl || 0),
    totalTrades: Number(row.total_trades || 0),
    updatedAt: row.updated_at,
  };
}

async function ensureProfile(userId, config) {
  if (!config) {
    if (!memory.profiles.has(userId)) {
      memory.profiles.set(userId, {
        id: userId,
        displayName: `Trader ${userId.slice(0, 5).toUpperCase()}`,
        isPublic: false,
        currentTrade: null,
        realizedPnl: 0,
        totalTrades: 0,
        updatedAt: new Date().toISOString(),
      });
    }
    return memory.profiles.get(userId);
  }
  const found = await supabaseRequest(
    config,
    `demo_copy_profiles?id=eq.${userId}&select=*`,
  );
  if (found?.[0]) return normalizeProfile(found[0]);
  const inserted = await supabaseRequest(config, "demo_copy_profiles?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      id: userId,
      display_name: `Trader ${userId.slice(0, 5).toUpperCase()}`,
    }),
  });
  if (inserted?.[0]) return normalizeProfile(inserted[0]);
  const raced = await supabaseRequest(
    config,
    `demo_copy_profiles?id=eq.${userId}&select=*`,
  );
  if (!raced?.[0]) throw new Error("Could not create a demo trader profile");
  return normalizeProfile(raced[0]);
}

async function snapshot(userId, afterEventId, config) {
  if (!config) {
    const me = memory.profiles.get(userId);
    const ownFollows = [...memory.follows.values()].filter(
      (follow) => follow.followerId === userId,
    );
    const visibleIds = new Set([
      userId,
      ...ownFollows.map((follow) => follow.traderId),
    ]);
    const traders = [...memory.profiles.values()]
      .filter((profile) =>
        profile.id === userId ? true : profile.isPublic || visibleIds.has(profile.id),
      )
      .map((profile) => ({ ...profile }));
    const cursor = memory.nextEventId - 1;
    const events = afterEventId === null
      ? []
      : memory.events
          .filter(
            (event) =>
              event.id > afterEventId &&
              ownFollows.some((follow) => follow.traderId === event.traderId),
          )
          .map((event) => ({ ...event }));
    return {
      me: { ...me },
      traders,
      follows: ownFollows,
      events,
      cursor,
      storageMode: "local-memory",
    };
  }
  const result = await supabaseRequest(
    config,
    "rpc/demo_copy_snapshot",
    {
      method: "POST",
      body: JSON.stringify({
        p_user_id: userId,
        p_after_event_id: afterEventId,
      }),
    },
  );
  if (!result || typeof result !== "object")
    throw new Error("Copy trading snapshot is unavailable");
  return {
    ...result,
    me: result.me ? normalizeProfile(result.me) : null,
    traders: (result.traders || []).map(normalizeProfile),
    follows: (result.follows || []).map((follow) => ({
      traderId: follow.trader_id,
      enabled: Boolean(follow.enabled),
      copyScale: Number(follow.copy_scale || 100),
    })),
    cursor: Number(result.cursor || 0),
    storageMode: "persistent",
  };
}

async function updateProfile(userId, displayName, isPublic, config) {
  const safeName = String(displayName || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
  if (safeName.length < 2) throw new Error("Name must be 2–24 characters.");
  if (!config) {
    const current = memory.profiles.get(userId);
    const updated = {
      ...current,
      displayName: safeName,
      isPublic: Boolean(isPublic),
      updatedAt: new Date().toISOString(),
    };
    memory.profiles.set(userId, updated);
    return updated;
  }
  const rows = await supabaseRequest(
    config,
    `demo_copy_profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ display_name: safeName, is_public: Boolean(isPublic) }),
    },
  );
  if (!rows?.[0]) throw new Error("Could not save the demo trader profile.");
  return normalizeProfile(rows[0]);
}

async function setFollow(userId, traderId, enabled, copyScale, config) {
  if (traderId === userId) throw new Error("You cannot copy your own demo account.");
  if (!/^[0-9a-f-]{36}$/i.test(traderId)) throw new Error("Invalid trader.");
  const scale = Number(copyScale);
  if (!Number.isFinite(scale) || scale < 10 || scale > 200)
    throw new Error("Copy size must be between 10% and 200%.");
  if (!config) {
    const trader = memory.profiles.get(traderId);
    const alreadyFollowing = memory.follows.has(`${userId}:${traderId}`);
    if (enabled && !trader?.isPublic)
      throw new Error("This demo trader is not sharing trades.");
    if (!enabled && !alreadyFollowing)
      throw new Error("This demo trader is not in your copy list.");
    memory.follows.set(`${userId}:${traderId}`, {
      followerId: userId,
      traderId,
      enabled: Boolean(enabled),
      copyScale: scale,
    });
    return;
  }
  if (enabled) {
    const profile = await supabaseRequest(
      config,
      `demo_copy_profiles?id=eq.${traderId}&select=id,is_public`,
    );
    if (!profile?.[0]?.is_public)
      throw new Error("This demo trader is not sharing trades.");
  }
  await supabaseRequest(config, "demo_copy_follows?on_conflict=follower_id,trader_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      follower_id: userId,
      trader_id: traderId,
      enabled: Boolean(enabled),
      copy_scale: scale,
    }),
  });
}

function validPosition(position) {
  return Boolean(
    position &&
      typeof position === "object" &&
      typeof position.id === "string" &&
      position.id.length <= 120 &&
      (position.direction === "LONG" || position.direction === "SHORT") &&
      ["binance", "bybit", "okx", "aster", "hyperliquid", "mexc"].includes(position.provider) &&
      typeof position.symbol === "string" &&
      /^[\p{L}\p{N}]{2,40}$/u.test(position.symbol) &&
      ["5m", "15m", "1h", "4h", "1d", "1w"].includes(position.interval) &&
      [
        "entry",
        "stop",
        "target",
        "quantity",
        "leverage",
        "margin",
        "liquidationPrice",
        "riskAmount",
        "feeRate",
        "markPrice",
        "openedAtTime",
      ].every((key) => Number.isFinite(Number(position[key]))) &&
      Number(position.entry) > 0 &&
      Number(position.quantity) > 0 &&
      Number(position.stop) > 0 &&
      Number(position.target) > 0 &&
      Number(position.leverage) >= 1 &&
      Number(position.leverage) <= 50,
  );
}

async function publishEvent(userId, kind, trade, config) {
  if (kind === "open") {
    if (!validPosition(trade?.position)) throw new Error("Invalid demo position.");
    if (!Number.isFinite(Number(trade?.accountBalance)) || Number(trade.accountBalance) <= 0)
      throw new Error("Invalid demo account balance.");
  } else if (
    kind !== "close" ||
    typeof trade?.positionId !== "string" ||
    !Number.isFinite(Number(trade.exitPrice)) ||
    Number(trade.exitPrice) <= 0 ||
    !Number.isFinite(Number(trade.closedAtTime)) ||
    (trade.pnl !== undefined && !Number.isFinite(Number(trade.pnl))) ||
    (trade.reason !== undefined && !["Stop hit", "Target hit", "Estimated liquidation", "Closed manually"].includes(trade.reason))
  ) {
    throw new Error("Invalid demo trade update.");
  }
  if (!config) {
    const profile = memory.profiles.get(userId);
    if (!profile?.isPublic && kind === "open")
      throw new Error("Enable trade sharing before publishing demo positions.");
    if (kind === "open") {
      if (profile.currentTrade?.position?.id === trade.position.id) return null;
      profile.currentTrade = trade;
      profile.updatedAt = new Date().toISOString();
    } else {
      if (profile.currentTrade?.position?.id !== trade.positionId) return null;
      profile.currentTrade = null;
      profile.realizedPnl += Number(trade.pnl || 0);
      profile.totalTrades += 1;
      profile.updatedAt = new Date().toISOString();
    }
    memory.profiles.set(userId, profile);
    const event = {
      id: memory.nextEventId++,
      traderId: userId,
      kind,
      trade,
      createdAt: new Date().toISOString(),
      displayName: profile.displayName,
    };
    memory.events.push(event);
    if (memory.events.length > 10000) memory.events.splice(0, 1000);
    return event;
  }
  const result = await supabaseRequest(config, "rpc/demo_copy_apply_event", {
    method: "POST",
    body: JSON.stringify({ p_actor_id: userId, p_kind: kind, p_trade: trade }),
  });
  return result;
}

function deploymentStore(req) {
  const config = supabaseConfig();
  if ((process.env.VERCEL === "1" || req.headers["x-vercel-id"]) && !config)
    throw new Error("Copy trading needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel. Run supabase/copy-trading.sql first.");
  return config;
}

router.use(async (req, res, next) => {
  try {
    const config = deploymentStore(req);
    req.copyTradingConfig = config;
    req.copyTradingUserId = cookieUser(req, res, config);
    await ensureProfile(req.copyTradingUserId, config);
    next();
  } catch (error) {
    res.status(503).json({
      error:
        error instanceof Error
          ? error.message
          : "Copy trading storage is unavailable.",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const parsedAfter = Number(req.query.after);
    const after = req.query.after === undefined
      ? null
      : Number.isSafeInteger(parsedAfter) && parsedAfter >= 0
        ? parsedAfter
        : null;
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await snapshot(req.copyTradingUserId, after, req.copyTradingConfig),
    );
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "Copy trading is unavailable." });
  }
});

router.post("/profile", async (req, res) => {
  try {
    const profile = await updateProfile(
      req.copyTradingUserId,
      req.body?.displayName,
      req.body?.isPublic,
      req.copyTradingConfig,
    );
    if (profile.isPublic && req.body?.currentTrade?.position) {
      await publishEvent(
        req.copyTradingUserId,
        "open",
        req.body.currentTrade,
        req.copyTradingConfig,
      );
    }
    res.json({ profile });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not save profile." });
  }
});

router.post("/follow", async (req, res) => {
  try {
    await setFollow(
      req.copyTradingUserId,
      String(req.body?.traderId || ""),
      req.body?.enabled,
      req.body?.copyScale,
      req.copyTradingConfig,
    );
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not update copy settings." });
  }
});

router.post("/event", async (req, res) => {
  try {
    const event = await publishEvent(
      req.copyTradingUserId,
      String(req.body?.kind || ""),
      req.body?.trade,
      req.copyTradingConfig,
    );
    if (!event) return res.status(409).json({ error: "That demo position is no longer active." });
    res.json({ ok: true, eventId: event.id ?? event.event_id ?? null });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not publish demo trade." });
  }
});

export default router;
