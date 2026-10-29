"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent } from "react";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOnline } from "@/hooks/useOfflineRows";
import { useLocalListPager } from "@/components/powersync/LocalListPager";
import {
  searchCustomerEntries,
  useCustomerSearchIndex,
  type CustomerSearchIndexEntry,
} from "@/hooks/useCustomerSearchIndex";
import { findCustomerIdsPassingFilters, loadCustomerRowsByIds, loadMoreCustomers } from "@/app/(app)/customers/actions";
import {
  CUSTOMERS_FILTER_FIELDS,
  compareCustomerRows,
  customersFilterSummary,
  customersFiltersQuery,
  hasCustomersFilter,
  needsServerCustomersFilter,
  parseCustomerFilterMode,
  parseCustomersFilters,
  type CustomersFilterKey,
  type CustomersFilters,
} from "@/app/(app)/customers/customersFilters";
import {
  CUSTOMERS_CELL,
  CUSTOMERS_COLUMNS,
  CUSTOMERS_COUNT_ROW,
  CUSTOMERS_HEAD_CELL,
  CUSTOMERS_HINT_ROW,
  CUSTOMERS_HINT_TEXT,
  CUSTOMERS_SWIPE_HINT,
  CUSTOMERS_TABLE_CLASS,
  CUSTOMERS_TOOLBAR,
} from "@/app/(app)/customers/customersTable";
import CustomerRowActionsMenu from "@/app/(app)/customers/CustomerRowActionsMenu";
import { CustomersFilterSummaryLine } from "@/app/(app)/customers/CustomersFilterSummary";
import { useCustomersTitle } from "@/app/(app)/customers/CustomersTitle";
import {
  EditCustomerDialog,
  type EditCustomerInput,
  type EditCustomerSavedPayload,
} from "@/components/customers/EditCustomerDialog";
import { fetchCustomerCore } from "@/lib/customers/fetchCustomerCore";
import { PageStack } from "@/components/layout/page-layout";
import StaleDataBadge from "@/components/layout/StaleDataBadge";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { CONNECTION_EVENTS, getQueue } from "@/lib/offline-queue";
import { rowNavigateProps } from "@/lib/ui/row-navigation";
import { DataTableShell } from "@/components/ui/data-table-shell";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { CloseIcon, DownloadIcon, EditIcon, FilterIcon, OrderIcon, ProjectIcon, SearchIcon, WazeIcon } from "@/components/ui/icons";
import { NativeSelect } from "@/components/ui/native-select";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { AddressLink } from "@/components/ui/address-link";
import { pinFrom, type DeliveryPin } from "@/lib/delivery-location";
import { CallIconButton, ContactLink } from "@/components/ui/contact-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { SearchEverywhereLink } from "@/components/ui/list-search";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { LIST_CARD_BADGE, LIST_CARD_BODY, LIST_CARD_META, LIST_CARD_NAME } from "@/components/ui/list-card";
import { TOGGLE_OFF, TOGGLE_ON, TOGGLE_ON_HOVER } from "@/components/ui/filter-chip";
import { formatMoneyRounded } from "@/lib/money";
import { ordersHe, projectsHe } from "@/lib/i18n/pluralHe";
import { cn } from "@/lib/utils";
import { addressNotFound } from "@/lib/address/columns";

type Row = Record<string, unknown>;

const s = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};
const n = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const p = Number(v);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
};
const rowId = (row: Row) => s(row, "customer_id") || s(row, "id");

/**
 * A search match painted from the search index before the server's figures
 * came: its counts, debt and Morning link aren't known yet, so they show as
 * placeholders — not as zeros that then pop into numbers and badges.
 */
const ENRICH_PENDING = "_enrich_pending";
/** An edit of this row waiting in the app's queue for the connection ("ממתין לשליחה"). */
const SYNC_PENDING = "_sync_pending";

/** A search's matches are enriched and shown this many at a time, like the list's pages. */
export const SEARCH_PAGE_SIZE = 50;
const NO_ROWS: Row[] = [];

const SEARCHING = "מחפש…";
const OFFLINE_FILTER = "אין חיבור — אפשר לסנן כשיחזור החיבור.";
const OFFLINE_EXPORT = "אין חיבור — אפשר לייצא כשיחזור החיבור.";

const morningClientUrl = (morningClientId: string) =>
  `https://app.greeninvoice.co.il/incomes/clients/${encodeURIComponent(morningClientId)}/documents`;
const customerHref = (id: string) => `/customers/${encodeURIComponent(id)}`;
const newOrderHref = (id: string) => `/sales/orders/new?customer_id=${encodeURIComponent(id)}`;
const newProjectHref = (id: string) => `/projects?create=1&customer_id=${encodeURIComponent(id)}`;

/** A phone the green call button can dial — the field sometimes holds an email. */
const isDialable = (value: string) => /\d/.test(value) && !value.includes("@");

function searchIndexRow(entry: CustomerSearchIndexEntry): Row {
  return {
    customer_id: entry.id,
    customer_name: entry.name,
    name_for_invoice: entry.name_for_invoice,
    phone: entry.phone,
    whatsapp: entry.whatsapp,
    email: entry.email,
    address: entry.address,
    // From the index, so an inactive customer never shows as active meanwhile.
    active: entry.active,
    requires_prepayment: entry.requires_prepayment,
    [ENRICH_PENDING]: true,
  };
}

