"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, SlidersHorizontal, X } from "lucide-react";

const SALES_FILTERS_OPEN_KEY = "sales_filters_open_v1";

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
  totalAmount: number | null;
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
      return "טיוטה";
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
    case "cancelled":
      return "בוטלה";
    default:
      return value || "-";
  }
}

function paymentStatusLabel(value: string) {
  switch (value) {
    case "unpaid":
      return "לא שולם";
    case "partial":
      return "שולם חלקית";
    case "paid":
      return "שולם";
    default:
      return value || "-";
  }
}

function isActiveOrder(status: string) {
  return !["completed", "cancelled", "delivered"].includes(status);
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const parts = normalized.split("|");
  const first = parts[0]?.trim() ?? "";
  return first || null;
}

export default function SalesOrdersClient({
  orders,
  customers,
}: {
  orders: Row[];
  customers: Row[];
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "closed">("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState<boolean>(() => {
    try {
      if (typeof window === "undefined") return true;
      const saved = window.localStorage.getItem(SALES_FILTERS_OPEN_KEY);
      if (saved === "true") return true;
      if (saved === "false") return false;
      return true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SALES_FILTERS_OPEN_KEY, String(filtersOpen));
    } catch {
      // Ignore storage write errors.
    }
  }, [filtersOpen]);

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

  const orderRows = useMemo(() => {
    return orders
      .map((row) => {
        const id = getString(row, ["id"]);
        const customerId = getString(row, ["customer_id"]);
        if (!id || !customerId) return null;

        const customer = customerMap.get(customerId);

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
          paymentStatus: getString(row, ["payment_status"]) ?? "unpaid",
          totalAmount: getNumber(row, ["total_amount"]),
        } as OrderView;
      })
      .filter((row): row is OrderView => row !== null);
  }, [orders, customerMap]);

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
              <Search className="text-muted-foreground pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
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

      <div className="grid gap-3">
        {filteredRows.map((row) => (
          <Card key={row.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">הזמנה #{row.id.slice(0, 8)}</CardTitle>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/sales/orders/${row.id}/edit`}>עריכה</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/sales/orders/${row.id}`}>לפרטי הזמנה</Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
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
                <p>{row.orderDate ?? "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סטטוס הזמנה</p>
                <p>{statusLabel(row.status)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סטטוס תשלום</p>
                <p>{paymentStatusLabel(row.paymentStatus)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">סכום</p>
                <p>{formatCurrency(row.totalAmount)}</p>
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
