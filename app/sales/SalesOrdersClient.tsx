"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import OrderDetailsDialog from "@/app/sales/orders/OrderDetailsDialog";
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

export function statusLabel(value: string) {
  switch (normalizeOrderStatus(value)) {
    case "draft":
      return "פתוחה";
    case "confirmed":
      return "מאושרת";
    case "processing":
      return "בטיפול";
    case "out_for_delivery":
      return "במשלוח";
    case "delivered":
      return "סופקה";
    case "completed":
      return "הושלמה";
    case "closed":
      return "סגורה";
    case "cancelled":
      return "בוטלה";
    default:
      return value || "-";
  }
}

export function orderStatusBadgeClasses(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "delivered":
    case "completed":
    case "closed":
      return "border-transparent bg-emerald-100 text-black";
    case "draft":
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

function orderStatusBorderClasses(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "delivered":
    case "completed":
    case "closed":
      return "border-emerald-300";
    case "draft":
    case "confirmed":
    case "processing":
    case "out_for_delivery":
      return "border-orange-300";
    case "cancelled":
      return "border-rose-300";
    default:
      return "border-orange-300";
  }
}

function isActiveOrder(status: string) {
  return !["closed", "cancelled", "delivered", "completed"].includes(normalizeOrderStatus(status));
}

export default function SalesOrdersClient({ orders }: { orders: Row[] }) {
  const [query, setQuery] = useState("");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [paymentSnapshot] = useState(() => new Map<string, number>());

  const orderRows = useMemo(() => {
    return orders
      .map((row) => {
        const id = getString(row, ["order_id", "id"]);
        const customerId = getString(row, ["customer_id"]);
        if (!id || !customerId) return null;

        const totalAmount = getNumber(row, ["total_amount"]) ?? 0;
        const dbPaidAmount = getNumber(row, ["total_paid"]) ?? 0;
        const totalPaid =
          paymentSnapshot.has(id) ? paymentSnapshot.get(id) ?? dbPaidAmount : dbPaidAmount;

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
        } as OrderView;
      })
      .filter((row): row is OrderView => row !== null);
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

  const hasActiveFilters =
    query.trim().length > 0 ||
    activityFilter !== "all" ||
    cityFilter !== "all";

  function clearFilters() {
    setQuery("");
    setActivityFilter("all");
    setCityFilter("all");
  }

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-gradient-to-b from-background to-muted/20">
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

      <div className="hidden rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[180px_220px_minmax(320px,1fr)_320px] md:items-center md:gap-4 sm:px-4">
        <div>הזמנה</div>
        <div>סטטוס</div>
        <div className="grid grid-cols-3 gap-3">
          <div>לקוח</div>
          <div>סכום</div>
          <div>שולם</div>
        </div>
        <div>פעולות</div>
      </div>

      <div className="grid gap-2 sm:gap-2.5">
        {filteredRows.map((row) => (
          <Card key={row.id} className={`border-2 ${orderStatusBorderClasses(row.status)}`}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 md:grid md:grid-cols-[180px_220px_minmax(320px,1fr)_320px] md:items-center md:gap-4">
                <div className="space-y-1">
                  
                    <CardTitle className="text-base">הזמנה #{row.id.slice(0, 8)}</CardTitle>
                    <div className="text-xs text-muted-foreground">{formatOrderDate(row.orderDate)}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:min-w-0">
                    <StatusBadge value={row.status} type="order" />
                    <Badge className={paymentStatusClasses(row.paymentStatus)}>
                      {paymentStatusLabel(row.paymentStatus)}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-sm md:min-w-0">
                    <div className="min-w-0">
                      <div className="truncate">{row.customerName}</div>
                    </div>
                    <div className="min-w-0">
                      <div>{formatCurrency(row.totalAmount)}</div>
                    </div>
                    <div className="min-w-0">
                      <div>{formatCurrency(row.totalPaid)}</div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap sm:items-center md:justify-start md:gap-2">
                  <OrderDetailsDialog orderId={row.id} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {filteredRows.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">
              לא נמצאו הזמנות לפי הסינון שנבחר.
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
