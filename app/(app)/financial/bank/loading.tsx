import type { CSSProperties } from "react";
import { cookies } from "next/headers";
import AppShell from "@/components/layout/AppShell";
import { BANK_STRIP_COOKIE, bankStripStyle } from "@/lib/ui/bank-strip-height";
import BankSkeleton from "./BankSkeleton";

// Streamed instantly while the accounts and their registers load, so TTFB =
// time-to-shell. The page's own shape (it used to get the cash-flow page's):
// the account strip, the open account's register and the note under it.
export default async function BankLoading() {
  // The strip as tall as it last stood on this device (lib/ui/bank-strip-height.ts).
  const strip = bankStripStyle((await cookies()).get(BANK_STRIP_COOKIE)?.value);
  return (
    <AppShell>
      <div className="contents" style={strip as CSSProperties | undefined}>
        <BankSkeleton routeLoading />
      </div>
    </AppShell>
  );
}
