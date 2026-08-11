import Link from "next/link";
import { DeliveryIcon } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getOrderStatusColor, getOrderStatusLabel } from "@/lib/ui/status-colors";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

const COLOR_TO_VARIANT = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  neutral: "neutral",
} as const;

/**
 * "משלוחים קרובים" — the next open deliveries.
 *
 * Each row answers one question: who, where, and what state is it in. The order
 * id (#a1b2c3d4) and the initials circle were both dropped — the id is an
 * internal handle nobody reads off a dashboard, and the circle was built from
 * the customer's name, so a screen of them was a column of near-identical
 * two-letter blobs that identified nothing. Tapping a row opens that delivery in
 * the queue (`?focus=` scrolls to it and flashes it), which is where the address,
 * the items and the actions live.
 */
export default function UpcomingDeliveries({
  deliveries,
  canOpenOrder = true,
}: {
  deliveries: DeliveryItem[];
  /** False for a worker: /sales is staff-only, so the row would dead-end. */
  canOpenOrder?: boolean;
}) {
  if (deliveries.length === 0) return null;
  const rows = deliveries.slice(0, 6);
  const allHref = canOpenOrder ? "/sales?tab=deliveries" : "/deliveries";
  const hrefFor = (id: string) =>
    canOpenOrder ? `/sales/orders/${id}` : `/deliveries?focus=${encodeURIComponent(id)}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DeliveryIcon className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">משלוחים קרובים</CardTitle>
          </div>
          <Link href={allHref} className="text-sm text-secondary hover:underline">
            כל המשלוחים ›
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((delivery) => (
            <li key={delivery.id}>
              <Link
                href={hrefFor(delivery.id)}
                className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  {/* Wraps rather than truncating — half a customer's name reads
                      as a bug, and this is the one thing the row is for. */}
                  <div className="font-medium break-words">{delivery.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {delivery.city}
                    {delivery.customerPhone ? (
                      <>
                        {" · "}
                        <span dir="ltr" className="inline-block">
                          {delivery.customerPhone}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Badge
                  variant={COLOR_TO_VARIANT[getOrderStatusColor(delivery.status)]}
                  className="shrink-0"
                >
                  {getOrderStatusLabel(delivery.status)}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
