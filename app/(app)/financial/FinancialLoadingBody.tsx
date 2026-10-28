"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// /financial's loading screen is also the first thing shown on the way to every
// page under it: the router puts it around them, and a page's own loading
// screen (bank/loading.tsx) only comes in the next chunk. So it looks at the
// address — the accounts page gets its own shape, not the cash-flow page's,
// which flashed before it (2026-10-28).

export default function FinancialLoadingBody({ cashFlow, bank }: { cashFlow: ReactNode; bank: ReactNode }) {
  const pathname = usePathname() ?? "/financial";
  return pathname === "/financial/bank" || pathname.startsWith("/financial/bank/") ? bank : cashFlow;
}
