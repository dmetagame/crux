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

import { useEffect, useState } from "react";
import type { SettlementKind, SettlementStatus } from "@/lib/settlement";

export type PaymentEvent = {
  id: string;
  created_at: string;
  endpoint: string;
  payer: string;
  amount_usdc: string;
  amount_atomic?: string | null;
  network: string;
  gateway_tx: string | null;
  settlement_reference: string | null;
  settlement_kind: SettlementKind;
  settlement_status: SettlementStatus;
  arc_tx_hash: string | null;
  arc_chain_id: number | null;
  arc_block_number: string | null;
  arc_confirmed_at: string | null;
  settlement_checked_at: string | null;
  raw?: Record<string, unknown> | null;
  facilitator_requirements?: Record<string, unknown> | null;
  facilitator_verify?: Record<string, unknown> | null;
  facilitator_settle?: Record<string, unknown> | null;
};

export function usePaymentEvents() {
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvents() {
      try {
        const res = await fetch("/api/dashboard/payments", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch payment events");
        if (!cancelled) setEvents(data.events as PaymentEvent[]);
      } catch (err) {
        console.error("Failed to fetch payment events:", (err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();
    const id = setInterval(fetchEvents, 8000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { events, loading };
}
