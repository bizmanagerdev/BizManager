"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

function statusLabel(value: string) {
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

function orderStatusClasses(status: string) {
  switch (normalizeOrderStatus(status)) {
    case "confirmed":
    case "completed":
      return "border-transparent bg-emerald-100 text-emerald-800";
    case "processing":
    case "out_for_delivery":
      return "border-transparent bg-amber-100 text-amber-800";
    case "delivered":
    case "closed":
      return "border-transparent bg-slate-200 text-slate-800";
    case "cancelled":
      return "border-transparent bg-rose-100 text-rose-800";
    default:
      return "border-transparent bg-sky-100 text-sky-800";
  }
}

function isActiveOrder(status: string) {
  return !["closed", "cancelled", "delivered", "completed"].includes(normalizeOrderStatus(status));
}

export default function SalesOrdersClient({ orders }: { orders: Row[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "closed">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [paymentSnapshot, setPaymentSnapshot] = useState(() => new Map<string, number>());

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

  const statuses = useMemo(() => {
    const set = new Set<string>();
    orderRows.forEach((row) => set.add(row.status));
    return Array.from(set).sort();
  }, [orderRows]);

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
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (activityFilter === "active" && !isActiveOrder(row.status)) return false;
      if (activityFilter === "closed" && isActiveOrder(row.status)) return false;
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
  }, [orderRows, query, statusFilter, activityFilter, cityFilter]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    activityFilter !== "all" ||
    cityFilter !== "all";

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 gap-1 px-3"
                onClick={() => setFiltersOpen((prev) => !prev)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                פילטרים
              </Button>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="ml-1 h-4 w-4" />
                  ניקוי
                </Button>
              ) : null}
            </div>
          </div>

          <div className={`${filtersOpen ? "grid" : "hidden"} gap-3 sm:grid-cols-2 lg:grid-cols-3`}>
            <div className="space-y-1">
              <label className="text-sm font-medium">מצב הזמנה</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">הכל</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">פעילות הזמנה</label>
              <select
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value as "all" | "active" | "closed")}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">הכל</option>
                <option value="active">פעילות</option>
                <option value="closed">סגורות</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">עיר לקוח</label>
              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">כל הערים</option>
                {cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            טיפ: אפשר לחפש גם לפי מספר הזמנה חלקי, לדוגמה `a1b2c3d4`.
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">נמצאו {filteredRows.length} הזמנות</div>
        {hasActiveFilters ? (
          <Badge variant="outline" className="text-xs">
            מוצג לפי סינון
          </Badge>
        ) : null}
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
          <Card key={row.id} className={`border-2 ${paymentStatusClasses(row.paymentStatus)}`}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col gap-3 md:grid md:grid-cols-[180px_220px_minmax(320px,1fr)_320px] md:items-center md:gap-4">
                <div className="space-y-1">
                  
                    <CardTitle className="text-base">הזמנה #{row.id.slice(0, 8)}</CardTitle>
                    <div className="text-xs text-muted-foreground">{formatOrderDate(row.orderDate)}</div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 md:min-w-0">
                    <Badge className={orderStatusClasses(row.status)}>{statusLabel(row.status)}</Badge>
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
