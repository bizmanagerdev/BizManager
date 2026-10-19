"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDownIcon, CommentIcon, EditIcon, NotificationIcon, PhoneIcon, SearchIcon } from "@/components/ui/icons";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useLocalListPager } from "@/components/powersync/LocalListPager";
import { useOfflineRows } from "@/hooks/useOfflineRows";
import StaleDataBadge from "@/components/layout/StaleDataBadge";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { findOrderContentMatches, loadMoreOrders, loadOrderRowsByIds } from "@/app/(app)/sales/actions";
import type { OrdersFilters } from "@/app/(app)/sales/loadOrders";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { searchOrderEntries, useOrderSearchIndex, type OrderSearchIndexEntry } from "@/hooks/useOrderSearchIndex";
import OrderPaymentDialog from "@/app/(app)/sales/orders/OrderPaymentDialog";
import InvoiceQuickMenu from "@/app/(app)/sales/orders/InvoiceQuickMenu";
import LogCommunicationButton from "@/components/communications/LogCommunicationButton";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CallIconButton } from "@/components/ui/contact-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { LIST_CARD_BADGE, LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import DeleteOrderButton from "@/app/(app)/sales/orders/[id]/DeleteOrderButton";
import RowActionsMenu from "@/app/(app)/sales/RowActionsMenu";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getOrderStatusColor } from "@/lib/ui/status-colors";
import { formatOrderDate, formatOrderEnteredShort } from "@/lib/orders/format";
import { formatEnteredLabel } from "@/lib/date";
import {
  isUnpaidPrepayment,
  PREPAYMENT_UNPAID_LABEL,
  prepaymentBadgeClasses,
  PREPAYMENT_ROW_CLASSES,
} from "@/lib/orders/prepayment";
import { parseOrderComments, type OrderComment } from "@/lib/orders/comments";
import OrderReminderDialog from "@/components/orders/OrderReminderDialog";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import RouteOpeningOverlay, { showRouteOpening } from "@/components/layout/RouteOpeningOverlay";
import OrderPageOpening from "@/app/(app)/sales/orders/[id]/OrderPageOpening";
import { orderPreviewFromRow, orderPreviewSlot } from "@/app/(app)/sales/orders/[id]/orderPreview";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import {
  collectionStatusClasses,
  orderCollectionStatusLabel,
  derivePaymentStatus,
} from "@/lib/orders/paymentStatus";
import { computeSourceCollection } from "@/lib/collections";
import { israelDateKey } from "@/lib/timezone";
import { formatMoney } from "@/lib/money";
import { useSharedSearch } from "@/lib/ui/shared-search";
import { SearchMatchLine } from "@/components/search/SearchMatchLine";
import { highlightText } from "@/components/search/highlightMatch";
import { gsNorm } from "@/lib/search/global-query";
import type { InsideMatches } from "@/lib/global-search";

const OrderConfirmDialog = dynamic(() => import("@/app/(app)/sales/orders/OrderConfirmDialog"), {
  loading: () => null,
});
const OrderEditDialog = dynamic(() => import("@/app/(app)/sales/orders/OrderEditDialog"), {
  loading: () => null,
});

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
  /** When it was typed in — a real moment, unlike orderDate (a picked day). */
  createdAt: string | null;
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
  /** Names of the specific short product(s) — what to show instead of a bare flag. */
  outOfStockItems: string[];
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
          <li key={`${product.name}-${idx}`}>
            {/* "×2", the order page's way (owner, 2026-10-11: one way to write a quantity). */}
            {product.quantity > 0 ? `×${product.quantity} ` : ""}
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

// ₪ first, the dashboard's way (owner, 2026-10-11) — lib/money.ts. A missing
// value is "—", as everywhere (owner, 2026-10-11).
/**
 * The phone card's corner: " 15:32" when the order was typed in on its own day,
 * nothing otherwise — "12/10 15:32" beside another date wouldn't fit there.
 */
function mobileEnteredTime(orderDate: string | null, createdAt: string | null) {
  const entered = formatOrderEnteredShort(orderDate, createdAt);
  return entered && !entered.includes("/") ? ` ${entered}` : null;
}

