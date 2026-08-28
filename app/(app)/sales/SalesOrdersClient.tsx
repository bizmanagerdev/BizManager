"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { CheckIcon, ChevronDownIcon, CommentIcon, EditIcon, NotificationIcon, SearchIcon } from "@/components/ui/icons";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOfflineRows } from "@/hooks/useOfflineRows";
import StaleDataBadge from "@/components/layout/StaleDataBadge";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { findOrderContentMatches, loadMoreOrders, loadOrderRowsByIds } from "@/app/(app)/sales/actions";
import type { OrdersFilters } from "@/app/(app)/sales/loadOrders";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { searchOrderEntries, useOrderSearchIndex, type OrderSearchIndexEntry } from "@/hooks/useOrderSearchIndex";
import OrderConfirmDialog from "@/app/(app)/sales/orders/OrderConfirmDialog";
import OrderPaymentDialog from "@/app/(app)/sales/orders/OrderPaymentDialog";
import InvoiceQuickMenu from "@/app/(app)/sales/orders/InvoiceQuickMenu";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ContactTapZone } from "@/components/ui/contact-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getOrderStatusColor } from "@/lib/ui/status-colors";
import { formatOrderDate } from "@/lib/orders/format";
import {
  isUnpaidPrepayment,
  PREPAYMENT_UNPAID_LABEL,
  prepaymentBadgeClasses,
  PREPAYMENT_ROW_CLASSES,
} from "@/lib/orders/prepayment";
import { parseOrderComments, type OrderComment } from "@/lib/orders/comments";
import OrderReminderDialog from "@/components/orders/OrderReminderDialog";
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
  /** Set only when the order is for a specific one of the customer's branches. */
  customerBranchName: string | null;
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
  outOfStock: boolean;
  /** Customer is flagged "pay ahead" (customers.requires_prepayment). */
  requiresPrepayment: boolean;
  products: { name: string; quantity: number; delivered: number }[];
  pendingMethods: string[];
  pendingCheckNumber: string | null;
  comments: OrderComment[];
};

const PRODUCTS_PREVIEW_LIMIT = 3;

/** Customer name, with the branch appended when set — e.g. "פיצה אורי · סניף
 *  בית שמש". Used wherever a single label needs both (dialog titles, reminder
 *  labels) — the list rows show it as its own line instead. */
function combinedCustomerName(row: { customerName: string; customerBranchName: string | null }) {
  return row.customerBranchName ? `${row.customerName} · סניף ${row.customerBranchName}` : row.customerName;
}