/** The server's copy over the row on screen — unless that row holds an edit still waiting to be sent. */
function serverOver(current: Row, fresh: Row | undefined): Row {
  if (!fresh || current[SYNC_PENDING] === true) return current;
  return fresh;
}

/** Rows that arrive on their own (a new customer) put where they sort; ones already listed are skipped. */
export function insertCustomerRows(rows: Row[], additions: Row[]): Row[] {
  let next = rows;
  for (const row of additions) {
    const id = rowId(row);
    if (!id || next.some((existing) => rowId(existing) === id)) continue;
    const at = next.findIndex((existing) => compareCustomerRows(row, existing) < 0);
    next = at === -1 ? [...next, row] : [...next.slice(0, at), row, ...next.slice(at)];
  }
  return next;
}

/**
 * The server's fresh first page over the list on screen (a refresh of the same
 * filters): its rows replace theirs and new ones go in where they sort, while
 * the pages scrolled in under it stay. A first page with nothing after it is
 * the whole list.
 */
export function mergeFirstPage(current: Row[], fresh: Row[], freshHasMore: boolean): Row[] {
  const currentById = new Map(current.map((row) => [rowId(row), row]));
  if (!freshHasMore) {
    return fresh.map((row) => {
      const shown = currentById.get(rowId(row));
      return shown ? serverOver(shown, row) : row;
    });
  }
  const freshById = new Map(fresh.map((row) => [rowId(row), row]));
  const updated = current.map((row) => serverOver(row, freshById.get(rowId(row))));
  return insertCustomerRows(
    updated,
    fresh.filter((row) => !currentById.has(rowId(row)))
  );
}

/** The edit dialog's starting point — from a list row (customer_overview_view) or a customers row. */
function editInputFromRow(row: Row): EditCustomerInput {
  const linked = row.linked_user_id;
  return {
    id: rowId(row),
    name: s(row, "customer_name") || s(row, "name"),
    name_for_invoice: s(row, "name_for_invoice") || null,
    registration_number: s(row, "registration_number") || null,
    phone: s(row, "phone") || null,
    whatsapp: s(row, "whatsapp") || null,
    email: s(row, "email") || null,
    address: s(row, "address") || null,
    notes: s(row, "notes") || null,
    active: row.active !== false,
    requires_prepayment: row.requires_prepayment === true,
    // Left out when unknown: the dialog then reads it before it lets it be saved.
    linked_user_id: typeof linked === "string" ? linked : linked === null ? null : undefined,
  };
}

/** A saved (or undone) customer over its row. */
function savedOver(row: Row, saved: Row, queued: boolean): Row {
  return {
    ...row,
    customer_name: s(saved, "name") || s(row, "customer_name"),
    name: s(saved, "name") || s(row, "name"),
    name_for_invoice: s(saved, "name_for_invoice"),
    registration_number: s(saved, "registration_number"),
    phone: s(saved, "phone"),
    whatsapp: s(saved, "whatsapp"),
    email: s(saved, "email"),
    address: s(saved, "address"),
    notes: s(saved, "notes"),
    active: saved.active !== false,
    requires_prepayment: saved.requires_prepayment === true,
    // Only present when the edit actually touched the link — otherwise keep
    // the row's value instead of dropping the עובד badge.
    linked_user_id: "linked_user_id" in saved ? saved.linked_user_id : row.linked_user_id,
    [SYNC_PENDING]: queued,
  };
}

/** The small pills by a customer's name: inactive (quiet grey), a worker, pay-ahead, a save still waiting. */
function CustomerFlags({ row, withInactive = false }: { row: Row; withInactive?: boolean }) {
  return (
    <>
      {withInactive && row.active === false ? (
        <Badge variant="neutral" className={LIST_CARD_BADGE}>
          לא פעיל
        </Badge>
      ) : null}
      {row.linked_user_id ? (
        <Badge variant="info" className={LIST_CARD_BADGE}>
          עובד
        </Badge>
      ) : null}
      {row.requires_prepayment === true ? (
        <Badge variant="destructive" className={LIST_CARD_BADGE}>
          תשלום מראש
        </Badge>
      ) : null}
      {row[SYNC_PENDING] === true ? (
        <Badge variant="warning" className={LIST_CARD_BADGE}>
          ממתין לשליחה
        </Badge>
      ) : null}
    </>
  );
}

/** A pill whose words aren't known yet — the same height as a real one. */
function PillPlaceholder({ className }: { className?: string }) {
  return <Skeleton className={cn("h-[calc(0.647rem*1.5+0.25rem+2px)] rounded-full", className)} />;
}

