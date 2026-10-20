"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the current server page every few seconds while mounted. */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(id);
  }, [router, everyMs]);
  return null;
}
