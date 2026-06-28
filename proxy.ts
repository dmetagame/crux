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

import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/admin-auth";

export async function proxy(request: NextRequest) {
  const session = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;
  const authed = await isAdminSession(session);
  const adminRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/api/gateway/") ||
    pathname.startsWith("/api/dashboard/");

  // Logged-in user trying to access sign-in page -> redirect to dashboard.
  if (pathname === "/admin/login" && authed) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/api/gateway/") && !authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname.startsWith("/api/dashboard/") && !authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Logged-out user trying to access protected pages -> redirect to admin login.
  if (adminRoute && !authed) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/login", "/dashboard/:path*", "/api/gateway/:path*", "/api/dashboard/:path*"],
};
