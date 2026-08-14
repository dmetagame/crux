import { z } from "zod";
import { configuredDefaultAgentModel } from "./agent-model-defaults.ts";

export const benchmarkAgentRequest = z.object({
  topic: z.string().trim().min(1).max(160).default("Northwind Logistics"),
  model: z.string().trim().min(1).max(160).default(configuredDefaultAgentModel()),
  budget: z.number().finite().positive().max(1).default(0.05),
  seed: z.string().trim().max(80).default("demo"),
});

export const realAgentRequest = z.object({
  subject: z.string().trim().min(1).max(240).default("OpenAI"),
  model: z.string().trim().min(1).max(160).default(configuredDefaultAgentModel()),
  budget: z.number().finite().positive().max(1).default(0.03),
  walletId: z.string().uuid().nullable().optional().default(null),
});

export const baselineAgentRequest = z.object({
  topic: z.string().trim().min(1).max(160).default("Northwind Logistics"),
  strategy: z.enum(["cheapest", "quality", "preview"]).default("cheapest"),
  budget: z.number().finite().positive().max(1).default(0.05),
  seed: z.string().trim().max(80).default("demo"),
});

export async function parseAgentBody(req: Request) {
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
