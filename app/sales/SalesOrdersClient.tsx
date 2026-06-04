"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { loadMoreOrders } from "@/app/sales/actions";
import type { OrdersFilters } from "@/app/sales/loadOrders";
import OrderConfirmDialog from "@/app/sales/orders/OrderConfirmDialog";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatOrderDate } from "@/lib/orders/format";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import {
  collectionStatusClasses,
  orderCollectionStatusLabel,
  derivePaymentStatus,
} from "@/lib/orders/paymentStatus";
import { computeSourceCollection } from "@/lib/collections";

type PaymentStatusFilter = "all" | "paid" | "partial" | "unpaid";

const PAYMENT_FILTER_OPTIONS: { value: PaymentStatusFilter; label: string }[] = [
  { value: "all", label: "הכל" },
  { value: "paid", label: "שולם" },
  { value: "partial", label: "שולם חלקית" },
  { value: "unpaid", label: "לא שולם" },
];

type InvoiceFilter = "all" | "needs" | "no" | "pending" | "sent";

const INVOICE_FILTER_OPTIONS: { value: InvoiceFilter; label: string }[] = [
  { value: "all", label: "כל החשבוניות" },
  { value: "needs", label: "צריך חשבונית" },
  { value: "no", label: "לא צריך חשבונית" },
  { value: "pending", label: "טרם הונפקה" },
  { value: "sent", label: "הונפקה" },
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
  customerNameForInvoice: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerCity: string | null;
  customerAddress: string | null;
  orderDate: string | null;
  dueDate: string | null;
  status: string;
  paymentStatus: string;
  collectionStatus: string;
  totalAmount: number;
  totalPaid: number;
  remainingBalance: number;
  needsInvoice: boolean | null;
  invoiceSentAt: string | null;
  deliveryConfirmedAt: string | null;
};

type InvoiceState = "needs_unsent" | "needs_sent" | "no" | "undecided";

function invoiceState(row: { needsInvoice: boolean | null; invoiceSentAt: string | null }): InvoiceState {
  if (row.needsInvoice === false) return "no";
  if (row.needsInvoice === true) return row.invoiceSentAt ? "needs_sent" : "needs_unsent";
  return "undecided";
}

function invoiceBadge(state: InvoiceState): { label: string; className: string } {
  switch (state) {
    case "needs_sent":
      return { label: "הונפקה", className: "bg-success-soft text-success-soft-foreground border-transparent" };
    case "needs_unsent":
      return { label: "טרם הונפקה", className: "bg-warning-soft text-warning-soft-foreground border-transparent" };
    case "no":
      return { label: "לא צריך חשבונית", className: "bg-muted text-muted-foreground border-transparent" };
    default:
      return { label: "חשבונית לא הוגדרה", className: "border-border bg-background text-muted-foreground" };
  }
}

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

