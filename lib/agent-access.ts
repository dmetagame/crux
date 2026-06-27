import { safeEqualHex, sha256Hex } from "@/lib/access-crypto";
import {
  acquireRunLock,
  budgetCostUnits,
  clientIp,
  consumeRateLimit,
  limitKey,
  rateLimitHeaders,
  releaseRunLock,
} from "@/lib/rate-limit";

export type AgentScope = "agent:run" | "agent:real" | "agent:baseline";

type AgentKeyConfig = {
  hash: string;
  label?: string;
  scopes?: string[];
  hourlyLimit?: number;
  dailyBudgetUsdc?: number;
  maxBudgetUsdc?: number;
  enabled?: boolean;
};

type GuardSuccess = {
  ok: true;
  actorKind: "public" | "api-key" | "visitor-wallet";
  actorId: string;
  release: () => Promise<void>;
};

type GuardFailure = {
  ok: false;
  status: number;
  message: string;
  headers?: Record<string, string>;
};

export type AgentRunGuard = GuardSuccess | GuardFailure;

const DEFAULT_MODELS = ["anthropic/claude-haiku-4.5"];
const ALL_AGENT_SCOPES: AgentScope[] = ["agent:run", "agent:real", "agent:baseline"];

export async function guardAgentRun(
  req: Request,
  opts: {
    scope: AgentScope;
    budgetUsdc: number;
    model?: string;
    visitorWalletId?: string | null;
    publicMaxBudgetUsdc: number;
  },
): Promise<AgentRunGuard> {
  if (!Number.isFinite(opts.budgetUsdc) || opts.budgetUsdc <= 0) {
    return { ok: false, status: 400, message: "Budget must be a positive number." };
  }

  if (opts.model && !isAllowedModel(opts.model)) {
    return {
      ok: false,
      status: 400,
      message: `Model ${opts.model} is not enabled for public agent runs.`,
    };
  }

  if (opts.visitorWalletId) {
    return guardVisitorWalletRun(req, opts);
  }

  return guardHouseWalletRun(req, opts);
}

function isAllowedModel(model: string) {
  const list = (process.env.CRUX_AGENT_MODEL_ALLOWLIST?.trim()
    ? process.env.CRUX_AGENT_MODEL_ALLOWLIST.split(",")
    : DEFAULT_MODELS
  )
    .map((m) => m.trim())
    .filter(Boolean);
  return list.includes("*") || list.includes(model);
}

async function guardVisitorWalletRun(
  req: Request,
  opts: {
    scope: AgentScope;
    budgetUsdc: number;
    visitorWalletId?: string | null;
    publicMaxBudgetUsdc: number;
  },
): Promise<AgentRunGuard> {
  const maxBudget = envFloat("CRUX_VISITOR_AGENT_MAX_BUDGET_USDC", opts.publicMaxBudgetUsdc);
  if (opts.budgetUsdc > maxBudget) {
    return {
      ok: false,
      status: 400,
      message: `Visitor-wallet budget cap is ${maxBudget.toFixed(3)} USDC.`,
    };
  }

  const ip = clientIp(req);
  const walletId = opts.visitorWalletId!;
  const hourly = await consumeRateLimit({
    key: limitKey(`${opts.scope}:visitor-hour`, `${walletId}:${ip}`),
    limit: envInt("CRUX_VISITOR_AGENT_HOURLY_LIMIT", 5),
    windowSeconds: 3600,
  });
  if (!hourly.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Visitor wallet run limit reached. Try again later.",
      headers: rateLimitHeaders(hourly),
    };
  }

  const dailyBudget = await consumeRateLimit({
    key: limitKey(`${opts.scope}:visitor-budget`, walletId),
    limit: budgetCostUnits(envFloat("CRUX_VISITOR_AGENT_DAILY_BUDGET_USDC", 0.25)),
    windowSeconds: 86400,
    cost: budgetCostUnits(opts.budgetUsdc),
  });
  if (!dailyBudget.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Visitor wallet daily budget cap reached. Try again tomorrow.",
      headers: rateLimitHeaders(dailyBudget),
    };
  }

  const lock = await acquireRunLock({
    key: limitKey(`${opts.scope}:visitor-lock`, walletId),
    limit: envInt("CRUX_VISITOR_AGENT_CONCURRENCY", 1),
    ttlSeconds: envInt("CRUX_AGENT_RUN_LOCK_TTL_SECONDS", 120),
  });
  if (!lock.acquired) {
    return {
      ok: false,
      status: 429,
      message: "This visitor wallet already has a run in progress.",
      headers: lock.resetAt ? { "Retry-After": retryAfter(lock.resetAt) } : undefined,
    };
  }

  return {
    ok: true,
    actorKind: "visitor-wallet",
    actorId: walletId,
    release: () => releaseRunLock(lock.lockId),
  };
}

