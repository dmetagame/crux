/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { sendOperationalAlert } from "@/lib/alerts";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  createAdminSessionCookie,
  isAdminLogin,
  isAdminConfigured,
  normalizeEmail,
} from "@/lib/admin-auth";
import {
  clientIpFromHeaders,
  consumeRateLimit,
  limitKey,
} from "@/lib/rate-limit";

export type LoginState = {
  error?: string;
};

export async function login(
  _state: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!isAdminConfigured()) {
    return { error: "Admin dashboard is not configured" };
  }

  const requestHeaders = await headers();
  const ip = clientIpFromHeaders(requestHeaders);
  const normalizedEmail = normalizeEmail(email);
  const [ipRate, emailRate] = await Promise.all([
    consumeRateLimit({
      key: limitKey("admin:login:ip", ip),
      limit: 12,
      windowSeconds: 10 * 60,
      failureMode: "closed",
    }),
    consumeRateLimit({
      key: limitKey("admin:login:email", normalizedEmail || ip),
      limit: 6,
      windowSeconds: 10 * 60,
      failureMode: "closed",
    }),
  ]);

  if (!ipRate.allowed || !emailRate.allowed) {
    void sendOperationalAlert({
      event: "admin_login_rate_limited",
      severity: "warning",
      title: "Admin login rate limited",
      summary: "Admin login attempts exceeded the configured rate limit.",
      details: {
        ipLimited: !ipRate.allowed,
        emailLimited: !emailRate.allowed,
        failedClosed: Boolean(ipRate.failedClosed || emailRate.failedClosed),
      },
      dedupeKey: "admin-login-rate-limited",
      dedupeMs: 10 * 60 * 1000,
    });
    return {
      error: ipRate.failedClosed || emailRate.failedClosed
        ? "Admin login controls are temporarily unavailable. Try again shortly."
        : "Too many login attempts. Try again shortly.",
    };
  }

  if (!(await isAdminLogin(email, password))) {
    return { error: "Invalid credentials" };
  }

  const cookieStore = await cookies();
  cookieStore.set(
    ADMIN_SESSION_COOKIE,
    await createAdminSessionCookie(),
    adminSessionCookieOptions(),
  );

  redirect("/dashboard");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
  cookieStore.delete("session");
  redirect("/");
}