function InvoiceQuickMenu({ row }: { row: OrderView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const state = invoiceState(row);
  const badge = invoiceBadge(state);

  async function apply(update: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orders/invoice-status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: row.id, ...update }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium ${badge.className} disabled:opacity-50`}
        >
          <span>{badge.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={() => void apply({ needs_invoice: true })}>צריך חשבונית</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void apply({ needs_invoice: false })}>לא צריך חשבונית</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={Boolean(row.invoiceSentAt)} onSelect={() => void apply({ invoice_sent: true })}>
          סמן כהונפקה
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!row.invoiceSentAt} onSelect={() => void apply({ invoice_sent: false })}>
          בטל סימון הנפקה
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
      {state === "needs_sent" && row.invoiceSentAt ? (
        <div className="text-[11px] text-muted-foreground">{formatOrderDate(row.invoiceSentAt)}</div>
      ) : null}
    </div>
  );
}

export default function SalesOrdersClient({
  orders,
  initialHasMore = false,
  initialQuery = "",
  showPaymentStatusFilter = false,
  initialPaymentFilter = "",
  initialInvoiceFilter = "",
  customerId = null,
  totalCount,
}: {
  orders: Row[];
  initialHasMore?: boolean;
  initialQuery?: string;
  showPaymentStatusFilter?: boolean;
  initialPaymentFilter?: string;
  initialInvoiceFilter?: string;
  customerId?: string | null;
  totalCount?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [paymentSnapshot] = useState(() => new Map<string, number>());

  // Fetch-from-DB-as-you-scroll: accumulate order pages and pull the next one
  // from the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<OrdersFilters>(
    () => ({
      tab: showPaymentStatusFilter ? "closed" : "orders",
      customerId,
      q: initialQuery,
      paymentStatus:
        initialPaymentFilter === "paid" ||
        initialPaymentFilter === "partial" ||
        initialPaymentFilter === "unpaid"
          ? initialPaymentFilter
          : "",
      invoice:
        initialInvoiceFilter === "needs" ||
        initialInvoiceFilter === "no" ||
        initialInvoiceFilter === "pending" ||
        initialInvoiceFilter === "sent"
          ? initialInvoiceFilter
          : "",
    }),
    [showPaymentStatusFilter, customerId, initialQuery, initialPaymentFilter, initialInvoiceFilter]
  );
  const fetchPage = useCallback((page: number) => loadMoreOrders(page, fetchFilters), [fetchFilters]);
  const getRowId = useCallback((row: Row) => getString(row, ["order_id", "id"]) ?? "", []);
  const {
    rows: accumulatedOrders,
    hasMore,
    loading: loadingMore,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  } = useInfiniteScroll<Row>({
    initialRows: orders,
    initialHasMore,
    fetchPage,
    getId: getRowId,
  });
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

  const invoiceFilter: InvoiceFilter =
    initialInvoiceFilter === "needs" ||
    initialInvoiceFilter === "no" ||
    initialInvoiceFilter === "pending" ||
    initialInvoiceFilter === "sent"
      ? initialInvoiceFilter
      : "all";

  function setInvoiceFilter(next: InvoiceFilter) {
    if (next === invoiceFilter) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") {
      params.delete("invoice");
    } else {
      params.set("invoice", next);
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

  const orderRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const mappedOrders = accumulatedOrders.map<OrderView | null>((row) => {
      const id = getString(row, ["order_id", "id"]);
      const customerId = getString(row, ["customer_id"]);
      if (!id || !customerId) return null;

      const totalAmount = getNumber(row, ["total_amount"]) ?? 0;
      const dbPaidAmount = getNumber(row, ["total_paid"]) ?? 0;
      const totalPaid = paymentSnapshot.has(id) ? paymentSnapshot.get(id) ?? dbPaidAmount : dbPaidAmount;
      const remainingBalance = Math.max(totalAmount - totalPaid, 0);

      const pendingAmount = getNumber(row, ["pending_amount"]) ?? 0;
      const overdueAmount = getNumber(row, ["overdue_amount"]) ?? 0;
      const orderDate = getString(row, ["order_date", "created_at"]);
      const dueDate = getString(row, ["due_date"]);
      const rawStatus = getString(row, ["status"]);
      // Term-aware status: a closed order past its due date shows באיחור; an OPEN
      // order is never overdue (payment isn't forced until products are delivered).
      const sm = computeSourceCollection({
        total: totalAmount,
        collected: totalPaid,
        pending: pendingAmount,
        overdue: overdueAmount,
        outstanding: remainingBalance,
        nextDueDate: getString(row, ["next_due_date"]),
        referenceDate: orderDate,
        dueDate,
        blockOverdue: isActiveOrder(rawStatus ?? ""),
        today,
      });
      return {
        id,
        customerId,
        customerName: getString(row, ["customer_name"]) ?? customerId,
        customerNameForInvoice: getString(row, ["customer_name_for_invoice"]),
        customerEmail: getString(row, ["customer_email"]),
        customerPhone: getString(row, ["customer_phone"]),
        customerCity: getString(row, ["customer_city"]),
        customerAddress: getString(row, ["customer_address"]),
        orderDate,
        dueDate,
        status: normalizeOrderStatus(getString(row, ["status"])),
        paymentStatus: derivePaymentStatus(totalAmount, totalPaid),
        collectionStatus: sm.status,
        totalAmount,
        totalPaid,
        remainingBalance,
        needsInvoice: typeof row.needs_invoice === "boolean" ? row.needs_invoice : null,
        invoiceSentAt: getString(row, ["invoice_sent_at"]),
        deliveryConfirmedAt: getString(row, ["delivery_confirmed_at"]),
      };
    });

    return mappedOrders.filter((row): row is OrderView => row !== null);
  }, [accumulatedOrders, paymentSnapshot]);

  // Server already filtered by the `q` and `payment_status` URL params across the full dataset.
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

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={`gap-1 ${invoiceFilter !== "all" ? "border-primary text-primary" : ""}`}
              >
                <span>חשבונית: {INVOICE_FILTER_OPTIONS.find((o) => o.value === invoiceFilter)?.label}</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={invoiceFilter}
                onValueChange={(value) => setInvoiceFilter(value as InvoiceFilter)}
              >
                {INVOICE_FILTER_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
            <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                  <tr className="border-b border-border/70 text-right">
                    <th className="px-4 py-3 font-medium">הזמנה</th>
                    <th className="px-4 py-3 font-medium">לקוח</th>
                    <th className="px-4 py-3 font-medium">עיר ותאריך</th>
                    <th className="px-4 py-3 font-medium">סטטוס הזמנה</th>
                    <th className="px-4 py-3 font-medium">חשבונית</th>
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
                          {row.customerNameForInvoice && row.customerNameForInvoice !== row.customerName ? (
                            <div className="text-xs text-muted-foreground">לחשבונית: {row.customerNameForInvoice}</div>
                          ) : null}
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
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <InvoiceQuickMenu row={row} />
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={collectionStatusClasses(row.collectionStatus)}>
                          {orderCollectionStatusLabel(row.collectionStatus)}
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
              {hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
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
                        {row.customerNameForInvoice && row.customerNameForInvoice !== row.customerName ? (
                          <div className="truncate text-xs text-muted-foreground">לחשבונית: {row.customerNameForInvoice}</div>
                        ) : null}
                        <div className="truncate text-xs text-muted-foreground">{row.customerPhone ?? "-"}</div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <div className="flex flex-wrap justify-end gap-1">
                          <StatusBadge value={row.status} type="order" className={`${orderStatusBadgeClasses(row.status)} px-1.5 py-0 text-[10px]`} />
                          <Badge className={`${collectionStatusClasses(row.collectionStatus)} px-1.5 py-0 text-[10px]`}>
                            {orderCollectionStatusLabel(row.collectionStatus)}
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

                    <div className="flex items-center justify-between gap-2">
                      <InvoiceQuickMenu row={row} />
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
          {hasMore ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}
          </div>
          <div className="pt-3 text-center text-xs text-muted-foreground">
            {loadingMore
              ? "טוען…"
              : `מציג ${filteredRows.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} הזמנות`}
          </div>
        </div>
      )}
    </div>
  );
}
