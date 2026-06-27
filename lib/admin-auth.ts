export const ADMIN_SESSION_COOKIE = "crux_admin_session";

export function adminSessionToken() {
  return process.env.ADMIN_SESSION_TOKEN?.trim() ?? "";
}

export function adminLoginCredentials() {
  return {
    email: process.env.ADMIN_EMAIL?.trim() ?? "",
    password: process.env.ADMIN_PASSWORD ?? "",
  };
}

export function isAdminConfigured() {
  const creds = adminLoginCredentials();
  return Boolean(creds.email && creds.password && adminSessionToken());
}

export function isAdminSession(value: string | undefined) {
  const token = adminSessionToken();
  return Boolean(token && value && value === token);
}
