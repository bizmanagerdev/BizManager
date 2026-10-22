import type { ReactNode } from "react";
import Link from "next/link";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// The desktop head of an order page — where you are (מכירות › customer) and the
// handful of things you can do to the order — in the top bar (owner,
// 2026-10-22: "move the two buttons up and the sales and the sale name up into
// the top bar"; TopBarHeading), so the page starts with its cards. Its own
// component so the page and the preview shown while the page loads
// (OrderPagePreview) put the same thing there. On the phone the customer name
// and the order are in the bar's title, and the actions in its ⋮ — they
// register from the actions rendered here (OrderHeaderMenu). Everything this
// line used to say — order date, how long ago, who entered it — is in the
// סטטוס הזמנה card.

export default function OrderPageHeading({
  customerId,
  customerName,
  customerDisplayName,
  actions,
}: {
  customerId: string | null;
  customerName: string;
  customerDisplayName: string;
  /** Its edit and ⋮ (OrderHeaderMenu). */
  actions?: ReactNode;
}) {
  return (
    <TopBarHeading
      section="מכירות"
      href="/sales"
      title={
        customerId ? (
          <Link href={`/customers/${customerId}`} className="min-w-0 truncate hover:underline">
            {customerDisplayName}
          </Link>
        ) : (
          <span className="min-w-0 truncate">{customerName}</span>
        )
      }
      actions={actions}
    />
  );
}
