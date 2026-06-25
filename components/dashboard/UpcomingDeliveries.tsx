import Link from "next/link";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getOrderStatusColor, getOrderStatusLabel } from "@/lib/ui/status-colors";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

const COLOR_TO_VARIANT = {
  success: "success",
  warning: "warning",
  danger: "destructive",
  info: "info",
  neutral: "neutral",
} as const;

/** Short order reference, e.g. the last segment / first 6 chars of the id. */
function orderRef(id: string) {
  return `#${id.slice(0, 8)}`;
}

/** "מסירות קרובות" — the next open deliveries as a compact table. */
export default function UpcomingDeliveries({ deliveries }: { deliveries: DeliveryItem[] }) {
  if (deliveries.length === 0) return null;
  const rows = deliveries.slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">משלוחים קרובים</CardTitle>
          </div>
          <Link href="/sales?tab=deliveries" className="text-sm text-secondary hover:underline">
            כל המשלוחים ›
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((delivery) => (
            <li key={delivery.id}>
              <Link
                href={`/sales/orders/${delivery.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <InitialsAvatar name={delivery.customerName} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{delivery.customerName}</span>
                    {delivery.customerPhone ? (
                      <span className="shrink-0 text-xs text-muted-foreground" dir="ltr">
                        {delivery.customerPhone}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="font-mono">{orderRef(delivery.id)}</span>
                    {delivery.city ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="truncate">{delivery.city}</span>
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
