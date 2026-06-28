type Check = {
  name: string;
  path: string;
  init?: RequestInit;
  expect: (res: Response, body: string) => Promise<void> | void;
};

const DEFAULT_BASE_URL = "https://crux-khaki.vercel.app";
const baseUrl = normalizeBaseUrl(
  process.env.CRUX_VERIFY_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    DEFAULT_BASE_URL,
);

const checks: Check[] = [
  {
    name: "marketplace catalog",
    path: "/api/marketplace",
    expect: (res, body) => {
      expectStatus(res, 200);
      const json = parseJson(body);
      if (!Array.isArray(json.sources) || json.sources.length === 0) {
        throw new Error("expected non-empty sources array");
      }
    },
  },
  {
    name: "stats dashboard data",
    path: "/api/stats",
    expect: (res, body) => {
      expectStatus(res, 200);
      const json = parseJson(body);
      if (typeof json.totalPayments !== "number" || typeof json.totalUsdc !== "number") {
        throw new Error("expected numeric totalPayments and totalUsdc");
      }
    },
  },
  {
    name: "agent topics",
    path: "/api/agent/topics",
    expect: (res, body) => {
      expectStatus(res, 200);
      const json = parseJson(body);
      if (!Array.isArray(json.topics) || json.topics.length === 0) {
        throw new Error("expected non-empty topics array");
      }
    },
  },
  {
    name: "x402 challenge",
    path: "/api/premium/quote",
    expect: (res) => {
      expectStatus(res, 402);
      const challenge = res.headers.get("payment-required");
      if (!challenge) throw new Error("missing payment-required header");

      const decoded = JSON.parse(Buffer.from(challenge, "base64").toString("utf8"));
      const accepted = decoded?.accepts?.[0];
      if (decoded?.x402Version !== 2) throw new Error("expected x402Version 2");
      if (accepted?.network !== "eip155:5042002") throw new Error("expected Arc Testnet network");
      if (accepted?.amount !== "1000") throw new Error("expected 0.001 USDC quote amount");
      if (!accepted?.payTo) throw new Error("missing seller payTo address");
    },
  },
  {
    name: "wallet status auth path",
    path: "/api/wallet/status?walletId=00000000-0000-0000-0000-000000000000",
    init: {
      headers: {
        authorization: "Bearer smoke-test",
      },
    },
    expect: (res, body) => {
      if (res.status === 503) {
        throw new Error("rate-limit controls are unavailable");
      }
      expectStatus(res, 404);
      const json = parseJson(body);
      if (json.error !== "Unknown or unauthorized wallet") {
        throw new Error("expected unauthorized wallet response");
      }
    },
  },
  {
    name: "agent budget guard",
    path: "/api/agent/run?budget=999",
    expect: (res, body) => {
      if (res.status === 503) {
        throw new Error("agent access controls are unavailable");
      }
      expectStatus(res, 400);
      if (!body.includes("Budget cap is 0.050 USDC")) {
        throw new Error("expected public budget cap error");
      }
    },
  },
  {
    name: "admin login page",
    path: "/admin/login",
    expect: (res, body) => {
      expectStatus(res, 200);
      if (!body.includes("Admin dashboard")) {
        throw new Error("expected admin dashboard login page");
      }
    },
  },
  {
    name: "admin dashboard auth redirect",
    path: "/dashboard",
    init: {
      redirect: "manual",
    },
    expect: (res) => {
      if (![307, 308].includes(res.status)) {
        throw new Error(`expected dashboard redirect, got ${res.status}`);
      }
      const location = res.headers.get("location") ?? "";
      if (!location.endsWith("/admin/login")) {
        throw new Error(`expected redirect to /admin/login, got ${location}`);
      }
    },
  },
  {
    name: "payment reconciliation auth guard",
    path: "/api/admin/reconcile-payments",
    expect: (res, body) => {
      expectStatus(res, 401);
      const json = parseJson(body);
      if (json.error !== "Unauthorized") {
        throw new Error("expected unauthorized reconciliation response");
      }
    },
  },
];

let failures = 0;

console.log(`Verifying ${baseUrl}`);

for (const check of checks) {
  const url = new URL(check.path, baseUrl);
  try {
    const res = await fetch(url, {
      ...check.init,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.text();
    await check.expect(res, body);
    console.log(`PASS ${check.name} (${res.status})`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${(err as Error).message}`);
  }
}

if (failures > 0) {
  console.error(`${failures} production check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log("All production checks passed.");

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function expectStatus(res: Response, expected: number) {
  if (res.status !== expected) {
    throw new Error(`expected HTTP ${expected}, got ${res.status}`);
  }
}

function parseJson(body: string) {
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`invalid JSON body: ${(err as Error).message}`);
  }
}
