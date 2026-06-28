import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "@/lib/access-crypto";

export type ReceiptMode = "real" | "benchmark";
export type RunReceiptStatus = "running" | "completed" | "failed";

export interface SaveRunReceiptInput {
  mode: ReceiptMode;
  subject: string;
  model?: string;
  budgetUsdc: number;
  spentUsdc: number;
  payerKind: "house-wallet" | "visitor-wallet";
  payload: Record<string, unknown>;
}

export interface RunReceipt {
  id: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: RunReceiptStatus;
  error: string | null;
  mode: ReceiptMode;
  subject: string;
  model: string | null;
  budgetUsdc: number | null;
  spentUsdc: number | null;
  payerKind: string;
  payload: Record<string, unknown>;
}

export interface StartRunReceiptInput {
  mode: ReceiptMode;
  subject: string;
  model?: string;
  budgetUsdc: number;
  payerKind: "house-wallet" | "visitor-wallet";
  payload?: Record<string, unknown>;
  idempotencyScope?: string | null;
  idempotencyKey?: string | null;
}

export interface StartedRunReceipt {
  id: string | null;
  migrated: boolean;
  replay: boolean;
  receipt: RunReceipt | null;
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function mapReceipt(row: any): RunReceipt {
  return {
    id: row.id,
    createdAt: row.created_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    status: row.status ?? "completed",
    error: row.error ?? null,
    mode: row.mode,
    subject: row.subject,
    model: row.model,
    budgetUsdc: row.budget_usdc === null ? null : Number(row.budget_usdc),
    spentUsdc: row.spent_usdc === null ? null : Number(row.spent_usdc),
    payerKind: row.payer_kind,
    payload: row.payload ?? {},
  };
}

export async function saveRunReceipt(input: SaveRunReceiptInput): Promise<string> {
  const { data, error } = await admin()
    .from("run_receipts")
    .insert({
      mode: input.mode,
      subject: input.subject,
      model: input.model ?? null,
      budget_usdc: input.budgetUsdc,
      spent_usdc: input.spentUsdc,
      payer_kind: input.payerKind,
      payload: input.payload,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not save run receipt: ${error.message}`);
  return data.id as string;
}

export async function startRunReceipt(input: StartRunReceiptInput): Promise<StartedRunReceipt> {
  const idempotencyKeyHash = input.idempotencyKey?.trim()
    ? sha256Hex(input.idempotencyKey.trim())
    : null;
  const idempotencyScope = idempotencyKeyHash ? input.idempotencyScope?.trim() || "global" : null;

  const row = {
    mode: input.mode,
    subject: input.subject,
    model: input.model ?? null,
    budget_usdc: input.budgetUsdc,
    spent_usdc: 0,
    payer_kind: input.payerKind,
    payload: input.payload ?? {},
    status: "running",
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
    idempotency_scope: idempotencyScope,
    idempotency_key_hash: idempotencyKeyHash,
  };

  const { data, error } = await admin()
    .from("run_receipts")
    .insert(row)
    .select("*")
    .single();

  if (!error && data) {
    return { id: data.id as string, migrated: true, replay: false, receipt: mapReceipt(data) };
  }

  if (error && idempotencyScope && idempotencyKeyHash && isUniqueViolation(error)) {
    const existing = await getRunReceiptByIdempotency(idempotencyScope, idempotencyKeyHash);
    if (existing) {
      return {
        id: existing.id,
        migrated: true,
        replay: true,
        receipt: existing,
      };
    }
  }

  if (error && isRunStateColumnError(error.message)) {
    return { id: null, migrated: false, replay: false, receipt: null };
  }

  throw new Error(`Could not start run receipt: ${error?.message ?? "empty database response"}`);
}

export async function getRunReceiptByIdempotencyKey(
  idempotencyScope: string,
  idempotencyKey: string | null,
): Promise<RunReceipt | null> {
  const key = idempotencyKey?.trim();
  if (!key) return null;
  try {
    return await getRunReceiptByIdempotency(idempotencyScope, sha256Hex(key));
  } catch (err) {
    if (isRunStateColumnError((err as Error).message)) return null;
    throw err;
  }
}

export async function completeRunReceipt(
  runId: string | null,
  input: SaveRunReceiptInput,
): Promise<string> {
  if (!runId) {
    return saveRunReceipt(input);
  }

  const { data, error } = await admin()
    .from("run_receipts")
    .update({
      mode: input.mode,
      subject: input.subject,
      model: input.model ?? null,
      budget_usdc: input.budgetUsdc,
      spent_usdc: input.spentUsdc,
      payer_kind: input.payerKind,
      payload: input.payload,
      status: "completed",
      completed_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", runId)
    .select("id")
    .single();

  if (error && isRunStateColumnError(error.message)) {
    return saveRunReceipt(input);
  }
  if (error) throw new Error(`Could not complete run receipt: ${error.message}`);
  return data.id as string;
}

export async function failRunReceipt(
  runId: string | null,
  input: Omit<SaveRunReceiptInput, "spentUsdc"> & { spentUsdc?: number },
  errorMessage: string,
): Promise<string | null> {
  if (!runId) return null;

  const { data, error } = await admin()
    .from("run_receipts")
    .update({
      mode: input.mode,
      subject: input.subject,
      model: input.model ?? null,
      budget_usdc: input.budgetUsdc,
      spent_usdc: input.spentUsdc ?? 0,
      payer_kind: input.payerKind,
      payload: input.payload,
      status: "failed",
      completed_at: new Date().toISOString(),
      error: errorMessage,
    })
    .eq("id", runId)
    .select("id")
    .single();

  if (error && isRunStateColumnError(error.message)) return null;
  if (error) throw new Error(`Could not fail run receipt: ${error.message}`);
  return data.id as string;
}

export async function getRunReceipt(id: string): Promise<RunReceipt | null> {
  const { data, error } = await admin()
    .from("run_receipts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return mapReceipt(data);
}

async function getRunReceiptByIdempotency(
  idempotencyScope: string,
  idempotencyKeyHash: string,
): Promise<RunReceipt | null> {
  const { data, error } = await admin()
    .from("run_receipts")
    .select("*")
    .eq("idempotency_scope", idempotencyScope)
    .eq("idempotency_key_hash", idempotencyKeyHash)
    .single();

  if (error || !data) return null;
  return mapReceipt(data);
}

function isUniqueViolation(error: { code?: string; message?: string }) {
  return error.code === "23505" || /duplicate|unique/i.test(error.message ?? "");
}

function isRunStateColumnError(message: string) {
  return /status|started_at|completed_at|idempotency_scope|idempotency_key_hash/.test(message);
}
