import { createClient } from "@supabase/supabase-js";

export type ReceiptMode = "real" | "benchmark";

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
  mode: ReceiptMode;
  subject: string;
  model: string | null;
  budgetUsdc: number | null;
  spentUsdc: number | null;
  payerKind: string;
  payload: Record<string, unknown>;
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

export async function getRunReceipt(id: string): Promise<RunReceipt | null> {
  const { data, error } = await admin()
    .from("run_receipts")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return mapReceipt(data);
}
