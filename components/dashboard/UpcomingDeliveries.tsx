import Link from "next/link";
import { Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getOrderStatusColor, getOrderStatusLabel } from "@/lib/ui/status-colors";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import type { DeliveryItem } from "@/app/sales/loadDeliveries";

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
        <table className="w-full text-right text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">הזמנה</th>
              <th className="px-4 py-2 font-medium">לקוח</th>
              <th className="px-4 py-2 font-medium">עיר</th>
              <th className="px-4 py-2 font-medium">סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((delivery) => (
              <tr key={delivery.id} className="border-b last:border-0 transition-colors hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <Link href={`/sales/orders/${delivery.id}`} className="font-semibold hover:underline">
                    {orderRef(delivery.id)}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <InitialsAvatar name={delivery.customerName} />
                    <span className="truncate">{delivery.customerName}</span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{delivery.city}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={COLOR_TO_VARIANT[getOrderStatusColor(delivery.status)]}>
                    {getOrderStatusLabel(delivery.status)}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
