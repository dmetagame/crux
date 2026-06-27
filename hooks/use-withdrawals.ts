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

export type Withdrawal = {
  id: string;
  created_at: string;
  amount_usdc: string;
  destination_chain: string;
  destination_address: string;
  status: "submitted" | "confirmed" | "failed";
  tx_hash: string | null;
};

export function useWithdrawals() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchWithdrawals() {
      try {
        const res = await fetch("/api/dashboard/withdrawals", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch withdrawals");
        if (!cancelled) setWithdrawals(data.withdrawals as Withdrawal[]);
      } catch (err) {
        console.error("Failed to fetch withdrawals:", (err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchWithdrawals();
    const id = setInterval(fetchWithdrawals, 8000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { withdrawals, loading };
}