/** A phone card's second half: what it holds, the flags and what it owes. */
function CardFacts({ row }: { row: Row }) {
  const pending = row[ENRICH_PENDING] === true;
  const orders = n(row, "orders_count");
  const projects = n(row, "projects_count");
  const debt = n(row, "open_balance");
  const rent = n(row, "rent_owed");
  const morning = s(row, "morning_client_id");
  const flagged = Boolean(row.linked_user_id) || row.requires_prepayment === true || row[SYNC_PENDING] === true;
  if (!pending && orders <= 0 && projects <= 0 && !morning && !flagged && debt <= 0 && rent <= 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {pending ? (
        <>
          <PillPlaceholder className="w-16" />
          <PillPlaceholder className="w-20" />
        </>
      ) : (
        <>
          {orders > 0 ? (
            <Badge variant="outline" className={LIST_CARD_BADGE}>
              {ordersHe(orders)}
            </Badge>
          ) : null}
          {projects > 0 ? (
            <Badge variant="outline" className={LIST_CARD_BADGE}>
              {projectsHe(projects)}
            </Badge>
          ) : null}
          {morning ? (
            <Badge variant="success" className={LIST_CARD_BADGE}>
              Morning
            </Badge>
          ) : null}
        </>
      )}
      <CustomerFlags row={row} />
      {/* What it owes, in red at the card's end — the four sections' one name
          for it. Whole shekels: a figure with agorot ran past the card. */}
      {!pending && (debt > 0 || rent > 0) ? (
        <span className="ms-auto flex flex-wrap justify-end gap-x-2 text-xs font-semibold tabular-nums text-destructive">
          {debt > 0 ? <span className="whitespace-nowrap text-destructive">חוב פתוח {formatMoneyRounded(debt)}</span> : null}
          {/* A tenant's rent owed, by the rent page's rule (owner, 2026-10-25). */}
          {rent > 0 ? <span className="whitespace-nowrap text-destructive">חוב שכירות {formatMoneyRounded(rent)}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

export default function CustomersClient({
  initialRows,
  initialHasMore = false,
  totalCount,
  initialFilters,
  loadedAt,
}: {
  initialRows: Row[];
  initialHasMore?: boolean;
  totalCount?: number;
  initialFilters?: CustomersFilters;
  /** When the server read these rows (Date.now() there) — an aged copy refreshes itself. */
  loadedAt?: number;
}) {
  const router = useRouter();
  const online = useOnline();
  const [filterPending, startFilterTransition] = useTransition();
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim();

  // The filters the server applied (the address). Keyed by their text so a
  // refresh's new-but-equal object doesn't count as a change.
  const filtersKey = customersFiltersQuery(initialFilters ?? parseCustomersFilters(() => null));
  const filters = useMemo(() => {
    const params = new URLSearchParams(filtersKey);
    return parseCustomersFilters((param) => params.get(param));
  }, [filtersKey]);
  const filterOn = hasCustomersFilter(filters);

  // ── The list ───────────────────────────────────────────────────────────
  // Fetch-from-DB-as-you-scroll, from the server's first page for these
  // filters. A fresh first page for the SAME filters (a refresh — the quick-
  // create + saving a customer, say) is merged into the list on screen below
  // rather than starting it over: that threw away everything scrolled in.
  const [seed, setSeed] = useState({ key: filtersKey, rows: initialRows, hasMore: initialHasMore });
  // On the device version (LocalCustomersPage) the next pages come from the
  // device's copy too.
  const localPager = useLocalListPager<Row>();
  const fetchListPage = useCallback(
    async (page: number) => {
      if (localPager) return localPager(page);
      const result = await loadMoreCustomers(page, filters);
      if (result.error) throw new Error(result.error);
      return result;
    },
    [filters, localPager]
  );
  const getRowId = useCallback((row: Row) => rowId(row), []);

  const { entries: indexEntries, loading: indexLoading, error: indexError, stale: indexStale, savedAt: indexSavedAt, load: loadIndex } =
    // After the page has settled — or the moment the search box is used.
    useCustomerSearchIndex({ deferUntilIdle: true });

  // ── The search ─────────────────────────────────────────────────────────
  // Every match from the in-memory index, best first (it used to stop at 50
  // without a word), within the list's filters: "active" is on each index
  // entry; projects / orders / debt are checked on the server first.
  const serverFilter = needsServerCustomersFilter(filters);
  // No list to search (it couldn't be read, and there's no copy on the device):
  // say so — "no matches" would be a lie.
  const indexUnavailable = Boolean(indexError) && indexEntries.length === 0;
  const matchedPlan = useMemo(() => {
    if (!q || indexLoading || indexUnavailable) return null;
    const ids = searchCustomerEntries(indexEntries, q, Number.POSITIVE_INFINITY)
      .filter((entry) => (filters.activeOnly === "all" ? true : filters.activeOnly === "yes" ? entry.active : !entry.active))
      .map((entry) => entry.id);
    return { key: `${filtersKey}|${ids.join(",")}`, ids };
  }, [q, indexLoading, indexUnavailable, indexEntries, filters.activeOnly, filtersKey]);
  // Held by its key: another letter typed (or the index reloaded) that leaves
  // the same matches neither starts the results over nor asks the server again.
  const [searchPlan, setSearchPlan] = useState(matchedPlan);
  if (matchedPlan?.key !== searchPlan?.key) setSearchPlan(matchedPlan);

  const [filteredSearch, setFilteredSearch] = useState<{ key: string; ids: string[] | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!searchPlan || !serverFilter || !online) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      findCustomerIdsPassingFilters(searchPlan.ids, filters)
        .then((result) => {
          if (!cancelled) setFilteredSearch({ key: searchPlan.key, ids: result.error ? null : result.ids, error: result.error });
        })
        .catch((caught) => {
          if (!cancelled) setFilteredSearch({ key: searchPlan.key, ids: null, error: toHebrewError(caught, "החיפוש נכשל. נסו שוב.") });
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchPlan, serverFilter, online, filters]);

  // Where the search stands: its final match list, or why there isn't one yet.
  let searchReady: { key: string; ids: string[]; note: string | null } | null = null;
  let searchStatus: string | null = null;
  if (q) {
    if (!searchPlan) {
      searchStatus = indexUnavailable ? "החיפוש לא זמין כרגע — רשימת הלקוחות לא נטענה." : SEARCHING;
    } else if (!serverFilter) {
      searchReady = { key: searchPlan.key, ids: searchPlan.ids, note: null };
    } else if (!online) {
      // The orders / projects / debt check needs the server: say so, and show
      // the matches as they are.
      searchReady = { key: `${searchPlan.key}|offline`, ids: searchPlan.ids, note: "אין חיבור — הסינון לא הוחל על החיפוש." };
    } else if (filteredSearch?.key === searchPlan.key) {
      if (filteredSearch.ids) searchReady = { key: searchPlan.key, ids: filteredSearch.ids, note: null };
      else searchStatus = filteredSearch.error ?? "החיפוש נכשל. נסו שוב.";
    } else {
      searchStatus = SEARCHING;
    }
  }

  // The search on screen: kept while the next one works itself out (dimmed),
  // replaced when it's ready — and only when its matches actually changed, so
  // a reload of the index (after an edit) doesn't start the results over.
  const [shownSearch, setShownSearch] = useState<{ key: string; ids: string[]; note: string | null; firstRows: Row[] } | null>(null);
  if (!q && shownSearch) setShownSearch(null);
  if (searchReady && searchReady.key !== shownSearch?.key) {
    const entryById = new Map(indexEntries.map((entry) => [entry.id, entry]));
    setShownSearch({
      ...searchReady,
      firstRows: searchReady.ids
        .slice(0, SEARCH_PAGE_SIZE)
        .map((id) => entryById.get(id))
        .filter((entry): entry is CustomerSearchIndexEntry => Boolean(entry))
        .map(searchIndexRow),
    });
  }
  // A search that can't finish (no list to search, or the filter check failed)
  // says why in the list's place — not a list left dimmed under it.
  const searchFailed = Boolean(q) && !searchReady && searchStatus !== null && searchStatus !== SEARCHING;
  const searchMode = Boolean(q && shownSearch) && !searchFailed;
  const searchWaiting = Boolean(q) && !searchFailed && (!shownSearch || shownSearch.key !== searchReady?.key);

  const list = useInfiniteScroll<Row>({
    initialRows: seed.rows,
    initialHasMore: seed.hasMore,
    fetchPage: fetchListPage,
    getId: getRowId,
    loadedAt,
    enabled: !searchMode,
  });
  const setListRows = list.setRows;

  // A new server first page: other filters start the list over; the same
  // filters (a refresh) merge into it ("adjust state during render").
  const [seenInitialRows, setSeenInitialRows] = useState(initialRows);
  if (initialRows !== seenInitialRows) {
    setSeenInitialRows(initialRows);
    if (filtersKey !== seed.key) setSeed({ key: filtersKey, rows: initialRows, hasMore: initialHasMore });
    else setListRows((prev) => mergeFirstPage(prev, initialRows, initialHasMore));
  }

  const searchIds = shownSearch?.ids;
  const fetchSearchPage = useCallback(
    async (page: number) => {
      const ids = searchIds ?? [];
      const slice = ids.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE);
      const result = await loadCustomerRowsByIds(slice);
      if (result.error) throw new Error(result.error);
      const byId = new Map(result.rows.map((row) => [rowId(row), row]));
      // In the search's own order — best match first.
      return {
        rows: slice.map((id) => byId.get(id)).filter((row): row is Row => Boolean(row)),
        hasMore: page * SEARCH_PAGE_SIZE < ids.length,
      };
    },
    [searchIds]
  );
  const searchList = useInfiniteScroll<Row>({
    initialRows: shownSearch?.firstRows ?? NO_ROWS,
    initialHasMore: (shownSearch?.ids.length ?? 0) > SEARCH_PAGE_SIZE,
    fetchPage: fetchSearchPage,
    getId: getRowId,
    enabled: searchMode,
  });
  const setSearchRows = searchList.setRows;

  // The first page of matches gets the server's figures in the background.
  useEffect(() => {
    if (!shownSearch || !online) return;
    const ids = shownSearch.ids.slice(0, SEARCH_PAGE_SIZE);
    if (ids.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadCustomerRowsByIds(ids)
        .then(({ rows: enriched }) => {
          if (cancelled) return;
          const byId = new Map(enriched.map((row) => [rowId(row), row]));
          setSearchRows((prev) => prev.map((row) => serverOver(row, byId.get(rowId(row)))));
        })
        // The matches stay as the index painted them — still searchable.
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [shownSearch, online, setSearchRows]);

  const active = searchMode ? searchList : list;
  const shownRows = active.rows;

  // ── A customer created while the list is open ──────────────────────────
  // Creating one (the quick-create +) reloads the search index, so a new id
  // turns up there. A refresh brings it only if it sorts into the first page;
  // further down, it's put in here — where the list has already reached.
  const knownIdsRef = useRef<Set<string> | null>(null);
  const listHasMore = list.hasMore;
  const listRows = list.rows;
  useEffect(() => {
    if (indexLoading || indexEntries.length === 0) return;
    const previous = knownIdsRef.current;
    knownIdsRef.current = new Set(indexEntries.map((entry) => entry.id));
    if (!previous) return;
    const added = indexEntries.filter((entry) => !previous.has(entry.id)).map((entry) => entry.id);
    if (added.length === 0 || added.length > SEARCH_PAGE_SIZE) return;
    const last = listRows[listRows.length - 1];
    let cancelled = false;
    loadCustomerRowsByIds(added, filters)
      .then(({ rows: fresh }) => {
        if (cancelled || fresh.length === 0) return;
        const reached = fresh.filter((row) => !listHasMore || !last || compareCustomerRows(row, last) < 0);
        setListRows((prev) => insertCustomerRows(prev, reached));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Only a new index matters here; the rest is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexEntries, indexLoading]);

  // ── Edits waiting for the connection ───────────────────────────────────
  // A row saved with no connection shows "ממתין לשליחה" until its writes have
  // gone out (or failed for good); then it's read again from the server.
  const searchRows = searchList.rows;
  useEffect(() => {
    const settle = () => {
      const waiting = new Set(
        getQueue()
          .flatMap((entry) => [entry.body?.id, entry.body?.customer_id])
          .filter((value): value is string => typeof value === "string")
      );
      const done = Array.from(
        new Set(
          [...listRows, ...searchRows]
            .filter((row) => row[SYNC_PENDING] === true && !waiting.has(rowId(row)))
            .map(rowId)
        )
      );
      if (done.length === 0) return;
      loadCustomerRowsByIds(done)
        .then(({ rows: fresh }) => {
          const byId = new Map(fresh.map((row) => [rowId(row), row]));
          const replace = (prev: Row[]) => prev.map((row) => byId.get(rowId(row)) ?? row);
          setListRows(replace);
          setSearchRows(replace);
        })
        .catch(() => {});
    };
    window.addEventListener(CONNECTION_EVENTS.synced, settle);
    window.addEventListener(CONNECTION_EVENTS.failed, settle);
    return () => {
      window.removeEventListener(CONNECTION_EVENTS.synced, settle);
      window.removeEventListener(CONNECTION_EVENTS.failed, settle);
    };
  }, [listRows, searchRows, setListRows, setSearchRows]);

  // ── Edit ───────────────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditCustomerInput | null>(null);

  async function openEdit(row: Row) {
    const id = rowId(row);
    if (!id) return;
    if (row[ENRICH_PENDING] !== true) {
      setEditTarget(editInputFromRow(row));
      setEditOpen(true);
      return;
    }
    // A search match the server hasn't filled in yet has no notes, ID number
    // or invoice name — and the dialog saves every field, so it would blank
    // them. Read the customer first, as the projects list reads a project
    // before its edit opens.
    const core = await fetchCustomerCore(id).catch(() => null);
    if (!core) {
      toast.error(navigator.onLine ? "טעינת הלקוח נכשלה. נסו שוב." : "אין חיבור — אפשר לערוך את הלקוח כשיחזור החיבור.");
      return;
    }
    setEditTarget(editInputFromRow(core));
    setEditOpen(true);
  }

  // A save (or its undo) patches the row where it is — in the list and in the
  // search results — so the list stays where it was scrolled.
  const applySaved = useCallback(
    ({ customer, queued }: EditCustomerSavedPayload) => {
      const id = s(customer, "id");
      if (!id) return;
      const patch = (prev: Row[]) => prev.map((row) => (rowId(row) === id ? savedOver(row, customer, queued === true) : row));
      setListRows(patch);
      setSearchRows(patch);
    },
    [setListRows, setSearchRows]
  );

  // ── Filters and export ─────────────────────────────────────────────────
  function pushFilters(next: CustomersFilters) {
    if (!navigator.onLine) {
      toast.error(OFFLINE_FILTER);
      return;
    }
    const qs = customersFiltersQuery(next);
    startFilterTransition(() => {
      router.push(qs ? `/customers?${qs}` : "/customers", { scroll: false });
    });
  }
  const applyFilter = (key: CustomersFilterKey, value: string) =>
    pushFilters({ ...filters, [key]: parseCustomerFilterMode(value) });
  const clearFilters = () => pushFilters(parseCustomersFilters(() => null));

  // Export mirrors whatever filter is applied — the same parameters the
  // address carries — so "no filter" exports every customer.
  const exportHref = filtersKey ? `/api/customers/export?${filtersKey}` : "/api/customers/export";
  function onExportClick(event: MouseEvent) {
    if (navigator.onLine) return;
    event.preventDefault();
    toast.error(OFFLINE_EXPORT);
  }

  // Escape closes the overlay. Gated on filtersOpen so the listener is gone
  // (and can't swallow keys) whenever the panel is shut.
  useEffect(() => {
    if (!filtersOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFiltersOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtersOpen]);

  // Names the page in the mobile top bar; the count rides along as the
  // subtitle (the server's count, for the filter on) — held from the loading
  // screen's first frame (CustomersTitle).
  useCustomersTitle(totalCount ?? list.rows.length);

  const goTo = (href: string) => {
    emitNavigationStart();
    router.push(href);
  };

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim()) loadIndex();
  };

  // The filter toggle reads ON — the app's toggle fill — while the panel is
  // open or a filter is narrowing the list.
  const toggleClass =
    filtersOpen || filterOn
      ? cn("border-secondary", TOGGLE_ON, TOGGLE_ON_HOVER)
      : cn("border-input bg-background", TOGGLE_OFF);
  const toggleLabel = filtersOpen ? "הסתרת סינון" : "סינון";

  const filterFields = (where: string) =>
    CUSTOMERS_FILTER_FIELDS.map((field) => (
      <div key={field.key} className="min-w-0 space-y-1">
        <label htmlFor={`customers-filter-${field.key}-${where}`} className="text-sm text-muted-foreground">
          {field.label}
        </label>
        <NativeSelect
          id={`customers-filter-${field.key}-${where}`}
          value={filters[field.key]}
          onChange={(e) => applyFilter(field.key, e.target.value)}
        >
          <option value="all">הכל</option>
          <option value="yes">{field.yes}</option>
          <option value="no">{field.no}</option>
        </NativeSelect>
      </div>
    ));

  let countText: string;
  if (q) {
    countText = shownSearch && !searchWaiting
      ? `נמצאו ${shownSearch.ids.length} לקוחות בחיפוש${shownSearch.note ? ` · ${shownSearch.note}` : ""}`
      : searchStatus ?? SEARCHING;
  } else {
    const total = totalCount ?? list.rows.length;
    countText = filterOn ? `סה״כ ${total} לקוחות אחרי סינון` : `סה״כ ${total} לקוחות`;
  }

  const totalShown = searchMode ? shownSearch?.ids.length ?? shownRows.length : Math.max(totalCount ?? 0, list.rows.length);
  let bottomLine: React.ReactNode = null;
  if (shownRows.length > 0 && !searchFailed) {
    if (active.loading) bottomLine = "טוען…";
    else if (active.offline && active.hasMore) bottomLine = "אין חיבור — שאר הלקוחות ייטענו כשיחזור החיבור.";
    else if (active.error && active.hasMore) {
      bottomLine = (
        <span className="inline-flex flex-wrap items-center justify-center gap-x-2">
          <span className="text-destructive">{active.error}</span>
          <Button type="button" variant="link" className="h-auto px-1 py-2 text-xs" onClick={active.retry}>
            נסו שוב
          </Button>
        </span>
      );
    } else bottomLine = `מציג ${shownRows.length} מתוך ${totalShown} לקוחות`;
  }

  // Nothing to list: the app's one empty box, with the way out of a search or
  // a filter (the projects and orders lists' own).
  let emptyState: React.ReactNode = null;
  if (searchFailed) {
    emptyState = (
      <EmptyState
        action={
          <Button type="button" variant="muted" size="sm" onClick={() => setQuery("")}>
            נקה חיפוש
          </Button>
        }
      >
        {searchStatus}
      </EmptyState>
    );
  } else if (shownRows.length === 0 && !searchWaiting) {
    emptyState = searchMode ? (
      <EmptyState
        action={
          <Button type="button" variant="muted" size="sm" onClick={() => setQuery("")}>
            נקה חיפוש
          </Button>
        }
      >
        <div>{filterOn ? "לא נמצאו לקוחות לפי החיפוש והסינון." : "לא נמצאו לקוחות לפי החיפוש."}</div>
        <SearchEverywhereLink query={query} className="mt-1 inline-block" />
      </EmptyState>
    ) : filterOn ? (
      <EmptyState
        action={
          <Button type="button" variant="muted" size="sm" onClick={clearFilters}>
            נקה סינון
          </Button>
        }
      >
        לא נמצאו לקוחות לפי הסינון.
      </EmptyState>
    ) : (
      <EmptyState>אין לקוחות עדיין.</EmptyState>
    );
  }

  return (
    <PageStack>
      {/* Phone: the search / filter / export row lives INSIDE the header strip
          (PageHeaderToolbar), so the page doesn't repeat the heading area. No
          "לקוח" + here: creating a customer belongs to the app's one quick-
          create + (top bar / bottom-nav FAB). */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          <div className="relative w-full min-w-0">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={loadIndex}
              placeholder="חיפוש בלקוחות…"
              aria-label="חיפוש בלקוחות"
              className="h-10 w-full ps-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={toggleLabel}
            aria-expanded={filtersOpen}
            aria-controls="customers-filters-overlay"
            className={cn("h-10 w-10 shrink-0", toggleClass)}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <FilterIcon className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" asChild>
            <Link href={exportHref} aria-label="ייצוא לאקסל" title="ייצוא לאקסל" prefetch={false} onClick={onExportClick}>
              <DownloadIcon className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </PageHeaderToolbar>

      {/* From md (a tablet) up the strip is gone, so the same three sit here —
          768–1023px had no search, filters, export or count at all. */}
      <div className={CUSTOMERS_TOOLBAR}>
        <div className="min-w-0">
          <label htmlFor="customers-search" className="text-sm text-muted-foreground">
            חיפוש לקוחות
          </label>
          <div className="relative mt-1">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="customers-search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={loadIndex}
              placeholder="שם, טלפון, אימייל או כתובת"
              className="h-11 ps-9"
            />
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          aria-expanded={filtersOpen}
          aria-controls="customers-filters-inline"
          className={cn("h-11 gap-1.5", toggleClass)}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <FilterIcon className="h-4 w-4" />
          {toggleLabel}
        </Button>
        {/* Follows whatever filter is applied — no filter exports every customer. */}
        <Button variant="outline" className="h-11 gap-1.5" asChild>
          <Link href={exportHref} prefetch={false} onClick={onExportClick}>
            <DownloadIcon className="h-4 w-4" />
            ייצוא לאקסל
          </Link>
        </Button>
      </div>

      {/* Phone: the filters drop DOWN OVER the list, pinned right under the
          sticky header (the top bar and the strip, whatever its height —
          --page-sticky-h) — not inline at the top of the page, which changed
          something you couldn't see when opened halfway down the list. */}
      {filtersOpen ? (
        <>
          <button
            type="button"
            aria-label="סגירת סינון"
            className="fixed inset-x-0 bottom-0 top-[calc(60px+var(--page-sticky-h,0px))] z-20 bg-black/30 md:hidden"
            onClick={() => setFiltersOpen(false)}
          />
          <div
            id="customers-filters-overlay"
            className="fixed inset-x-0 top-[calc(60px+var(--page-sticky-h,0px))] z-20 border-b border-border bg-card p-3 shadow-lg md:hidden"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">סינון</span>
              <IconButton
                icon={CloseIcon}
                label="סגירת סינון"
                variant="ghost"
                size="default"
                className="-me-2 text-muted-foreground"
                onClick={() => setFiltersOpen(false)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">{filterFields("phone")}</div>
            {filterOn ? (
              <Button type="button" variant="muted" className="mt-3 w-full" onClick={clearFilters}>
                נקה סינון
              </Button>
            ) : null}
          </div>
          {/* Tablet and up there's no sticky strip, so the filters sit inline. */}
          <div id="customers-filters-inline" className="hidden space-y-3 md:block">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{filterFields("inline")}</div>
            {filterOn ? (
              <div className="flex justify-end">
                <Button type="button" variant="muted" size="sm" onClick={clearFilters}>
                  נקה סינון
                </Button>
              </div>
            ) : null}
          </div>
        </>
      ) : filterOn ? (
        <CustomersFilterSummaryLine summary={customersFilterSummary(filters)} onClear={clearFilters} />
      ) : null}

      {/* The phone's top bar carries the count; from md it's this line. Its
          height is held for the "לא מקוון" pill, so the pill can't push the
          list down when the search index comes from the device's copy. */}
      <div className={CUSTOMERS_COUNT_ROW}>
        <span>{countText}</span>
        {indexStale ? <StaleDataBadge savedAt={indexSavedAt} /> : null}
      </div>

      <div
        className={cn(
          "transition-opacity duration-150",
          filterPending || searchWaiting ? "pointer-events-none opacity-50" : "opacity-100"
        )}
      >
        {emptyState ?? (
          <ResponsiveDataView
            breakpoint="lg"
            mobile={
              <>
                <div className="grid grid-cols-1 gap-2">
                  <div className={CUSTOMERS_HINT_ROW}>
                    <p className={CUSTOMERS_HINT_TEXT}>{CUSTOMERS_SWIPE_HINT}</p>
                    {indexStale ? <StaleDataBadge savedAt={indexSavedAt} className="md:hidden" /> : null}
                  </div>
                  {shownRows.map((row) => {
                    const id = rowId(row);
                    const name = s(row, "customer_name") || "לקוח";
                    const phone = s(row, "phone");
                    return (
                      <SwipeActions
                        key={id || name}
                        className="border border-border/70 shadow-card"
                        open={swipedRow === id}
                        onOpenChange={(next) => setSwipedRow(next ? id : null)}
                        actions={[
                          {
                            key: "project",
                            label: "פרויקט",
                            icon: <ProjectIcon className="h-5 w-5" />,
                            className: "bg-secondary",
                            onSelect: () => goTo(newProjectHref(id)),
                          },
                          {
                            key: "order",
                            label: "הזמנה",
                            icon: <OrderIcon className="h-5 w-5" />,
                            className: "bg-secondary",
                            onSelect: () => goTo(newOrderHref(id)),
                          },
                          {
                            key: "edit",
                            label: "עריכה",
                            icon: <EditIcon className="h-5 w-5" />,
                            className: "bg-secondary-2",
                            onSelect: () => void openEdit(row),
                          },
                        ]}
                      >
                        <div
                          className={cn("block cursor-pointer", LIST_CARD_BODY)}
                          {...rowNavigateProps(router, customerHref(id))}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                <span className={LIST_CARD_NAME}>{name}</span>
                                {row.active === false ? (
                                  <Badge variant="neutral" className={LIST_CARD_BADGE}>
                                    לא פעיל
                                  </Badge>
                                ) : null}
                              </div>
                              {/* The number as plain text — a tap on it opens the
                                  customer like the rest of the card; the green
                                  phone in the corner calls (the four sections'
                                  one look for "call"). */}
                              {phone ? (
                                <div className={cn("mt-0.5", LIST_CARD_META)}>
                                  <span dir="ltr">{phone}</span>
                                </div>
                              ) : null}
                            </div>
                            {phone && isDialable(phone) ? (
                              <CallIconButton phone={phone} name={name} className="shrink-0" />
                            ) : null}
                          </div>
                          <CardFacts row={row} />
                        </div>
                      </SwipeActions>
                    );
                  })}
                </div>
                {active.hasMore ? (
                  <div ref={searchMode ? searchList.mobileSentinelRef : list.mobileSentinelRef} className="h-1" />
                ) : null}
              </>
            }
            desktop={
              <DataTableShell
                ref={searchMode ? searchList.scrollRef : list.scrollRef}
                tableClassName={CUSTOMERS_TABLE_CLASS}
                colgroup={CUSTOMERS_COLUMNS.map((column) => (
                  <col key={column.key} className={column.width} />
                ))}
                header={CUSTOMERS_COLUMNS.map((column) => (
                  <th key={column.key} className={CUSTOMERS_HEAD_CELL}>
                    {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
                  </th>
                ))}
                footer={
                  active.hasMore ? (
                    <div ref={searchMode ? searchList.sentinelRef : list.sentinelRef} className="h-1" />
                  ) : null
                }
              >
                {shownRows.map((row) => {
                  const id = rowId(row);
                  const name = s(row, "customer_name") || "לקוח";
                  const invoiceName = s(row, "name_for_invoice");
                  const phone = s(row, "phone");
                  const email = s(row, "email");
                  const address = s(row, "address");
                  // The saved drop-off point, else Google's point of a full address.
                  const pin = pinFrom(row.delivery_lat, row.delivery_lng) ?? ((row.address_point as DeliveryPin | null | undefined) ?? null);
                  const morningId = s(row, "morning_client_id");
                  const debt = n(row, "open_balance");
                  const rent = n(row, "rent_owed");
                  const pending = row[ENRICH_PENDING] === true;
                  return (
                    <tr
                      key={id || name}
                      className="cursor-pointer align-middle hover:bg-muted/20 focus-visible:bg-muted/20"
                      // A client navigation, and the customer's page fetched
                      // ahead while the mouse rests on its row.
                      {...rowNavigateProps(router, customerHref(id))}
                    >
                      <td className={CUSTOMERS_CELL}>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="font-medium leading-tight">{name}</span>
                          <CustomerFlags row={row} withInactive />
                        </div>
                        {invoiceName && invoiceName !== name ? (
                          <div className="text-xs leading-tight text-muted-foreground">שם לחשבונית: {invoiceName}</div>
                        ) : null}
                      </td>
                      <td className={CUSTOMERS_CELL}>
                        {/* The phone field sometimes holds an email: it breaks inside the cell. */}
                        <div className="leading-tight [overflow-wrap:anywhere]">
                          {phone ? (
                            <ContactLink
                              kind={phone.includes("@") ? "mailto" : "tel"}
                              value={phone}
                              className="hover:text-secondary hover:underline"
                            >
                              <span dir="ltr">{phone}</span>
                            </ContactLink>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </div>
                        {email ? (
                          <div className="text-xs leading-tight text-muted-foreground [overflow-wrap:anywhere]">
                            <ContactLink kind="mailto" value={email} className="hover:text-secondary hover:underline">
                              {email}
                            </ContactLink>
                          </div>
                        ) : null}
                      </td>
                      <td className={CUSTOMERS_CELL}>
                        <div className="text-muted-foreground [overflow-wrap:anywhere]">
                          {address || pin ? (
                            <AddressLink address={address} pin={pin} notFound={addressNotFound(row)} className="inline-flex max-w-full items-center gap-1 align-middle">
                              <WazeIcon className="h-3 w-3 shrink-0" />
                              <span>{address || "נקודה שמורה"}</span>
                            </AddressLink>
                          ) : (
                            "—"
                          )}
                        </div>
                      </td>
                      <td className={CUSTOMERS_CELL}>
                        {pending ? (
                          <PillPlaceholder className="w-14" />
                        ) : morningId ? (
                          <a href={morningClientUrl(morningId)} target="_blank" rel="noreferrer">
                            <Badge variant="success" className={LIST_CARD_BADGE}>
                              Morning
                            </Badge>
                          </a>
                        ) : (
                          <Badge variant="neutral" className={LIST_CARD_BADGE}>
                            ללא
                          </Badge>
                        )}
                      </td>
                      <td className={cn(CUSTOMERS_CELL, "tabular-nums")}>
                        {pending ? <Skeleton className="h-4 w-6" /> : n(row, "orders_count")}
                      </td>
                      <td className={cn(CUSTOMERS_CELL, "tabular-nums")}>
                        {pending ? <Skeleton className="h-4 w-6" /> : n(row, "projects_count")}
                      </td>
                      <td className={CUSTOMERS_CELL}>
                        {/* Whole shekels, and it wraps rather than spill into the
                            next column at a bigger text size. */}
                        {pending ? (
                          <Skeleton className="h-4 w-12" />
                        ) : debt > 0 || rent > 0 ? (
                          <>
                            {debt > 0 ? (
                              <span className="block font-medium tabular-nums text-destructive [overflow-wrap:anywhere]">
                                {formatMoneyRounded(debt)}
                              </span>
                            ) : null}
                            {/* A tenant's rent owed, by the rent page's rule (owner, 2026-10-25). */}
                            {rent > 0 ? (
                              <span className="block text-xs font-medium tabular-nums text-destructive [overflow-wrap:anywhere]">
                                חוב שכירות {formatMoneyRounded(rent)}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={CUSTOMERS_CELL}>
                        <CustomerRowActionsMenu
                          onEdit={() => void openEdit(row)}
                          onNewOrder={() => goTo(newOrderHref(id))}
                          onNewProject={() => goTo(newProjectHref(id))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </DataTableShell>
            }
          />
        )}
      </div>

      {bottomLine ? <div className="pt-1 text-center text-xs text-muted-foreground">{bottomLine}</div> : null}

      {/* No create dialog on this page — "לקוח" is a tile in the global + menu. */}
      <EditCustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={editTarget}
        onSaved={applySaved}
        onUndone={applySaved}
      />
    </PageStack>
  );
}
