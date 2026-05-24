"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatOrderDate } from "@/lib/orders/format";
import {
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
} from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

type OrderView = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customerAddress: string | null;
  orderDate: string | null;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  totalPaid: number;
  remainingBalance: number;
};

function getString(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getNumber(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function normalizeOrderStatus(value: string | null) {
  switch ((value ?? "").trim().toLowerCase()) {
    case "פתוחה":
    case "draft":
      return "draft";
    case "מאושרת":
    case "reserved":
    case "confirmed":
      return "confirmed";
    case "בטיפול":
    case "processing":
      return "processing";
    case "במשלוח":
    case "out_for_delivery":
      return "out_for_delivery";
    case "סופקה":
    case "delivered":
      return "delivered";
    case "הושלמה":
    case "completed":
      return "completed";
    case "סגורה":
    case "closed":
      return "closed";
    case "בוטלה":
    case "cancelled":
      return "cancelled";
    default:
      return value?.trim() || "draft";
  }
}

export function orderStatusBadgeClasses(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "draft":
      return "bg-destructive text-destructive-foreground border-transparent";
    case "delivered":
    case "completed":
    case "closed":
      return "bg-success text-success-foreground border-transparent";
    case "confirmed":
    case "processing":
    case "out_for_delivery":
      return "bg-warning text-warning-foreground border-transparent";
    case "cancelled":
      return "border-border bg-background text-muted-foreground";
    default:
      return "bg-warning text-warning-foreground border-transparent";
  }
}

function isActiveOrder(status: string) {
  return !["closed", "cancelled", "delivered", "completed"].includes(normalizeOrderStatus(status));
}

function shouldShowPaymentAction(row: OrderView) {
  return row.remainingBalance > 0.009 || row.totalPaid > row.totalAmount + 0.009;
}

export default function SalesOrdersClient({ orders }: { orders: Row[] }) {
  const [query, setQuery] = useState("");
  const [paymentSnapshot] = useState(() => new Map<string, number>());

  const orderRows = useMemo(() => {
    const mappedOrders = orders.map<OrderView | null>((row) => {
      const id = getString(row, ["order_id", "id"]);
      const customerId = getString(row, ["customer_id"]);
      if (!id || !customerId) return null;

      const totalAmount = getNumber(row, ["total_amount"]) ?? 0;
      const dbPaidAmount = getNumber(row, ["total_paid"]) ?? 0;
      const totalPaid = paymentSnapshot.has(id) ? paymentSnapshot.get(id) ?? dbPaidAmount : dbPaidAmount;
      const remainingBalance = Math.max(totalAmount - totalPaid, 0);

      return {
        id,
        customerId,
        customerName: getString(row, ["customer_name"]) ?? customerId,
        customerEmail: getString(row, ["customer_email"]),
        customerPhone: getString(row, ["customer_phone"]),
        customerCity: getString(row, ["customer_city"]),
        customerAddress: getString(row, ["customer_address"]),
        orderDate: getString(row, ["order_date", "created_at"]),
        status: normalizeOrderStatus(getString(row, ["status"])),
        paymentStatus: derivePaymentStatus(totalAmount, totalPaid),
        totalAmount,
        totalPaid,
        remainingBalance,
      };
    });

    return mappedOrders.filter((row): row is OrderView => row !== null);
  }, [orders, paymentSnapshot]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orderRows;

    return orderRows.filter((row) => {
      return (
        row.id.toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        (row.customerEmail ?? "").toLowerCase().includes(q) ||
        (row.customerPhone ?? "").toLowerCase().includes(q) ||
        (row.customerCity ?? "").toLowerCase().includes(q)
      );
    });
  }, [orderRows, query]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי לקוח, טלפון, אימייל, עיר או מספר הזמנה"
            className="h-11 pr-10"
          />
        </div>

        <div className="text-xs text-muted-foreground">
          טיפ: אפשר לחפש גם לפי מספר הזמנה חלקי, לדוגמה `a1b2c3d4`.
        </div>
      </div>

      <div className="text-sm text-muted-foreground">נמצאו {filteredRows.length} הזמנות</div>

      {filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            לא נמצאו הזמנות לפי החיפוש.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-border/70 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr className="border-b border-border/70 text-right">
                  <th className="px-4 py-3 font-medium">הזמנה</th>
                  <th className="px-4 py-3 font-medium">לקוח</th>
                  <th className="px-4 py-3 font-medium">עיר ותאריך</th>
                  <th className="px-4 py-3 font-medium">סטטוס הזמנה</th>
                  <th className="px-4 py-3 font-medium">סטטוס תשלום</th>
                  <th className="px-4 py-3 font-medium">סכום</th>
                  <th className="px-4 py-3 font-medium">שולם</th>
                  <th className="px-4 py-3 font-medium">יתרה</th>
                  <th className="px-4 py-3 font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-muted/20">
                    <td className="px-4 py-4">
                      <div className="font-medium">הזמנה #{row.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-[220px]">
                        <div className="font-medium">{row.customerName}</div>
                        <div className="mt-1 text-muted-foreground">{row.customerPhone ?? "-"}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-[140px]">
                        <div>{row.customerCity ?? "-"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{formatOrderDate(row.orderDate)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={row.status} type="order" className={orderStatusBadgeClasses(row.status)} />
                    </td>
                    <td className="px-4 py-4">
                      <Badge className={paymentStatusClasses(row.paymentStatus)}>
                        {paymentStatusLabel(row.paymentStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 font-medium">{formatCurrency(row.totalAmount)}</td>
                    <td className="px-4 py-4">{formatCurrency(row.totalPaid)}</td>
                    <td className="px-4 py-4">{formatCurrency(row.remainingBalance)}</td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[240px] flex-wrap gap-2">
                        <Button asChild size="sm" onClick={() => emitNavigationStart()}>
                          <Link href={`/sales/orders/${row.id}`}>צפייה בהזמנה</Link>
                        </Button>
                        {isActiveOrder(row.status) ? (
                          <OrderConfirmDialog orderId={row.id} buttonLabel="אישור אספקה" />
                        ) : shouldShowPaymentAction(row) ? (
                          <OrderPaymentDialog
                            orderId={row.id}
                            totalAmount={row.totalAmount}
                            paidAmount={row.totalPaid}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
