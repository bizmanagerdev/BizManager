"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, Search } from "lucide-react";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatOrderDate } from "@/lib/orders/format";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import {
  deriveCollectionStatus,
  collectionStatusClasses,
  orderCollectionStatusLabel,
  derivePaymentStatus,
} from "@/lib/orders/paymentStatus";

type PaymentStatusFilter = "all" | "paid" | "partial" | "unpaid";

const PAYMENT_FILTER_OPTIONS: { value: PaymentStatusFilter; label: string }[] = [
  { value: "all", label: "הכל" },
  { value: "paid", label: "שולמה" },
  { value: "partial", label: "שולמה חלקית" },
  { value: "unpaid", label: "לא שולמה" },
];

const LOADER_DOT_DELAYS = [0, 150, 300, 450] as const;

function FilterLoaderOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-24"
      aria-hidden="true"
    >
      <div className="flex items-center gap-4">
        {LOADER_DOT_DELAYS.map((delayMs, idx) => (
          <span
            key={delayMs}
            className={`h-6 w-6 animate-bounce rounded-full ${
              idx % 2 === 0 ? "bg-primary" : "bg-foreground/70"
            }`}
            style={{ animationDelay: `${delayMs}ms`, animationDuration: "900ms" }}
          />
        ))}
      </div>
    </div>
  );
}

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
  collectionStatus: string;
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