async function guardHouseWalletRun(
  req: Request,
  opts: {
    scope: AgentScope;
    budgetUsdc: number;
    publicMaxBudgetUsdc: number;
  },
): Promise<AgentRunGuard> {
  const auth = authenticateAgentKey(req, opts.scope);
  if (!auth.ok) return auth;

  if (auth.actorKind === "public" && !envBool("CRUX_PUBLIC_AGENT_RUNS_ENABLED", true)) {
    return { ok: false, status: 401, message: "Public house-wallet runs are disabled." };
  }

  const hardMax = envFloat("CRUX_AGENT_HARD_MAX_BUDGET_USDC", 0.1);
  const actorMax =
    auth.actorKind === "api-key"
      ? auth.config.maxBudgetUsdc ?? envFloat("CRUX_AGENT_KEY_MAX_BUDGET_USDC", 0.1)
      : opts.publicMaxBudgetUsdc;
  const maxBudget = Math.min(hardMax, actorMax);
  if (opts.budgetUsdc > maxBudget) {
    return {
      ok: false,
      status: 400,
      message: `Budget cap is ${maxBudget.toFixed(3)} USDC for this caller.`,
    };
  }

  const hourlyLimit =
    auth.actorKind === "api-key"
      ? auth.config.hourlyLimit ?? envInt("CRUX_AGENT_KEY_HOURLY_LIMIT", 20)
      : envInt("CRUX_PUBLIC_AGENT_HOURLY_LIMIT", 2);
  const hourly = await consumeRateLimit({
    key: limitKey(`${opts.scope}:hour`, auth.actorId),
    limit: hourlyLimit,
    windowSeconds: 3600,
  });
  if (!hourly.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Agent run rate limit reached. Try again later.",
      headers: rateLimitHeaders(hourly),
    };
  }

  const dailyBudgetUsdc =
    auth.actorKind === "api-key"
      ? auth.config.dailyBudgetUsdc ?? envFloat("CRUX_AGENT_KEY_DAILY_BUDGET_USDC", 1)
      : envFloat("CRUX_PUBLIC_AGENT_DAILY_BUDGET_USDC", 0.1);
  const actorBudget = await consumeRateLimit({
    key: limitKey(`${opts.scope}:budget`, auth.actorId),
    limit: budgetCostUnits(dailyBudgetUsdc),
    windowSeconds: 86400,
    cost: budgetCostUnits(opts.budgetUsdc),
  });
  if (!actorBudget.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Daily agent budget cap reached for this caller.",
      headers: rateLimitHeaders(actorBudget),
    };
  }

  const globalBudget = await consumeRateLimit({
    key: "agent:house:global-budget",
    limit: budgetCostUnits(envFloat("CRUX_HOUSE_AGENT_DAILY_BUDGET_USDC", 0.5)),
    windowSeconds: 86400,
    cost: budgetCostUnits(opts.budgetUsdc),
  });
  if (!globalBudget.allowed) {
    return {
      ok: false,
      status: 429,
      message: "Global house-wallet daily budget cap reached.",
      headers: rateLimitHeaders(globalBudget),
    };
  }

  const lock = await acquireRunLock({
    key: "agent:house:global-lock",
    limit: envInt("CRUX_HOUSE_AGENT_CONCURRENCY", 1),
    ttlSeconds: envInt("CRUX_AGENT_RUN_LOCK_TTL_SECONDS", 120),
  });
  if (!lock.acquired) {
    return {
      ok: false,
      status: 429,
      message: "Another house-wallet agent run is already in progress.",
      headers: lock.resetAt ? { "Retry-After": retryAfter(lock.resetAt) } : undefined,
    };
  }

  return {
    ok: true,
    actorKind: auth.actorKind,
    actorId: auth.actorId,
    release: () => releaseRunLock(lock.lockId),
  };
}

function authenticateAgentKey(
  req: Request,
  scope: AgentScope,
):
  | { ok: true; actorKind: "public"; actorId: string }
  | { ok: true; actorKind: "api-key"; actorId: string; config: AgentKeyConfig }
  | GuardFailure {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) {
    return { ok: true, actorKind: "public", actorId: `public:${clientIp(req)}` };
  }

  const hash = sha256Hex(bearer);
  const config = agentKeyConfigs().find((candidate) => safeEqualHex(candidate.hash, hash));
  if (!config || config.enabled === false) {
    return { ok: false, status: 401, message: "Invalid Crux agent API key." };
  }

  if (!scopeAllowed(config.scopes, scope)) {
    return { ok: false, status: 403, message: `API key is not scoped for ${scope}.` };
  }

  return {
    ok: true,
    actorKind: "api-key",
    actorId: `api:${config.hash.slice(0, 16)}`,
    config,
  };
}

function agentKeyConfigs(): AgentKeyConfig[] {
  const configs: AgentKeyConfig[] = [];
  const json = process.env.CRUX_AGENT_KEY_CONFIG?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item?.hash === "string") {
            configs.push({
              hash: item.hash.toLowerCase(),
              label: typeof item.label === "string" ? item.label : undefined,
              scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : undefined,
              hourlyLimit: numberOrUndefined(item.hourlyLimit),
              dailyBudgetUsdc: numberOrUndefined(item.dailyBudgetUsdc),
              maxBudgetUsdc: numberOrUndefined(item.maxBudgetUsdc),
              enabled: item.enabled !== false,
            });
          }
        }
      }
    } catch (err) {
      console.warn("[agent-auth] CRUX_AGENT_KEY_CONFIG is invalid JSON:", (err as Error).message);
    }
  }

  for (const hash of (process.env.CRUX_AGENT_KEY_HASHES ?? "").split(",")) {
    const value = hash.trim().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(value)) {
      configs.push({
        hash: value,
        scopes: ALL_AGENT_SCOPES,
        enabled: true,
      });
    }
  }

  return configs;
}

function scopeAllowed(scopes: string[] | undefined, scope: AgentScope) {
  if (!scopes?.length) return ALL_AGENT_SCOPES.includes(scope);
  return scopes.includes("*") || scopes.includes("agent:*") || scopes.includes(scope);
}

function envInt(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number) {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envBool(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value);
}

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function retryAfter(resetAt: string) {
  return String(Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000)));
}
