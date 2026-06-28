import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "crux_admin_session";
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type AdminCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "strict";
  path: "/";
  maxAge: number;
};

const SESSION_VERSION = "v1";

export function adminSessionSecret() {
  return (
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.ADMIN_SESSION_TOKEN?.trim() ||
    ""
  );
}

export function adminLoginConfig() {
  return {
    email: normalizeEmail(process.env.ADMIN_EMAIL ?? ""),
    password: process.env.ADMIN_PASSWORD ?? "",
    passwordHash: process.env.ADMIN_PASSWORD_SHA256?.trim().toLowerCase() ?? "",
  };
}

export function isAdminConfigured() {
  const config = adminLoginConfig();
  return Boolean(
    config.email &&
      (config.password || isSha256Hex(config.passwordHash)) &&
      adminSessionSecret(),
  );
}

export async function isAdminLogin(email: string, password: string) {
  const config = adminLoginConfig();
  if (!isAdminConfigured()) return false;

  const emailOk = safeEqualString(normalizeEmail(email), config.email);
  const expectedPasswordHash = config.passwordHash || (await sha256Hex(config.password));
  const suppliedPasswordHash = await sha256Hex(password);
  const passwordOk =
    isSha256Hex(expectedPasswordHash) &&
    safeEqualString(suppliedPasswordHash, expectedPasswordHash);

  return emailOk && passwordOk;
}

export async function createAdminSessionCookie() {
  const secret = adminSessionSecret();
  if (!secret) throw new Error("Admin session secret is not configured.");

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ADMIN_SESSION_MAX_AGE_SECONDS;
  const nonce = randomSessionNonce();
  const payload = `${SESSION_VERSION}.${issuedAt}.${expiresAt}.${nonce}`;
  const signature = await hmacSha256Base64Url(secret, payload);
  return `${payload}.${signature}`;
}

export async function isAdminSession(value: string | undefined) {
  const secret = adminSessionSecret();
  if (!secret || !value) return false;

  const parts = value.split(".");
  if (parts.length !== 5) return false;
  const [version, issuedAtRaw, expiresAtRaw, nonce, signature] = parts;
  if (version !== SESSION_VERSION || !issuedAtRaw || !expiresAtRaw || !nonce || !signature) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;
  if (expiresAt <= now || issuedAt > now + 60) return false;
  if (expiresAt - issuedAt > ADMIN_SESSION_MAX_AGE_SECONDS + 60) return false;

  const payload = `${version}.${issuedAtRaw}.${expiresAtRaw}.${nonce}`;
  const expected = await hmacSha256Base64Url(secret, payload);
  return safeEqualString(signature, expected);
}

export function adminSessionCookieOptions(): AdminCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  };
}

export function isSameOriginAdminMutation(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(req.url).origin;
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Base64Url(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function randomSessionNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeEqualString(left: string, right: string) {
  const max = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let i = 0; i < max; i += 1) {
    const leftCode = i < left.length ? left.charCodeAt(i) : 0;
    const rightCode = i < right.length ? right.charCodeAt(i) : 0;
    mismatch |= leftCode ^ rightCode;
  }
  return mismatch === 0;
}

function isSha256Hex(value: string) {
  return /^[0-9a-f]{64}$/.test(value);
}
