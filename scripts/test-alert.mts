const baseUrl = (
  process.env.CRUX_VERIFY_BASE_URL ?? "https://crux-khaki.vercel.app"
).replace(/\/$/, "");
const token = process.env.CRUX_MAINTENANCE_TOKEN?.trim();
const label = process.env.CRUX_ALERT_TEST_LABEL?.trim() || "operator test";

if (!token) {
  console.error("CRUX_MAINTENANCE_TOKEN is required.");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/admin/alerts/test`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ label }),
});

const json = await res.json().catch(() => ({}));
console.log(JSON.stringify(json, null, 2));

if (!res.ok || json?.ok !== true) {
  process.exit(1);
}
