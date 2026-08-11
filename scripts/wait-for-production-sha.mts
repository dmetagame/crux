import { gitShaMatches } from "../lib/deployment-version.ts";

const baseUrl = normalizeBaseUrl(
  process.env.CRUX_VERIFY_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://crux-khaki.vercel.app",
);
const expectedSha = process.env.CRUX_EXPECTED_GIT_SHA?.trim();
const timeoutSeconds = positiveInteger(process.env.CRUX_DEPLOY_WAIT_TIMEOUT_SECONDS, 480);
const intervalSeconds = positiveInteger(process.env.CRUX_DEPLOY_WAIT_INTERVAL_SECONDS, 10);

if (!expectedSha) {
  throw new Error("CRUX_EXPECTED_GIT_SHA is required.");
}

const deadline = Date.now() + timeoutSeconds * 1000;
let attempt = 0;
let lastObserved = "unavailable";

while (Date.now() < deadline) {
  attempt += 1;
  try {
    const response = await fetch(new URL("/api/version", baseUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { gitSha?: unknown };
    lastObserved = typeof body.gitSha === "string" ? body.gitSha : "missing";
    if (typeof body.gitSha === "string" && gitShaMatches(body.gitSha, expectedSha)) {
      console.log(`Production is serving ${body.gitSha} after ${attempt} check(s).`);
      process.exit(0);
    }
  } catch (err) {
    lastObserved = (err as Error).message;
  }

  console.log(`Waiting for ${expectedSha.slice(0, 12)}; observed ${lastObserved}.`);
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
}

throw new Error(
  `Production did not serve ${expectedSha} within ${timeoutSeconds}s. Last observed: ${lastObserved}`,
);

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
