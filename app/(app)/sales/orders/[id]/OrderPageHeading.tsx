import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon } from "@/components/ui/icons";

// The desktop head of an order page: where you are (מכירות ‹ customer) and the
// handful of things you can do to the order. Its own component so the page and
// the preview shown while the page loads (OrderPagePreview) draw the same
// thing — the preview's heading must sit exactly where the real one lands.
// Desktop chrome only: on the phone the customer name and the order are in the
// top bar, so a "מכירות ‹ name" line here would be a repeat. Everything this
// line used to say — order date, how long ago, who entered it — is in the
// סטטוס הזמנה card now.

export default function OrderPageHeading({
  customerId,
  customerName,
  customerDisplayName,
  actions,
}: {
  customerId: string | null;
  customerName: string;
  customerDisplayName: string;
  /** Desktop only — on the phone these live at the foot of the page. */
  actions?: ReactNode;
}) {
  return (
    <div className="hidden space-y-2 lg:block">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <nav
          className="hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground lg:flex"
          aria-label="ניווט"
        >
          <Link href="/sales" className="hover:text-foreground hover:underline">
            מכירות
          </Link>
          <ChevronLeftIcon className="h-3.5 w-3.5 shrink-0" />
          <h1 className="min-w-0 text-lg font-bold text-foreground">
            {customerId ? (
              <Link href={`/customers/${customerId}`} className="hover:underline">
                {customerDisplayName}
              </Link>
            ) : (
              customerName
            )}
          </h1>
        </nav>
        {actions ? <div className="hidden shrink-0 flex-wrap items-center gap-2 lg:flex">{actions}</div> : null}
      </div>
    </div>
  );
}
