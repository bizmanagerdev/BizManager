"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeliveryIcon, WarehouseIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import Sparkline from "@/components/charts/Sparkline";
import QuietCard from "@/components/dashboard/QuietCard";
import { ContactTapZone } from "@/components/ui/contact-link";
import DeliveryShareActions from "@/app/(app)/sales/DeliveryShareActions";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import PickingListDialog from "@/app/(app)/sales/PickingListDialog";
import { clickableRowProps } from "@/lib/ui/row-navigation";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

/**
 * "משלוחים קרובים" — the next open deliveries.
 *
 * Everything here is a click target, and nothing is a button to a page: the ROW
 * jumps to the delivery queue focused on that one delivery (not the order
 * screen — this card is about what's going out, not the order behind it), and
 * the card around it opens the queue unfocused. No status badge either — this
 * list is open deliveries by definition, so the badge said "פתוח" on every line.
 *
 * The two things you'd actually do to a delivery ride on the row: share the slip
 * (DeliveryShareActions) and confirm it (OrderConfirmDialog, "סמן כסופק"). Both
 * are the queue's own components, so the two surfaces can't drift.
 *
 * The order id (#a1b2c3d4) and the initials circle were both dropped — the id is
 * an internal handle nobody reads off a dashboard, and the circle was built from
 * the customer's name, so a screen of them was a column of near-identical
 * two-letter blobs that identified nothing.
 */
export default function UpcomingDeliveries({
  deliveries,
  spark,
  canOpenOrder = true,
}: {
  deliveries: DeliveryItem[];
  /** Orders dated per day over the last week, oldest first. */
  spark?: number[];
  /** False for a worker: /sales is staff-only, so the row would dead-end. */
  canOpenOrder?: boolean;
}) {
  const router = useRouter();

  // Nothing open → one quiet line rather than a card that disappears. See
  // QuietCard for why an absent card is worse than an empty one.
  if (deliveries.length === 0) {
    return (
      <QuietCard
        icon={DeliveryIcon}
        title="משלוחים קרובים"
        note="אין משלוחים פתוחים"
        href={canOpenOrder ? "/sales?tab=deliveries" : "/deliveries"}
      />
    );
  }
  const rows = deliveries.slice(0, 6);
  const allHref = canOpenOrder ? "/sales?tab=deliveries" : "/deliveries";
  // Always the delivery queue, focused on that one row — never the order
  // screen. This card is the delivery run, not the sale behind it; the order
  // is still one click away from the queue for staff who need it.
  const hrefFor = (id: string) =>
    `${allHref}${allHref.includes("?") ? "&" : "?"}focus=${encodeURIComponent(id)}`;

  return (
    // The card itself is one big overlay link (it sits under `pointer-events-none`
    // content, and each row re-enables pointer events to opt back in). A row is
    // NOT a second overlay link, though — that would sit on top of the customer
    // name/phone and block native long-press-to-copy. Instead each row navigates
    // via its own onClick/onKeyDown, skipping the interactive bits inside it
    // (shouldIgnoreRowNavigation) — same pattern the deliveries queue itself uses.
    <Card className="relative flex h-full flex-col">
      <Link
        href={allHref}
        aria-label="כל המשלוחים"
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader
          icon={DeliveryIcon}
          title="משלוחים קרובים"
          count={deliveries.length}
          spark={
            spark ? (
              <Sparkline points={spark} variant="bar" valueLabel="הזמנות היום" label="7 הימים האחרונים" />
            ) : undefined
          }
          action={
            // Opens right here on the dashboard — not a navigation. The plain
            // <button> below carries no handler of its own; PickingListDialog
            // clones it and wires up the click.
            <PickingListDialog
              trigger={
                // pointer-events-auto: the header otherwise sits inside the
                // card's pointer-events-none wrapper (see the comment at the
                // top of this file) — same reason the row actions below carry
                // the same class.
                <button
                  type="button"
                  aria-label="רשימת ליקוט למחסן"
                  title="רשימת ליקוט למחסן"
                  className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-lg text-secondary hover:bg-secondary/10"
                >
                  <WarehouseIcon className="h-4 w-4" />
                </button>
              }
            />
          }
        />

        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          <ul className="board-list divide-y">
            {rows.map((delivery) => (
              <li
                key={delivery.id}
                aria-label={`פרטי המשלוח — ${delivery.customerName}`}
                {...clickableRowProps(() => router.push(hrefFor(delivery.id)))}
                className="pointer-events-auto relative cursor-pointer px-4 py-3 transition-colors hover:bg-secondary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/* items-center: the action reads as belonging to the whole row,
                    not to its first line. */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    {/* The ONE place in the app that truncates (user, 2026-08-18:
                        "if the name doesn't fit put 3 dots so all rows are
                        consistent"). Every other surface wraps — see the
                        never-truncate rule — but here a two-line name made its row
                        taller than its neighbours, and a column of rows that don't
                        line up reads as broken. The full name is in the title
                        attribute and one click away on the order. */}
                    <div className="truncate text-sm font-medium" title={delivery.customerName}>
                      {delivery.customerName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {delivery.city}
                      {delivery.customerPhone ? (
                        <>
                          {" · "}
                          {/* A <div>, not an <a href="tel:…"> — an actual tel:
                              link claims long-press for the browser's OWN menu,
                              which on this row wasn't surfacing a copy option at
                              all. Plain text long-presses into normal selection
                              instead (same as the name beside it), and tapping
                              still calls/copies via JS. The wrapping span stops
                              that tap/Enter from also bubbling into the row's
                              own navigate handler — ContactTapZone doesn't take
                              an onClick override of its own to do this itself. */}
                          <span
                            className="inline-block"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <ContactTapZone kind="tel" value={delivery.customerPhone} className="inline-block">
                              <span dir="ltr" className="tabular-nums">
                                {delivery.customerPhone}
                              </span>
                            </ContactTapZone>
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {/* Both actions ride in the corner the status badge used to
                      occupy, on the customer's line. */}
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* A bare glyph, no button plate — an icon-only control, which
                        is the one thing exempt from "every button gets a fill". */}
                    <DeliveryShareActions
                      delivery={delivery}
                      label=""
                      variant="ghost"
                      className="h-8 w-8 p-0 shadow-none max-md:min-h-[44px] max-md:min-w-[44px]"
                    />
                    {/* OUTLINE, not filled (user, 2026-08-18, from a reference
                        board): one filled button per row down four cards made the
                        board a column of blue blocks, with the action shouting
                        louder than the delivery it belonged to. */}
                    <OrderConfirmDialog
                      orderId={delivery.id}
                      customerName={delivery.customerName}
                      buttonVariant="outline"
                      buttonClassName="h-8 px-3 text-sm max-md:min-h-[44px]"
                      buttonLabel="סופק"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
        <DashboardCardFooter href={allHref} label="כל המשלוחים" count={deliveries.length} />
      </div>
    </Card>
  );
}