// The order's full comment thread, shown on the list card/row so every note is
// visible without opening the order. Comments live in the order's notes field
// (see lib/orders/comments); each body is clamped so one long note can't dominate.
function OrderCommentPreview({
  comments,
  className,
}: {
  comments: OrderComment[];
  className?: string;
}) {
  if (comments.length === 0) return null;
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      {comments.map((comment, index) => (
        <div key={`comment-${index}`} className="flex items-start gap-1 text-xs text-muted-foreground">
          <CommentIcon className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
          <span className="line-clamp-2 min-w-0">
            {comment.author_name ? <span className="font-medium">{comment.author_name}: </span> : null}
            <span className="text-muted-foreground/90">{comment.body}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function OrderProductList({
  products,
  className,
  chips = false,
}: {
  products: { name: string; quantity: number; delivered?: number }[];
  className?: string;
  chips?: boolean;
}) {
  if (products.length === 0) return null;
  const shown = products.slice(0, PRODUCTS_PREVIEW_LIMIT);
  const remaining = products.length - shown.length;

  if (chips) {
    return (
      // Capped, not wrapped indefinitely: an uncapped list dribbled into lines
      // holding a single lonely chip, which read as broken data rather than as a
      // list. A "+N נוספים" chip is one line and says the same thing.
      <div className={`flex flex-wrap gap-1 text-xs ${className ?? ""}`}>
        {shown.map((product, idx) => {
          const delivered = product.delivered ?? 0;
          const partiallyDone = delivered > 0 && delivered < product.quantity;
          return (
            <span
              key={`${product.name}-${idx}`}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-background px-2 py-0.5 text-foreground"
            >
              <span>
                {product.quantity > 0 ? `${product.quantity} ` : ""}
                {product.name}
              </span>
              {/* Delivered-so-far, so the list shows what was ordered vs handed over. */}
              {partiallyDone ? (
                <span className="font-semibold text-warning-soft-foreground">
                  נמסר {delivered}
                </span>
              ) : null}
            </span>
          );
        })}
        {remaining > 0 ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-border/60 px-2 py-0.5 text-muted-foreground">
            +{remaining} נוספים
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <ul className={`space-y-0.5 text-xs text-muted-foreground ${className ?? ""}`}>
      {shown.map((product, idx) => {
        const delivered = product.delivered ?? 0;
        const partiallyDone = delivered > 0 && delivered < product.quantity;
        return (
          <li key={`${product.name}-${idx}`} className="truncate">
            {product.quantity > 0 ? `${product.quantity}× ` : ""}
            {product.name}
            {partiallyDone ? (
              <span className="text-warning-soft-foreground"> · נמסר {delivered}</span>
            ) : null}
          </li>
        );
      })}
      {remaining > 0 ? <li className="text-muted-foreground/80">ועוד {remaining}…</li> : null}
    </ul>
  );
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
    minimumFractionDigits: 0,
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
    case "סופק חלקית":
    case "סופקה חלקית":
    case "partially_delivered":
      return "partially_delivered";
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
  return getStatusColorClasses(getOrderStatusColor(status));
}

function isActiveOrder(status: string) {
  return !["closed", "cancelled", "delivered", "completed"].includes(normalizeOrderStatus(status));
}

/** Same tab/customer/invoice scoping loadOrdersPage applies server-side, replicated for the client search index. */
function passesActiveScope(
  entry: OrderSearchIndexEntry,
  tab: "orders" | "closed",
  customerId: string | null,
  invoiceFilter: InvoiceFilter
) {
  const active = isActiveOrder(entry.status);
  if (tab === "orders" && !active) return false;
  if (tab === "closed" && active) return false;
  if (customerId && entry.customer_id !== customerId) return false;
  if (invoiceFilter === "needs" && entry.needs_invoice !== true) return false;
  if (invoiceFilter === "no" && entry.needs_invoice !== false) return false;
  if (invoiceFilter === "pending" && !(entry.needs_invoice === true && !entry.invoice_sent_at)) return false;
  if (invoiceFilter === "sent" && !entry.invoice_sent_at) return false;
  return true;
}

/** A just-matched, not-yet-enriched row — zero-filled financial fields, replaced within ~300ms. */
function toBasicOrderRow(entry: OrderSearchIndexEntry): Row {
  return {
    order_id: entry.id,
    customer_id: entry.customer_id,
    customer_name: entry.customer_name,
    customer_branch_name: entry.customer_branch_name,
    branch_id: entry.branch_id,
    order_date: entry.order_date,
    status: entry.status,
    total_amount: 0,
    total_paid: 0,
    pending_amount: 0,
    overdue_amount: 0,
    needs_invoice: entry.needs_invoice,
    invoice_sent_at: entry.invoice_sent_at,
    delivery_confirmed_at: null,
    out_of_stock: false,
    customer_requires_prepayment: false,
    products: [],
    pending_payment_methods: [],
    pending_check_number: null,
    notes: null,
  };
}

function shouldShowPaymentAction(row: OrderView) {
  return row.remainingBalance > 0.009 || row.totalPaid > row.totalAmount + 0.009;
}

// The status each tab is BY DEFINITION full of — repeating it on every card says
// nothing. Anything else (בוטלה, בטיפול, במשלוח…) is worth flagging and still shows.
const EXPECTED_STATUS_BY_VIEW = { open: "draft", closed: "delivered" } as const;

export default function SalesOrdersClient({
  orders,
  initialHasMore = false,
  initialQuery = "",
  showPaymentStatusFilter = false,
  initialPaymentFilter = "",
  initialInvoiceFilter = "",
  customerId = null,
  totalCount,
  canRemind = false,
  view = "open",
  tabLabel = "הזמנות",
}: {
  orders: Row[];
  initialHasMore?: boolean;
  initialQuery?: string;
  showPaymentStatusFilter?: boolean;
  initialPaymentFilter?: string;
  initialInvoiceFilter?: string;
  customerId?: string | null;
  totalCount?: number;
  canRemind?: boolean;
  /** Which list this is — the tab already says it, so the matching status badge
   *  ("פתוח" on the open tab, "סופק" on the closed one) is noise on every card. */
  view?: "open" | "closed";
  /** Which sales tab we're on — names the page in the mobile header. */
  tabLabel?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  // One swiped-open row at a time, like a native list.
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  const [paymentSnapshot] = useState(() => new Map<string, number>());
  // One shared reminder dialog for the whole list; a row's bell button sets its target.
  const [reminderTarget, setReminderTarget] = useState<{ id: string; customerId: string; label: string } | null>(null);

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

  // Offline readability: cache the canonical open-orders list so it can be opened
  // and searched with no signal. Scoped views (a customer's orders, the closed
  // tab) aren't cached — only the main orders list is the "always available" one.
  const offlineCacheKey =
    !customerId && !showPaymentStatusFilter ? "orders-list-main" : null;
  const { rows: sourceOrders, offline, savedAt } = useOfflineRows<Row>(
    offlineCacheKey,
    accumulatedOrders
  );
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

  // Client-side instant search: match the cached order + customer indexes in
  // memory (no network round-trip per keystroke), paint immediately, then
  // enrich with real financials and sweep for deep (order/line-item content)
  // matches in the background. Replaces the old debounced router.push-per-keystroke.
  const orderTab: "orders" | "closed" = showPaymentStatusFilter ? "closed" : "orders";
  const { entries: customerIndexEntries } = useCustomerSearchIndex();
  const { entries: orderIndexEntries, loading: orderIndexLoading } = useOrderSearchIndex();
  const [apiSearchRows, setApiSearchRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q || offline) {
      // Clearing the previous search's results when the box empties or the
      // connection drops — same pattern as CustomersClient's search effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApiSearchRows(null);
      return;
    }
    if (orderIndexLoading) return;
    let cancelled = false;

    const nameMatches = searchOrderEntries(orderIndexEntries, q, customerIndexEntries, 100).filter((entry) =>
      passesActiveScope(entry, orderTab, customerId ?? null, invoiceFilter)
    );
    const basicRows = nameMatches.map(toBasicOrderRow);
    // A payment-status filter needs real totals, unavailable until enrichment —
    // skip the instant (zero-total) paint for that combo rather than flash rows
    // that would immediately get filtered back out.
    const skipInstantPaint = showPaymentStatusFilter && paymentFilter !== "all";
    if (!skipInstantPaint) setApiSearchRows(basicRows);

    const timer = setTimeout(async () => {
      try {
        const { ids: contentIds } = await findOrderContentMatches(q);
        const knownIds = new Set(nameMatches.map((entry) => entry.id));
        const extraEntries = contentIds
          .map((id) => orderIndexEntries.find((entry) => entry.id === id))
          .filter((entry): entry is OrderSearchIndexEntry => entry != null && !knownIds.has(entry.id))
          .filter((entry) => passesActiveScope(entry, orderTab, customerId ?? null, invoiceFilter));
        const allMatches = [...nameMatches, ...extraEntries];
        if (cancelled) return;
        const allBasicRows = [...basicRows, ...extraEntries.map(toBasicOrderRow)];
        if (!skipInstantPaint) setApiSearchRows(allBasicRows);

        const { rows: enriched } = await loadOrderRowsByIds(allMatches.map((entry) => entry.id));
        if (cancelled) return;
        const enrichedById = new Map(enriched.map((row) => [getString(row, ["order_id", "id"]) ?? "", row]));
        let finalRows = allBasicRows.map((row) => enrichedById.get(getString(row, ["order_id", "id"]) ?? "") ?? row);
        if (showPaymentStatusFilter && paymentFilter !== "all") {
          finalRows = finalRows.filter((row) => {
            const total = getNumber(row, ["total_amount"]) ?? 0;
            const paid = getNumber(row, ["total_paid"]) ?? 0;
            return derivePaymentStatus(total, paid) === paymentFilter;
          });
        }
        setApiSearchRows(finalRows);
      } catch {
        // Keep whatever's shown (or nothing, if skipped) on failure.
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    query,
    offline,
    orderIndexEntries,
    customerIndexEntries,
    orderIndexLoading,
    orderTab,
    customerId,
    invoiceFilter,
    showPaymentStatusFilter,
    paymentFilter,
  ]);

  // While the client search index is driving the list, infinite-scroll's "load
  // more" would fetch more of the underlying unfiltered list, not more search
  // matches — hide the sentinel so it doesn't fire a pointless fetch.
  const isClientSearching = !offline && query.trim().length > 0 && apiSearchRows != null;

  // Online: the client search above already produced the match set (when
  // searching). Offline: fall back to the cached, unfiltered list — filteredRows
  // below applies the in-memory substring filter for that case.
  const effectiveOrders = useMemo(() => {
    if (!offline && query.trim() && apiSearchRows) return apiSearchRows;
    return sourceOrders;
  }, [offline, query, sourceOrders, apiSearchRows]);

  const orderRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const mappedOrders = effectiveOrders.map<OrderView | null>((row) => {
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
        customerBranchName: getString(row, ["customer_branch_name"]),
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
        outOfStock: row.out_of_stock === true,
        requiresPrepayment: row.customer_requires_prepayment === true,
        products: Array.isArray(row.products)
          ? (row.products as unknown[])
              .map((p) => {
                const item = p as Record<string, unknown>;
                const name = typeof item.name === "string" ? item.name : null;
                if (!name) return null;
                const quantity = Number(item.quantity ?? 0) || 0;
                const delivered = Number(item.delivered ?? 0) || 0;
                return { name, quantity, delivered };
              })
              .filter((p): p is { name: string; quantity: number; delivered: number } => p !== null)
          : [],
        pendingMethods: Array.isArray(row.pending_payment_methods)
          ? (row.pending_payment_methods as unknown[]).filter((m): m is string => typeof m === "string")
          : [],
        pendingCheckNumber: getString(row, ["pending_check_number"]),
        comments: parseOrderComments(getString(row, ["notes"])),
      };
    });

    return mappedOrders.filter((row): row is OrderView => row !== null);
  }, [effectiveOrders, paymentSnapshot]);

  // Online, the server already filtered by the `q` / `payment_status` URL params
  // across the full dataset. Offline, filter the cached list in memory so search
  // still works with no signal (same fields as the placeholder).
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!offline || !q) return orderRows;
    return orderRows.filter((row) =>
      [row.customerName, row.customerBranchName, row.customerNameForInvoice, row.customerPhone, row.customerEmail, row.customerCity]
        .some((field) => (field ?? "").toLowerCase().includes(q))
    );
  }, [offline, query, orderRows]);

  // Names the page in the mobile top bar, with the count as the subtitle.
  useSetPageTitle(tabLabel, `${totalCount ?? filteredRows.length} הזמנות`);

  // Only surface the stock column/badge when at least one shown order is short.
  const anyOutOfStock = filteredRows.some((row) => row.outOfStock);
  const outOfStockBadgeClasses = getStatusColorClasses("danger");

  return (
    <div className="space-y-4">
      {/* Mobile: the search rides in the dark header (see the customers and
          projects pages), so the list starts right under the bar. No new-order
          button — "הזמנה" is a tile in the app's one quick-create +. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          <div className="relative w-full min-w-0">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש..."
              className="h-10 w-full rounded-xl ps-9"
            />
          </div>
        </div>
      </PageHeaderToolbar>

      <div className="hidden space-y-2 xl:block">
        {offline ? (
          <div className="flex justify-end">
            <StaleDataBadge savedAt={savedAt} />
          </div>
        ) : null}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש..."
            className="h-11 pr-10"
          />
        </div>
      </div>

      {/* The header subtitle carries this count on mobile. */}
      <div className="hidden text-sm text-muted-foreground xl:block">נמצאו {totalCount ?? filteredRows.length} הזמנות</div>

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
                    <th className="px-4 py-3 font-medium">לקוח</th>
                    <th className="px-4 py-3 font-medium">עיר ותאריך</th>
                    <th className="px-4 py-3 font-medium">מוצרים</th>
                    <th className="px-4 py-3 font-medium">הערות ותגובות</th>
                    <th className="px-4 py-3 font-medium">סטטוס הזמנה</th>
                    {anyOutOfStock ? <th className="px-4 py-3 font-medium">מלאי</th> : null}
                    <th className="px-4 py-3 font-medium">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground focus:outline-none"
                          >
                            <span>חשבונית</span>
                            {invoiceFilter !== "all" ? (
                              <span className="text-xs text-primary">
                                ({INVOICE_FILTER_OPTIONS.find((o) => o.value === invoiceFilter)?.label})
                              </span>
                            ) : null}
                            <ChevronDownIcon className="h-3.5 w-3.5" />
                          </button>
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
                    </th>
                    <th className="px-4 py-3 font-medium">
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
                            <ChevronDownIcon className="h-3.5 w-3.5" />
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
                    </th>
                    <th className="px-4 py-3 font-medium">סכום</th>
                    <th className="px-4 py-3 font-medium">פעולות</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer align-top hover:bg-muted/20 focus-visible:bg-muted/20 ${
                        isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance)
                          ? PREPAYMENT_ROW_CLASSES
                          : ""
                      }`}
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
                        <div>
                          <div className="font-medium">{row.customerName}</div>
                          {row.customerBranchName ? (
                            <div className="text-xs text-muted-foreground">סניף: {row.customerBranchName}</div>
                          ) : null}
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
                        {row.products.length > 0 ? (
                          <OrderProductList products={row.products} className="max-w-[12rem]" />
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {row.comments.length > 0 ? (
                          <OrderCommentPreview comments={row.comments} className="max-w-[16rem]" />
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={row.status} type="order" className={orderStatusBadgeClasses(row.status)} />
                      </td>
                      {anyOutOfStock ? (
                        <td className="px-4 py-4">
                          {row.outOfStock ? (
                            <Badge className={outOfStockBadgeClasses}>חוסר במלאי</Badge>
                          ) : null}
                        </td>
                      ) : null}
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <InvoiceQuickMenu orderId={row.id} needsInvoice={row.needsInvoice} invoiceSentAt={row.invoiceSentAt} />
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance) ? (
                            <Badge className={prepaymentBadgeClasses}>{PREPAYMENT_UNPAID_LABEL}</Badge>
                          ) : null}
                          <Badge className={collectionStatusClasses(row.collectionStatus)}>
                            {orderCollectionStatusLabel(row.collectionStatus)}
                          </Badge>
                          {row.pendingMethods.includes("check") ? (
                            <Badge variant="info" className="gap-1 text-[10px]">
                              צ׳ק{row.pendingCheckNumber ? ` מס׳ ${row.pendingCheckNumber}` : ""}
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="space-y-0.5">
                          <div className="font-medium">{formatCurrency(row.totalAmount)}</div>
                          <div className="text-xs text-muted-foreground">שולם: {formatCurrency(row.totalPaid)}</div>
                          <div className="text-xs text-muted-foreground">יתרה: {formatCurrency(row.remainingBalance)}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" onClick={() => emitNavigationStart()}>
                            <Link href={`/sales/orders/${row.id}`}>צפייה בהזמנה</Link>
                          </Button>
                          {canRemind ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 w-9 p-0"
                              title="תזכורת להזמנה"
                              aria-label="תזכורת להזמנה"
                              onClick={() =>
                                setReminderTarget({ id: row.id, customerId: row.customerId, label: combinedCustomerName(row) })
                              }
                            >
                              <NotificationIcon className="h-4 w-4 text-warning" />
                            </Button>
                          ) : null}
                          {canRemind ? (
                            <LogCommunicationButton
                              entityType="order"
                              entityId={row.id}
                              customerId={row.customerId}
                              defaultTopic="sales"
                              iconOnly
                              className="h-9 w-9 p-0"
                            />
                          ) : null}
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
              {hasMore && !offline && !isClientSearching ? <div ref={sentinelRef} className="h-1" /> : null}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-2 xl:hidden">
            <p className="px-1 text-[11px] text-muted-foreground">
              החלק כרטיס ימינה לפעולות · הקש לפתיחה
            </p>
            {filteredRows.map((row) => {
              const showConfirm = isActiveOrder(row.status);
              const showPayment = !showConfirm && shouldShowPaymentAction(row);
              const actions = [
                ...(showConfirm
                  ? [
                      {
                        key: "confirm",
                        className: "bg-secondary",
                        node: (
                          <OrderConfirmDialog
                            orderId={row.id}
                            customerName={combinedCustomerName(row)}
                            buttonVariant="default"
                            buttonLabel={
                              <>
                                <CheckIcon className="h-5 w-5" />
                                אספקה
                              </>
                            }
                            buttonClassName="!bg-transparent"
                          />
                        ),
                      },
                    ]
                  : showPayment
                    ? [
                        {
                          key: "pay",
                          className: "bg-secondary",
                          node: (
                            <OrderPaymentDialog
                              orderId={row.id}
                              totalAmount={row.totalAmount}
                              paidAmount={row.totalPaid}
                              buttonClassName="!bg-transparent"
                            />
                          ),
                        },
                      ]
                    : []),
                {
                  key: "edit",
                  label: "עריכה",
                  icon: <EditIcon className="h-5 w-5" />,
                  className: "bg-secondary-2",
                  onSelect: () => {
                    emitNavigationStart();
                    router.push(`/sales/orders/${row.id}/edit`);
                  },
                },
              ];

              return (
                <SwipeActions
                  key={row.id}
                  className={`shadow-sm ${
                    isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance)
                      ? `border-2 border-destructive ${PREPAYMENT_ROW_CLASSES}`
                      : "border border-border/70"
                  }`}
                  actions={actions}
                  open={swipedRow === row.id}
                  onOpenChange={(next) => setSwipedRow(next ? row.id : null)}
                >
                  <div
                    role="link"
                    tabIndex={0}
                    className="cursor-pointer divide-y divide-border/60 p-3 [&>*]:py-2 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0"
                    onClick={(event) => {
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      emitNavigationStart();
                      router.push(`/sales/orders/${row.id}`);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      event.preventDefault();
                      emitNavigationStart();
                      router.push(`/sales/orders/${row.id}`);
                    }}
                  >
                    {/* Compact card. Two rules:
                        1. NOTHING truncates — names, cities and product chips
                           wrap onto another line rather than becoming "…". The
                           row is what you scan by, so a clipped name is useless.
                        2. The money row adapts: an order that's settled shows
                           just its total, one still owing leads with the balance
                           and shows the total as context. Same information, one
                           line shorter in the common case. */}
                    {/* Top line: WHO on the leading (right) edge — it's what you
                        scan the list by — and WHEN tucked small into the far
                        corner. The date is reference, not headline, so it takes
                        the smallest type on the card. */}
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold leading-snug">{row.customerName}</div>
                        {row.customerBranchName ? (
                          <div className="text-xs leading-snug text-muted-foreground">סניף: {row.customerBranchName}</div>
                        ) : null}
                        {row.customerNameForInvoice && row.customerNameForInvoice !== row.customerName ? (
                          <div className="text-xs leading-snug text-muted-foreground">
                            לחשבונית: {row.customerNameForInvoice}
                          </div>
                        ) : null}
                        {row.customerPhone || row.customerCity ? (
                          <div className="text-xs text-muted-foreground">
                            {/* A <div> (ContactTapZone), not an <a href="tel:…"> — a
                                real tel: link claims the long-press gesture for the
                                browser's own menu, which doesn't surface a copy option
                                everywhere this app runs. Plain text long-presses into
                                normal selection instead — see contact-link.tsx. */}
                            {row.customerPhone ? (
                              <ContactTapZone kind="tel" value={row.customerPhone} className="inline-block hover:underline">
                                <span dir="ltr">{row.customerPhone}</span>
                              </ContactTapZone>
                            ) : null}
                            {row.customerPhone && row.customerCity ? " · " : null}
                            {row.customerCity}
                          </div>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[10px] leading-4 text-muted-foreground">
                        {formatOrderDate(row.orderDate)}
                      </span>
                    </div>

                    {/* Only what's EXCEPTIONAL about the order — a status that isn't
                        the one this tab implies, or a stock problem. Nothing here on
                        a normal order, so the card stays short. */}
                    {row.status !== EXPECTED_STATUS_BY_VIEW[view] || row.outOfStock ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.status !== EXPECTED_STATUS_BY_VIEW[view] ? (
                          <StatusBadge
                            value={row.status}
                            type="order"
                            className={`${orderStatusBadgeClasses(row.status)} px-2 py-0 text-[11px]`}
                          />
                        ) : null}
                        {row.outOfStock ? (
                          <Badge className={`${outOfStockBadgeClasses} px-2 py-0 text-[11px]`}>חוסר במלאי</Badge>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Money line: the figure leads, its statuses trail. No "סכום"
                        label — the ₪ already says what it is, and dropping it is what
                        buys the badges enough room to stay on one line instead of
                        stacking. These orders are paid all-or-nothing, so a balance
                        equal to the total would just print the same number twice;
                        "נותר" only earns its place on a genuinely PART-paid order. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <span className="whitespace-nowrap text-sm font-bold tabular-nums">{formatCurrency(row.totalAmount)}</span>
                      {row.totalPaid > 0.009 && row.remainingBalance > 0.009 ? (
                        <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-destructive">
                          נותר {formatCurrency(row.remainingBalance)}
                        </span>
                      ) : null}
                      {/* Paid-or-not sits WITH the figure it describes — pushed to
                          the far edge it read as unrelated to the amount. */}
                      {isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance) ? (
                        <Badge className={`${prepaymentBadgeClasses} px-2 py-0 text-[11px]`}>
                          {PREPAYMENT_UNPAID_LABEL}
                        </Badge>
                      ) : null}
                      <Badge className={`${collectionStatusClasses(row.collectionStatus)} px-2 py-0 text-[11px]`}>
                        {orderCollectionStatusLabel(row.collectionStatus)}
                      </Badge>
                      {row.pendingMethods.includes("check") ? (
                        <Badge variant="info" className="px-2 py-0 text-[11px]">
                          צ׳ק{row.pendingCheckNumber ? ` ${row.pendingCheckNumber}` : ""}
                        </Badge>
                      ) : null}
                    </div>


                    {row.products.length > 0 ? (
                      <div>
                        <OrderProductList products={row.products} chips />
                      </div>
                    ) : null}

                    {/* Ruled off from the products above it — a note is commentary on
                        the order, not another line of its contents. */}
                    {row.comments.length > 0 ? (
                      <OrderCommentPreview comments={row.comments} />
                    ) : null}

                    {/* Last row on the card: everything above it is read, this is the
                        one thing you SET. A bare dropdown mid-card read as a stray
                        button — the label anchors it, and the footer position keeps
                        the control out of the content you scan. */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">סטטוס הנפקה:</span>
                      <InvoiceQuickMenu
                        orderId={row.id}
                        needsInvoice={row.needsInvoice}
                        invoiceSentAt={row.invoiceSentAt}
                        showSentDate={false}
                      />
                    </div>

                  </div>
                </SwipeActions>
              );
            })}
          </div>
          {hasMore && !offline && !isClientSearching ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}
          </div>
          <div className="pt-3 text-center text-xs text-muted-foreground">
            {loadingMore
              ? "טוען…"
              : `מציג ${filteredRows.length}${totalCount != null ? ` מתוך ${totalCount}` : ""} הזמנות`}
          </div>
        </div>
      )}

      {reminderTarget ? (
        <OrderReminderDialog
          orderId={reminderTarget.id}
          customerId={reminderTarget.customerId}
          orderLabel={reminderTarget.label}
          open={reminderTarget !== null}
          onOpenChange={(next) => {
            if (!next) setReminderTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
