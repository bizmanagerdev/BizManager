"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, SlidersHorizontal, X } from "lucide-react";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import OrderEditDialog from "@/app/sales/orders/OrderEditDialog";
import OrderDetailsDialog from "@/app/sales/orders/OrderDetailsDialog";
import { formatOrderDate } from "@/lib/orders/format";
import {
  derivePaymentStatus,
  paymentStatusClasses,
  paymentStatusLabel,
  sumPayments,
} from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

type CustomerInfo = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
};

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
  paymentCount: number;
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

function statusLabel(value: string) {
  switch (value) {
    case "draft":
      return "פתוחה";
          case "reserved":
      return "מאושרת";
    case "delivered":
      return "סופקה";
    case "closed":
      return "סגורה";
    case "cancelled":
      return "בוטלה";
    default:
      return value || "-";
  }
}

function isActiveOrder(status: string) {
  return !["closed", "cancelled", "delivered"].includes(status);
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

export default function SalesOrdersClient({
  orders,
  customers,
  payments,
}: {
  orders: Row[];
  customers: Row[];
  payments: Row[];
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "closed">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [paymentSnapshot, setPaymentSnapshot] = useState(() => new Map<string, number>());

  const customerMap = useMemo(() => {
    const map = new Map<string, CustomerInfo>();
    for (const row of customers) {
      const id = getString(row, ["id"]);
      if (!id) continue;
      map.set(id, {
        id,
        name: getString(row, ["name", "name_for_invoice"]) ?? "לקוח",
        email: getString(row, ["email"]),
        phone: getString(row, ["phone", "mobile", "tel"]),
        address: getString(row, ["address"]),
        city: extractCityFromAddress(getString(row, ["address"])),
      });
    }
    return map;
  }, [customers]);

  const paymentsByOrderId = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of payments) {
      const orderId = getString(row, ["target_id"]);
      if (!orderId) continue;
      const current = map.get(orderId) ?? [];
      current.push(row);
      map.set(orderId, current);
    }
    return map;
  }, [payments]);

  const orderRows = useMemo(() => {
    return orders
      .map((row) => {
        const id = getString(row, ["id"]);
        const customerId = getString(row, ["customer_id"]);
        if (!id || !customerId) return null;

        const customer = customerMap.get(customerId);
        const totalAmount = getNumber(row, ["total_amount"]) ?? 0;
        const paymentRows = paymentsByOrderId.get(id) ?? [];
        const dbPaidAmount = sumPayments(paymentRows);
        const totalPaid = paymentSnapshot.has(id) ? paymentSnapshot.get(id) ?? dbPaidAmount : dbPaidAmount;

        return {
          id,
          customerId,
          customerName: customer?.name ?? customerId,
          customerEmail: customer?.email ?? null,
          customerPhone: customer?.phone ?? null,
          customerCity: customer?.city ?? null,
          customerAddress: customer?.address ?? null,
          orderDate: getString(row, ["order_date", "created_at"]),
          status: getString(row, ["status"]) ?? "draft",
          paymentStatus: derivePaymentStatus(totalAmount, totalPaid),
          totalAmount,
          totalPaid,
          remainingBalance: Math.max(totalAmount - totalPaid, 0),
          paymentCount: paymentRows.length,
        } as OrderView;
      })
      .filter((row): row is OrderView => row !== null);
  }, [orders, customerMap, paymentsByOrderId, paymentSnapshot]);

  const statuses = useMemo(() => {
    const set = new Set<string>(["draft", "confirmed", "completed", "cancelled"]);
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

      <div className="grid gap-2.5 sm:gap-3">
        {filteredRows.map((row) => (
          <Card key={row.id} className={`border-2 ${paymentStatusClasses(row.paymentStatus)}`}>
            <CardHeader className="p-3 pb-2 sm:p-6 sm:pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <CardTitle className="text-base">הזמנה #{row.id.slice(0, 8)}</CardTitle>
                  <div className="hidden flex-wrap items-center gap-2 sm:flex">
                    <span className={`rounded-full border px-2.5 py-1 text-xs ${paymentStatusClasses(row.paymentStatus)}`}>
                      {paymentStatusLabel(row.paymentStatus)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.customerCity ? `${row.customerCity} | ` : ""}
                      {row.customerName} | {statusLabel(row.status)}
                    </span>
                  </div>
                  <div className="hidden text-xs text-muted-foreground sm:block">{formatOrderDate(row.orderDate)}</div>
                  <div className="text-xs text-muted-foreground sm:hidden">
                    {row.customerCity ? `${row.customerCity} | ` : ""}
                    {row.customerName} | {statusLabel(row.status)} | {formatOrderDate(row.orderDate)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                  <OrderPaymentDialog
                    orderId={row.id}
                    totalAmount={row.totalAmount}
                    paidAmount={row.totalPaid}
                    onCreated={({ totalPaid }) => {
                      setPaymentSnapshot((prev) => {
                        const next = new Map(prev);
                        next.set(row.id, totalPaid);
                        return next;
                      });
                    }}
                  />
                  <OrderEditDialog orderId={row.id} buttonLabel="עריכת הזמנה" />
                  <OrderEditDialog
                    orderId={row.id}
                    buttonLabel="אספקת הזמנה"
                    title="אספקת הזמנה"
                    description="אפשר להשלים את ההזמנה, לעדכן פריטים ותשלומים, ולשמור את הסטטוס כהושלמה."
                    initialStatusOverride="delivered"
                    allowOrderStatusEdit
                  />
                  <OrderDetailsDialog orderId={row.id} />
                </div>
              </div>
            </CardHeader>

            <div className="space-y-1 px-3 pb-3 text-sm sm:hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס תשלום</span>
                <span>
                  {paymentStatusLabel(row.paymentStatus)} | {formatCurrency(row.totalPaid)} מתוך {formatCurrency(row.totalAmount)}
                </span>
              </div>
            </div>

            <CardContent className="hidden grid-cols-2 gap-x-3 gap-y-2 p-3 pt-0 text-sm sm:grid sm:p-6 sm:pt-0 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground">לקוח</p>
                <p>{row.customerName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">עיר</p>
                <p>{row.customerCity ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">כתובת</p>
                <p>{row.customerAddress ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">תאריך</p>
                <p>{formatOrderDate(row.orderDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סטטוס הזמנה</p>
                <p>{statusLabel(row.status)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">מצב תשלום</p>
                <p>{paymentStatusLabel(row.paymentStatus)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">שולם</p>
                <p>{formatCurrency(row.totalPaid)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">יתרה</p>
                <p>{formatCurrency(row.remainingBalance)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סכום</p>
                <p>{formatCurrency(row.totalAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">מספר תשלומים</p>
                <p>{row.paymentCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">טלפון</p>
                <p>{row.customerPhone ?? "-"}</p>
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
