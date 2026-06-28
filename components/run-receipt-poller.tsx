"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RunReceiptPoller({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [active, router]);

  return null;
}
