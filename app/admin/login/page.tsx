import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminLoginForm } from "@/components/admin-login-form";
import {
  ADMIN_SESSION_COOKIE,
  isAdminConfigured,
  isAdminSession,
} from "@/lib/admin-auth";

export default async function AdminLoginPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-sm flex-col justify-center">
        <Suspense fallback={<AdminLoginShell />}>
          <AdminLoginContent />
        </Suspense>
      </div>
    </main>
  );
}

async function AdminLoginContent() {
  await connection();
  const cookieStore = await cookies();
  const authed = await isAdminSession(
    cookieStore.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (authed) redirect("/dashboard");

  const configured = isAdminConfigured();

  return (
    <>
      <AdminLoginShell />
      {configured ? (
        <AdminLoginForm />
      ) : (
        <p className="text-sm text-muted-foreground">
          Admin dashboard is not configured.
        </p>
      )}
    </>
  );
}

function AdminLoginShell() {
  return (
    <div className="mb-6 space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Crux</p>
      <h1 className="text-2xl font-semibold tracking-normal">
        Admin dashboard
      </h1>
    </div>
  );
}