export default function SalesOrdersClient({
  orders,
  contacts = [],
  initialQuery = "",
  showPaymentStatusFilter = false,
  initialPaymentFilter = "",
  totalCount,
}: {
  orders: Row[];
  contacts?: Row[];
  initialQuery?: string;
  showPaymentStatusFilter?: boolean;
  initialPaymentFilter?: string;
  totalCount?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [paymentSnapshot] = useState(() => new Map<string, number>());
  const paymentFilter: PaymentStatusFilter =
    initialPaymentFilter === "paid" ||
    initialPaymentFilter === "partial" ||
    initialPaymentFilter === "unpaid"
      ? initialPaymentFilter
      : "all";
  const [isFilterPending, startFilterTransition] = useTransition();

  function setPaymentFilter(next: PaymentStatusFilter) {
    if (next === paymentFilter) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("payment_status");
    } else {
      params.set("payment_status", next);
    }
    params.delete("ordersPage");
    const qs = params.toString();
    startFilterTransition(() => {
      router.push(qs ? `/sales?${qs}` : "/sales", { scroll: false });
    });
  }

  // Push search changes to the URL so the server re-queries across the full dataset.
  const lastPushedQueryRef = useRef(initialQuery);
  useEffect(() => {
    if (query === lastPushedQueryRef.current) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) {
        params.set("q", query.trim());
      } else {
        params.delete("q");
      }
      params.delete("ordersPage");
      const qs = params.toString();
      router.push(qs ? `/sales?${qs}` : "/sales", { scroll: false });
      lastPushedQueryRef.current = query;
    }, 400);
    return () => clearTimeout(timer);
  }, [query, router, searchParams]);

  const contactsByCustomerId = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const c of contacts) {
      const cid = typeof c.customer_id === "string" ? c.customer_id : "";
      if (!cid) continue;
      const list = map.get(cid) ?? [];
      list.push(c);
      map.set(cid, list);
    }
    return map;
  }, [contacts]);

  const orderRows = useMemo(() => {
    const mappedOrders = orders.map<OrderView | null>((row) => {
      const id = getString(row, ["order_id", "id"]);
      const customerId = getString(row, ["customer_id"]);
      if (!id || !customerId) return null;

      const totalAmount = getNumber(row, ["total_amount"]) ?? 0;
      const dbPaidAmount = getNumber(row, ["total_paid"]) ?? 0;
      const totalPaid = paymentSnapshot.has(id) ? paymentSnapshot.get(id) ?? dbPaidAmount : dbPaidAmount;
      const remainingBalance = Math.max(totalAmount - totalPaid, 0);

      const pendingAmount = getNumber(row, ["pending_amount"]) ?? 0;
      const overdueAmount = getNumber(row, ["overdue_amount"]) ?? 0;
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
        collectionStatus: deriveCollectionStatus({ totalAmount, collected: totalPaid, pending: pendingAmount, overdue: overdueAmount }),
        totalAmount,
        totalPaid,
        remainingBalance,
      };
    });

    return mappedOrders.filter((row): row is OrderView => row !== null);
  }, [orders, paymentSnapshot]);

  // Server already filtered by the `q` and `payment_status` URL params across the full dataset.
  void contactsByCustomerId;
  const filteredRows = orderRows;

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


      </div>

      <div className="text-sm text-muted-foreground">נמצאו {totalCount ?? filteredRows.length} הזמנות</div>

      {filteredRows.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 py-6 text-sm text-muted-foreground">
            {showPaymentStatusFilter && paymentFilter !== "all" ? (
              <>
                <div>
                  אין הזמנות סגורות עם סטטוס תשלום &quot;
                  {PAYMENT_FILTER_OPTIONS.find((o) => o.value === paymentFilter)?.label}
                  &quot;.
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPaymentFilter("all")}
                >
                  נקה סינון
                </Button>
              </>
            ) : (
              <div>לא נמצאו הזמנות לפי החיפוש.</div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {isFilterPending ? <FilterLoaderOverlay /> : null}
          <div className={isFilterPending ? "pointer-events-none opacity-50 transition-opacity" : "transition-opacity"}>
            <Card className="hidden overflow-hidden border-border/70 shadow-sm xl:block">
            <div>
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-muted-foreground">
                  <tr className="border-b border-border/70 text-right">
                    <th className="px-4 py-3 font-medium">הזמנה</th>
                    <th className="px-4 py-3 font-medium">לקוח</th>
                    <th className="px-4 py-3 font-medium">עיר ותאריך</th>
                    <th className="px-4 py-3 font-medium">סטטוס הזמנה</th>
                    <th className="px-4 py-3 font-medium">
                      {showPaymentStatusFilter ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground focus:outline-none"
                            >
                              <span>סטטוס תשלום</span>
                              {paymentFilter !== "all" ? (
                                <span className="text-xs text-primary">
                                  ({PAYMENT_FILTER_OPTIONS.find((o) => o.value === paymentFilter)?.label})
                                </span>
                              ) : null}
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup
                              value={paymentFilter}
                              onValueChange={(value) => setPaymentFilter(value as PaymentStatusFilter)}
                            >
                              {PAYMENT_FILTER_OPTIONS.map((option) => (
                                <DropdownMenuRadioItem key={option.value} value={option.value}>
                                  {option.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        "סטטוס תשלום"
                      )}
                    </th>
                    <th className="px-4 py-3 font-medium">סכום</th>
                    <th className="px-4 py-3 font-medium">שולם</th>
                    <th className="px-4 py-3 font-medium">יתרה</th>
                    <th className="px-4 py-3 font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer align-top hover:bg-muted/20 focus-visible:bg-muted/20"
                      tabIndex={0}
                      role="link"
                      onClick={(event) => {
                        if (shouldIgnoreRowNavigation(event.target)) return;
                        emitNavigationStart();
                        router.push(`/sales/orders/${row.id}`);
                      }}
                      onKeyDown={(event) => {
                        if (shouldIgnoreRowNavigation(event.target)) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        emitNavigationStart();
                        router.push(`/sales/orders/${row.id}`);
                      }}
                    >
                      <td className="px-4 py-4">
                        <div className="font-medium">הזמנה #{row.id.slice(0, 8)}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <div className="font-medium">{row.customerName}</div>
                          <div className="mt-1 text-muted-foreground">{row.customerPhone ?? "-"}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <div>{row.customerCity ?? "-"}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatOrderDate(row.orderDate)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={row.status} type="order" className={orderStatusBadgeClasses(row.status)} />
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={collectionStatusClasses(row.collectionStatus)}>
                          {orderCollectionStatusLabel(row.collectionStatus, "f")}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 font-medium">{formatCurrency(row.totalAmount)}</td>
                      <td className="px-4 py-4">{formatCurrency(row.totalPaid)}</td>
                      <td className="px-4 py-4">{formatCurrency(row.remainingBalance)}</td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
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

          <div className="grid grid-cols-1 gap-2 xl:hidden">
            {filteredRows.map((row) => {
              const showConfirm = isActiveOrder(row.status);
              const showPayment = !showConfirm && shouldShowPaymentAction(row);
              const hasAction = showConfirm || showPayment;
              return (
                <Card key={row.id} className="min-w-0 overflow-hidden border-border/70 shadow-sm">
                  <CardContent className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold leading-tight">{row.customerName}</div>
                        <div className="truncate text-xs text-muted-foreground">{row.customerPhone ?? "-"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex flex-wrap justify-end gap-1">
                          <StatusBadge value={row.status} type="order" className={`${orderStatusBadgeClasses(row.status)} px-1.5 py-0 text-[10px]`} />
                          <Badge className={`${collectionStatusClasses(row.collectionStatus)} px-1.5 py-0 text-[10px]`}>
                            {orderCollectionStatusLabel(row.collectionStatus, "f")}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground">#{row.id.slice(0, 8)}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div className="flex items-baseline gap-1">
                        <span className="text-muted-foreground">עיר:</span>
                        <span className="truncate font-medium">{row.customerCity ?? "-"}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-muted-foreground">תאריך:</span>
                        <span className="font-medium">{formatOrderDate(row.orderDate)}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-muted-foreground">סכום:</span>
                        <span className="font-medium">{formatCurrency(row.totalAmount)}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-muted-foreground">יתרה:</span>
                        <span className={`font-medium ${row.remainingBalance > 0 ? "text-destructive" : ""}`}>
                          {formatCurrency(row.remainingBalance)}
                        </span>
                      </div>
                    </div>

                    <div className={`grid gap-2 ${hasAction ? "grid-cols-2" : "grid-cols-1"}`}>
                      <Button asChild type="button" size="sm" className="h-9 rounded-lg" onClick={() => emitNavigationStart()}>
                        <Link href={`/sales/orders/${row.id}`}>צפייה</Link>
                      </Button>
                      {showConfirm ? (
                        <OrderConfirmDialog
                          orderId={row.id}
                          buttonLabel="אישור אספקה"
                          buttonClassName="h-9 w-full rounded-lg"
                        />
                      ) : showPayment ? (
                        <OrderPaymentDialog
                          orderId={row.id}
                          totalAmount={row.totalAmount}
                          paidAmount={row.totalPaid}
                          buttonClassName="h-9 w-full rounded-lg"
                        />
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