function formatCurrency(value: number | null) {
  if (value === null) return "—";
  return formatMoney(value);
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
    out_of_stock_items: [],
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

// Stable for useUndoOverlay: a deleted order leaves the list at once, while
// its undo window is still open.
const orderViewId = (row: OrderView) => row.id;

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
  loadedAt,
  fromDevice = false,
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
  /** When the server read these rows — an aged copy refreshes itself
   *  (useInfiniteScroll's loadedAt). */
  loadedAt?: number;
  /** The page's device version (LocalSalesPage): the rows come from the phone's
   *  copy, current with no signal too — no older saved list over them. */
  fromDevice?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // One search box for הזמנות and הזמנות סגורות: what's typed in one tab is
  // still there in the other, on the desktop box and the phone's top bar
  // (owner, 2026-10-19). A customer's own order list keeps its own.
  const [query, setQuery] = useSharedSearch(`orders:${customerId ?? ""}`, initialQuery, "/sales");
  // One swiped-open row at a time, like a native list.
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  // The device version edits an order right here (its form read from the phone's copy).
  const [editOrderId, setEditOrderId] = useState<string | null>(null);

  // A tapped order's page shows at once: over the list straight away on a
  // phone, and as the page's loading screen everywhere — drawn from this
  // device's copy when it has one, else named from this row until the page's
  // own data arrives.
  const openOrder = (row: OrderView) => {
    const preview = orderPreviewFromRow(row);
    if (!preview) return;
    orderPreviewSlot.remember(preview);
    showRouteOpening(<OrderPageOpening id={preview.id} preview={preview} />);
  };
  const [paymentSnapshot] = useState(() => new Map<string, number>());
  // One shared reminder / call-log / delete dialog for the whole list; a row's
  // ⋮ sets its target.
  const [reminderTarget, setReminderTarget] = useState<{ id: string; customerId: string; label: string } | null>(null);
  const [logTarget, setLogTarget] = useState<{ id: string; customerId: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const editOrder = (row: OrderView) => {
    // The page's device version: the order form opens right here, from the
    // phone's copy — at once, with no signal too.
    if (fromDevice) {
      setEditOrderId(row.id);
      return;
    }
    emitNavigationStart();
    router.push(`/sales/orders/${row.id}/edit`);
  };

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
  // The device version of the page (LocalSalesPage) serves further pages from the device copy.
  const localPager = useLocalListPager<Row>();
  const fetchPage = useCallback(
    (page: number) => (localPager ? localPager(page) : loadMoreOrders(page, fetchFilters)),
    [fetchFilters, localPager]
  );
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
    loadedAt,
  });

  // Offline readability: cache the canonical open-orders list so it can be opened
  // and searched with no signal. Scoped views (a customer's orders, the closed
  // tab) aren't cached — only the main orders list is the "always available" one.
  const offlineCacheKey =
    !fromDevice && !customerId && !showPaymentStatusFilter ? "orders-list-main" : null;
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
  // Why each found order came up (a payment, a comment, an hour…), from the
  // deep search, and how many more the other tab holds.
  const [deepMatches, setDeepMatches] = useState<(InsideMatches & { query: string }) | null>(null);
  const [otherTabCount, setOtherTabCount] = useState(0);
  const otherTab: "orders" | "closed" = orderTab === "orders" ? "closed" : "orders";

  useEffect(() => {
    const q = query.trim();
    if (!q || offline) {
      // Clearing the previous search's results when the box empties or the
      // connection drops — same pattern as CustomersClient's search effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setApiSearchRows(null);
      setDeepMatches(null);
      setOtherTabCount(0);
      return;
    }
    if (orderIndexLoading) return;
    let cancelled = false;

    const allNameMatches = searchOrderEntries(orderIndexEntries, q, customerIndexEntries, 100);
    const nameMatches = allNameMatches.filter((entry) =>
      passesActiveScope(entry, orderTab, customerId ?? null, invoiceFilter)
    );
    const otherNameIds = allNameMatches
      .filter((entry) => passesActiveScope(entry, otherTab, customerId ?? null, "all"))
      .map((entry) => entry.id);
    setOtherTabCount(otherNameIds.length);
    const basicRows = nameMatches.map(toBasicOrderRow);
    // A payment-status filter needs real totals, unavailable until enrichment —
    // skip the instant (zero-total) paint for that combo rather than flash rows
    // that would immediately get filtered back out.
    const skipInstantPaint = showPaymentStatusFilter && paymentFilter !== "all";
    if (!skipInstantPaint) setApiSearchRows(basicRows);

    const timer = setTimeout(async () => {
      try {
        const deep = await findOrderContentMatches(q);
        if (cancelled) return;
        setDeepMatches({ ids: deep.ids ?? [], reasons: deep.reasons ?? {}, terms: deep.terms ?? [], query: q });
        const contentIds = deep.ids ?? [];
        const entryById = new Map(orderIndexEntries.map((entry) => [entry.id, entry]));
        const knownIds = new Set(nameMatches.map((entry) => entry.id));
        const contentEntries = contentIds
          .map((id) => entryById.get(id))
          .filter((entry): entry is OrderSearchIndexEntry => entry != null);
        const extraEntries = contentEntries
          .filter((entry) => !knownIds.has(entry.id))
          .filter((entry) => passesActiveScope(entry, orderTab, customerId ?? null, invoiceFilter));
        const otherIds = new Set(otherNameIds);
        for (const entry of contentEntries) {
          if (passesActiveScope(entry, otherTab, customerId ?? null, "all")) otherIds.add(entry.id);
        }
        setOtherTabCount(otherIds.size);
        const allMatches = [...nameMatches, ...extraEntries];
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
    otherTab,
    customerId,
    invoiceFilter,
    showPaymentStatusFilter,
    paymentFilter,
  ]);

  // What to paint yellow on the cards: the deep search's own terms (spelling
  // fixes, an hour) once it answered, the typed words until then.
  const trimmedQuery = query.trim();
  const searchTerms = useMemo(
    () =>
      !trimmedQuery
        ? []
        : deepMatches?.query === trimmedQuery
          ? deepMatches.terms
          : gsNorm(trimmedQuery).split(" ").filter(Boolean),
    [trimmedQuery, deepMatches]
  );
  const matchReasons = deepMatches?.query === trimmedQuery ? deepMatches.reasons : null;
  const otherTabHref = useMemo(() => {
    const params = new URLSearchParams();
    if (otherTab === "closed") params.set("tab", "closed");
    for (const key of ["customer_id", "customer_name", "customer_page"]) {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/sales?${qs}` : "/sales";
  }, [otherTab, searchParams]);

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
    const today = israelDateKey();
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
        createdAt: getString(row, ["created_at"]),
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
        outOfStockItems: Array.isArray(row.out_of_stock_items)
          ? (row.out_of_stock_items as unknown[]).filter((v): v is string => typeof v === "string")
          : [],
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
  const visibleOrderRows = useUndoOverlay(orderRows, orderViewId, "order");

  // Online, the server already filtered by the `q` / `payment_status` URL params
  // across the full dataset. Offline, filter the cached list in memory so search
  // still works with no signal (same fields as the placeholder).
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!offline || !q) return visibleOrderRows;
    return visibleOrderRows.filter((row) =>
      [row.customerName, row.customerBranchName, row.customerNameForInvoice, row.customerPhone, row.customerEmail, row.customerCity]
        .some((field) => (field ?? "").toLowerCase().includes(q))
    );
  }, [offline, query, visibleOrderRows]);

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
          {/* On the start side, logical, as every search (owner, 2026-10-11). */}
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש..."
            className="h-11 ps-9"
          />
        </div>
      </div>

      {/* The header subtitle carries this count on mobile. */}
      <div className="hidden text-sm text-muted-foreground xl:block">נמצאו {totalCount ?? filteredRows.length} הזמנות</div>

      {/* The same search finds orders in the other tab too — say so, one tap
          away (the box keeps what's typed there). */}
      {trimmedQuery && otherTabCount > 0 ? (
        <Link
          href={otherTabHref}
          onClick={() => emitNavigationStart()}
          className="block rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm text-primary underline-offset-2 hover:underline"
        >
          {otherTabCount === 1 ? "עוד הזמנה אחת" : `עוד ${otherTabCount} הזמנות`} ב{otherTab === "closed" ? "הזמנות הסגורות" : "הזמנות הפתוחות"} ←
        </Link>
      ) : null}

      {/* An empty list has the app's one look (owner, 2026-10-11). */}
      {filteredRows.length === 0 ? (
        showPaymentStatusFilter && paymentFilter !== "all" ? (
          <EmptyState
            action={
              // Grey, like every clear / cancel (owner, 2026-10-11).
              <Button type="button" variant="muted" size="sm" onClick={() => setPaymentFilter("all")}>
                נקה סינון
              </Button>
            }
          >
            אין הזמנות סגורות עם סטטוס תשלום &quot;
            {PAYMENT_FILTER_OPTIONS.find((o) => o.value === paymentFilter)?.label}
            &quot;.
          </EmptyState>
        ) : (
          <EmptyState>לא נמצאו הזמנות לפי החיפוש.</EmptyState>
        )
      ) : (
        <div className="relative">
          {isFilterPending ? <FilterLoaderOverlay /> : null}
          <div className={isFilterPending ? "pointer-events-none opacity-50 transition-opacity" : "transition-opacity"}>
            <ResponsiveDataView
              breakpoint="xl"
              desktop={
                <DataTableShell
                  ref={scrollRef}
                  // The column names' row is two lines tall from the start: as
                  // more rows arrived, a column narrowed and "הערות ותגובות"
                  // wrapped to a second line, pushing every row down 23px
                  // (Sentry, 2026-10-14). On one line they'd widen the table
                  // past a 1366px laptop instead.
                  headerRowClassName="[&>th]:h-16"
                  header={
                    <>
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
                    </>
                  }
                  footer={hasMore && !offline && !isClientSearching ? <div ref={sentinelRef} className="h-1" /> : null}
                >
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer align-top hover:bg-muted/20 focus-visible:bg-muted/20 ${
                        isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance)
                          ? PREPAYMENT_ROW_CLASSES
                          : ""
                      }`}
                      {...rowNavigateProps(router, `/sales/orders/${row.id}`, { prefetch: true, onNavigate: () => openOrder(row) })}
                    >
                      <td className="px-4 py-4">
                        <div>
                          <div className="font-medium">{highlightText(row.customerName, searchTerms)}</div>
                          {row.customerBranchName ? (
                            <div className="text-xs text-muted-foreground">סניף: {highlightText(row.customerBranchName, searchTerms)}</div>
                          ) : null}
                          <SearchMatchLine reasons={matchReasons?.[row.id]} terms={searchTerms} className="mt-1 max-w-[18rem]" />
                          {row.customerNameForInvoice && row.customerNameForInvoice !== row.customerName ? (
                            <div className="text-xs text-muted-foreground">לחשבונית: {row.customerNameForInvoice}</div>
                          ) : null}
                          {/* The number stays text — a click on it opens the order
                              like the rest of the row — and the green phone beside
                              it calls, or copies at a desk: the app's one call look
                              (owner, 2026-10-11). This column had no way to call. */}
                          {row.customerPhone ? (
                            <div className="mt-1 flex items-center gap-2">
                              <span dir="ltr" className="text-muted-foreground">
                                {row.customerPhone}
                              </span>
                              <CallIconButton phone={row.customerPhone} name={row.customerName} />
                            </div>
                          ) : (
                            <div className="mt-1 text-muted-foreground">—</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <div>{row.customerCity ?? "—"}</div>
                          {/* The order's day, then when it was really typed in —
                              on the same line, so the row keeps its height,
                              and with no "הוזן" before it ("it's extra" —
                              owner, 2026-10-15). */}
                          <div
                            className="mt-1 whitespace-nowrap text-xs text-muted-foreground"
                            title={formatEnteredLabel(null, row.createdAt) ?? undefined}
                          >
                            {formatOrderDate(row.orderDate)}
                            {formatOrderEnteredShort(row.orderDate, row.createdAt)
                              ? ` · ${formatOrderEnteredShort(row.orderDate, row.createdAt)}`
                              : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {row.products.length > 0 ? (
                          <OrderProductList products={row.products} className="max-w-[12rem]" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {row.comments.length > 0 ? (
                          <OrderCommentPreview comments={row.comments} className="max-w-[16rem]" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={row.status} type="order" className={orderStatusBadgeClasses(row.status)} />
                      </td>
                      {anyOutOfStock ? (
                        <td className="px-4 py-4">
                          {row.outOfStock ? (
                            <div className="space-y-1">
                              <Badge className={outOfStockBadgeClasses}>חוסר במלאי</Badge>
                              {row.outOfStockItems.length > 0 ? (
                                <div className="text-xs text-destructive-soft-foreground">
                                  {row.outOfStockItems.join(", ")}
                                </div>
                              ) : null}
                            </div>
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
                            <Badge variant="info" className="gap-1 text-[0.647rem]">
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
                        <div className="flex flex-wrap items-center gap-2">
                          {/* The less important of the two — the row itself opens
                              the order — so the soft look, and the row's real act
                              beside it stays the bold one (owner: "all main
                              buttons are bold secondary, all buttons less
                              important like this"). Two bold blues per row
                              competed. */}
                          <Button asChild size="sm" variant="soft" onClick={() => emitNavigationStart()}>
                            <Link href={`/sales/orders/${row.id}`}>צפייה בהזמנה</Link>
                          </Button>
                          {isActiveOrder(row.status) ? (
                            <OrderConfirmDialog orderId={row.id} />
                          ) : shouldShowPaymentAction(row) ? (
                            <OrderPaymentDialog
                              orderId={row.id}
                              totalAmount={row.totalAmount}
                              paidAmount={row.totalPaid}
                              devicePage={fromDevice ? "sales" : undefined}
                            />
                          ) : null}
                          {/* The rest waits behind a ⋮ at the row's end — edit and
                              delete, and the reminder bell and call log that were
                              icon buttons of their own here (owner, 2026-10-11: a
                              big list's row actions sit in a ⋮ on the computer).
                              The row's own act, beside it, stays as it was. */}
                          <RowActionsMenu onEdit={() => editOrder(row)} onDelete={() => setDeleteTarget(row.id)}>
                            {canRemind ? (
                              <>
                                <DropdownMenuItem
                                  className="gap-2"
                                  onSelect={() =>
                                    setReminderTarget({
                                      id: row.id,
                                      customerId: row.customerId,
                                      label: combinedCustomerName(row),
                                    })
                                  }
                                >
                                  <NotificationIcon className="h-4 w-4" />
                                  <span>תזכורת</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="gap-2"
                                  onSelect={() => setLogTarget({ id: row.id, customerId: row.customerId })}
                                >
                                  <PhoneIcon className="h-4 w-4" />
                                  <span>תיעוד שיחה</span>
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </RowActionsMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </DataTableShell>
              }
              mobile={
                <>
                <div className="grid grid-cols-1 gap-2">
                  <p className="px-1 text-[0.647rem] text-muted-foreground">
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
                              // The dialog draws its own ✓ + "אישור אספקה", the one
                              // name it has everywhere (owner, 2026-10-11); this tile
                              // said "אספקה". Two words, so the tile lets them wrap,
                              // centred, with the side padding the other tiles have —
                              // the Button's own nowrap and padding would run them
                              // past a 76px tile at a bigger text size.
                              className:
                                "bg-secondary [&_button]:whitespace-normal [&_button]:px-1 [&_button]:text-center [&_button]:leading-tight",
                              node: (
                                <OrderConfirmDialog
                                  orderId={row.id}
                                  customerName={combinedCustomerName(row)}
                                  buttonVariant="default"
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
                                    devicePage={fromDevice ? "sales" : undefined}
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
                        onSelect: () => editOrder(row),
                      },
                    ];

                    return (
                      <SwipeActions
                        key={row.id}
                        className={`shadow-card ${
                          isUnpaidPrepayment(row.requiresPrepayment, row.remainingBalance)
                            ? `border-2 border-destructive ${PREPAYMENT_ROW_CLASSES}`
                            : "border border-border/70"
                        }`}
                        actions={actions}
                        open={swipedRow === row.id}
                        onOpenChange={(next) => setSwipedRow(next ? row.id : null)}
                      >
                        <div
                          className={cn(
                            "cursor-pointer divide-y divide-border/60 [&>*]:py-2 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0",
                            LIST_CARD_BODY
                          )}
                          {...rowNavigateProps(router, `/sales/orders/${row.id}`, { prefetch: true, onNavigate: () => openOrder(row) })}
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
                              the smallest type on the card. The name, the line under
                              it and the pills are every list card's
                              (components/ui/list-card.ts; owner, 2026-10-11). */}
                          <div className="flex items-baseline justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className={LIST_CARD_NAME}>{highlightText(row.customerName, searchTerms)}</div>
                              {row.customerBranchName ? (
                                <div className={cn(LIST_CARD_META, "leading-snug")}>
                                  סניף: {highlightText(row.customerBranchName, searchTerms)}
                                </div>
                              ) : null}
                              {row.customerNameForInvoice && row.customerNameForInvoice !== row.customerName ? (
                                <div className={cn(LIST_CARD_META, "leading-snug")}>
                                  לחשבונית: {row.customerNameForInvoice}
                                </div>
                              ) : null}
                              {row.customerPhone || row.customerCity ? (
                                <div className={LIST_CARD_META}>
                                  {/* Plain text — tapping it opens the order like the rest
                                      of the card. As a call link right under the name it took
                                      the taps meant for the order (owner, 2026-10-11); the
                                      call button in the corner dials instead. */}
                                  {row.customerPhone ? <span dir="ltr">{row.customerPhone}</span> : null}
                                  {row.customerPhone && row.customerCity ? " · " : null}
                                  {row.customerCity}
                                </div>
                              ) : null}
                            </div>
                            {/* The far corner: the date, and under it the one control
                                that calls the customer. */}
                            <div className="flex shrink-0 flex-col items-end gap-1.5">
                              {/* The day, with the hour it was entered when that was
                                  the same day — one line, the corner keeps its size. */}
                              <span
                                className="whitespace-nowrap text-[0.647rem] leading-4 text-muted-foreground"
                                title={formatEnteredLabel(null, row.createdAt) ?? undefined}
                              >
                                {formatOrderDate(row.orderDate)}
                                {mobileEnteredTime(row.orderDate, row.createdAt)}
                              </span>
                              {row.customerPhone ? <CallIconButton phone={row.customerPhone} name={row.customerName} /> : null}
                            </div>
                          </div>

                          {/* Found by a search through something not on the card (a
                              payment, a comment, an hour): what it was, painted. */}
                          {matchReasons?.[row.id]?.length ? (
                            <SearchMatchLine reasons={matchReasons[row.id]} terms={searchTerms} />
                          ) : null}

                          {/* Only what's EXCEPTIONAL about the order — a status that isn't
                              the one this tab implies, or a stock problem. Nothing here on
                              a normal order, so the card stays short. */}
                          {row.status !== EXPECTED_STATUS_BY_VIEW[view] || row.outOfStock ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {row.status !== EXPECTED_STATUS_BY_VIEW[view] ? (
                                <StatusBadge
                                  value={row.status}
                                  type="order"
                                  className={cn(orderStatusBadgeClasses(row.status), LIST_CARD_BADGE)}
                                />
                              ) : null}
                              {row.outOfStock ? (
                                <>
                                  <Badge className={cn(outOfStockBadgeClasses, LIST_CARD_BADGE)}>חוסר במלאי</Badge>
                                  {row.outOfStockItems.length > 0 ? (
                                    <span className="text-[0.647rem] font-medium text-destructive-soft-foreground">
                                      {row.outOfStockItems.join(", ")}
                                    </span>
                                  ) : null}
                                </>
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
                              <Badge className={cn(prepaymentBadgeClasses, LIST_CARD_BADGE)}>
                                {PREPAYMENT_UNPAID_LABEL}
                              </Badge>
                            ) : null}
                            <Badge className={cn(collectionStatusClasses(row.collectionStatus), LIST_CARD_BADGE)}>
                              {orderCollectionStatusLabel(row.collectionStatus)}
                            </Badge>
                            {row.pendingMethods.includes("check") ? (
                              <Badge variant="info" className={LIST_CARD_BADGE}>
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
                            <span className="text-[0.647rem] text-muted-foreground">סטטוס הנפקה:</span>
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
                {hasMore && !offline && !isClientSearching ? <div ref={mobileSentinelRef} className="h-1" /> : null}
                </>
              }
            />
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

      {logTarget ? (
        <LogCommunicationButton
          entityType="order"
          entityId={logTarget.id}
          customerId={logTarget.customerId}
          defaultTopic="sales"
          hideTrigger
          open
          onOpenChange={(next) => {
            if (!next) setLogTarget(null);
          }}
        />
      ) : null}

      {/* Asks through the app's one confirm dialog; the row leaves the list at
          once (its undo window still open) — no trip to another page. */}
      {deleteTarget ? (
        <DeleteOrderButton
          orderId={deleteTarget}
          hideTrigger
          open
          redirectTo={null}
          onOpenChange={(next) => {
            if (!next) setDeleteTarget(null);
          }}
        />
      ) : null}

      {editOrderId ? (
        <OrderEditDialog
          key={editOrderId}
          orderId={editOrderId}
          hideTrigger
          open
          onOpenChange={(next) => {
            if (!next) setEditOrderId(null);
          }}
        />
      ) : null}

      <RouteOpeningOverlay />
    </div>
  );
}
