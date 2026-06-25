/**
 * Objective scorer for a due-diligence brief, parameterized by topic.
 *
 * Grades a brief by how many weighted ground-truth facts it captured for the
 * given company, and flags whether it ingested that company's misleading rumor
 * as fact. The content→fact mapping lives in each Topic (lib/marketplace.ts);
 * the delivered source content carries no answer-key tags.
 */
import { resolveTopic } from "./marketplace.ts";

export interface BriefScore {
  topic: string;
  capturedFacts: { id: string; weight: number; fact: string }[];
  missedFacts: { id: string; weight: number; fact: string }[];
  weighted: number;
  maxWeighted: number;
  coverage: number; // 0..1
  falseClaim: boolean;
}

export function scoreBrief(brief: string, factsClaimed: string[] = [], topic = "northwind"): BriefScore {
  const t = resolveTopic(topic);
  if (!t) {
    throw new Error(`Unknown topic for scoring: ${topic}`);
  }
  const text = `${brief}\n${factsClaimed.join("\n")}`.toLowerCase();

  const captured: BriefScore["capturedFacts"] = [];
  const missed: BriefScore["missedFacts"] = [];
  for (const f of t.groundTruth) {
    const entry = { id: f.id, weight: f.weight, fact: f.fact };
    (f.match(text) ? captured : missed).push(entry);
  }

  const weighted = captured.reduce((s, f) => s + f.weight, 0);
  const maxWeighted = t.groundTruth.reduce((s, f) => s + f.weight, 0);
  return {
    topic: t.name,
    capturedFacts: captured,
    missedFacts: missed,
    weighted,
    maxWeighted,
    coverage: maxWeighted === 0 ? 0 : weighted / maxWeighted,
    falseClaim: t.falseClaim(text),
  };
}
