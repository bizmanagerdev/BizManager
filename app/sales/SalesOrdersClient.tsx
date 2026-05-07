"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
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
      return "border-transparent bg-red-100 text-red-800";
    case "delivered":
    case "completed":
    case "closed":
      return "border-transparent bg-emerald-100 text-black";
    case "confirmed":
    case "processing":
    case "out_for_delivery":
      return "border-transparent bg-orange-100 text-black";
    case "cancelled":
      return "border-transparent bg-rose-100 text-black";
    default:
      return "border-transparent bg-orange-100 text-black";
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
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [cityFilter, setCityFilter] = useState("all");
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

  const cities = useMemo(() => {
    const set = new Set<string>();
    orderRows.forEach((row) => {
      if (row.customerCity) set.add(row.customerCity);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [orderRows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();

    return orderRows.filter((row) => {
      if (activityFilter === "active" && !isActiveOrder(row.status)) return false;
      if (activityFilter === "inactive" && isActiveOrder(row.status)) return false;
      if (cityFilter !== "all" && (row.customerCity ?? "") !== cityFilter) return false;
      if (!q) return true;

      return (
        row.id.toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        (row.customerEmail ?? "").toLowerCase().includes(q) ||
        (row.customerPhone ?? "").toLowerCase().includes(q) ||
        (row.customerCity ?? "").toLowerCase().includes(q)
      );
    });
  }, [orderRows, query, activityFilter, cityFilter]);

  const hasActiveFilters = query.trim().length > 0 || activityFilter !== "all" || cityFilter !== "all";

  function clearFilters() {
    setQuery("");
    setActivityFilter("all");
    setCityFilter("all");
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/70 bg-card shadow-sm">
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח, טלפון, אימייל, עיר או מספר הזמנה"
                className="h-11 pr-10"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="inline-flex rounded-lg border border-input bg-background p-1">
                <Button
                  type="button"
                  variant={activityFilter === "all" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => setActivityFilter("all")}
                >
                  הכל
                </Button>
                <Button
                  type="button"
                  variant={activityFilter === "active" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => setActivityFilter("active")}
                >
                  פעילות
                </Button>
                <Button
                  type="button"
                  variant={activityFilter === "inactive" ? "default" : "ghost"}
                  size="sm"
                  className="h-8 px-3"
                  onClick={() => setActivityFilter("inactive")}
                >
                  לא פעילות
                </Button>
              </div>
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="h-11 min-w-[170px] rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">כל הערים</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className={hasActiveFilters ? "" : "invisible pointer-events-none"}
                aria-hidden={!hasActiveFilters}
                tabIndex={hasActiveFilters ? 0 : -1}
              >
                <X className="ml-1 h-4 w-4" />
                ניקוי
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            טיפ: אפשר לחפש גם לפי מספר הזמנה חלקי, לדוגמה `a1b2c3d4`.
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">נמצאו {filteredRows.length} הזמנות</div>
        <Badge
          variant="outline"
          className={`text-xs ${hasActiveFilters ? "" : "invisible pointer-events-none"}`}
          aria-hidden={!hasActiveFilters}
        >
          מוצג לפי סינון
        </Badge>
      </div>

      {filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            לא נמצאו הזמנות לפי הסינון שנבחר.
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
