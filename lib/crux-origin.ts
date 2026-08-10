const PRODUCTION_ORIGIN = "https://crux-khaki.vercel.app";

export function cruxCanonicalOrigin(req?: Request) {
  const configured = process.env.CRUX_CANONICAL_ORIGIN?.trim();
  if (configured) return validateOrigin(configured);

  if (process.env.VERCEL_ENV === "production") return PRODUCTION_ORIGIN;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing CRUX_CANONICAL_ORIGIN for this production deployment.");
  }
  if (!req) throw new Error("Missing CRUX_CANONICAL_ORIGIN.");
  return new URL(req.url).origin;
}

function validateOrigin(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("CRUX_CANONICAL_ORIGIN must be a plain HTTP(S) origin.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("CRUX_CANONICAL_ORIGIN must use HTTPS in production.");
  }
  return url.origin;
}
