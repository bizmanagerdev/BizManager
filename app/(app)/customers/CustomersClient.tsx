"use client";
import { toHebrewError } from "@/lib/error-messages";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { offlineFetch } from "@/lib/offline-queue";
import { loadCustomerRowsByIds, loadMoreCustomers } from "@/app/(app)/customers/actions";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import type { CustomersFilters } from "@/app/(app)/customers/loadCustomers";
import { EditCustomerDialog, type EditCustomerInput } from "@/components/customers/EditCustomerDialog";
import {
  AdaptiveCell,
  AdaptiveDialog,
  AdaptiveGrid,
  PageStack,
} from "@/components/layout/page-layout";
import StaleDataBadge from "@/components/layout/StaleDataBadge";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { shouldIgnoreRowNavigation } from "@/lib/ui/row-navigation";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { ChevronLeftIcon, CloseIcon, DownloadIcon, EditIcon, FilterIcon, OrderIcon, ProjectIcon, SearchIcon, WazeIcon } from "@/components/ui/icons";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { AddressLink } from "@/components/ui/address-link";
import { ContactTapZone } from "@/components/ui/contact-link";
import { Button } from "@/components/ui/button";
import { EditButton } from "@/components/ui/icon-button";
import { Field } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { formatShortDate } from "@/lib/date";
import MorningCustomerCard from "@/components/morning/MorningCustomerCard";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Row = Record<string, unknown>;
type FilterMode = "all" | "yes" | "no";

const s = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};
const n = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const p = Number(v);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
};
const contactsOf = (row: Row): Row[] => (Array.isArray(row.contacts) ? (row.contacts as Row[]) : []);
const ils = (v: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(v);
const dateText = (v: string) => {
  return formatShortDate(v);
};
const morningClientUrl = (morningClientId: string) =>
  `https://app.greeninvoice.co.il/incomes/clients/${encodeURIComponent(morningClientId)}/documents`;

function customerFlagBadgeClass(tone: "success" | "danger" | "neutral" | "info") {
  return getStatusColorClasses(tone);
}

export default function CustomersClient({
  initialRows,
  initialHasMore = false,
  initialEditCustomerId = "",
  initialAddContactCustomerId = "",
  totalCount,
  initialFilters,
}: {
  initialRows: Row[];
  initialHasMore?: boolean;
  initialEditCustomerId?: string;
  initialAddContactCustomerId?: string;
  totalCount?: number;
  initialFilters?: {
    withProjects: FilterMode;
    withOrders: FilterMode;
    withDebt: FilterMode;
    activeOnly: FilterMode;
  };
}) {
  const router = useRouter();
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  const {
    search: searchCustomerIndex,
    loading: customerIndexLoading,
    stale: indexStale,
    savedAt: indexSavedAt,
  } = useCustomerSearchIndex();
  const [apiSearchRows, setApiSearchRows] = useState<Row[] | null>(null);
  const [handledInitialEdit, setHandledInitialEdit] = useState(false);
  const [handledInitialAddContact, setHandledInitialAddContact] = useState(false);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(
      initialFilters && (
        initialFilters.withProjects !== "all" ||
        initialFilters.withOrders !== "all" ||
        initialFilters.withDebt !== "all" ||
        initialFilters.activeOnly !== "all"
      )
    )
  );
  const withProjects = initialFilters?.withProjects ?? "all";
  const withOrders = initialFilters?.withOrders ?? "all";
  const withDebt = initialFilters?.withDebt ?? "all";
  const activeOnly = initialFilters?.activeOnly ?? "all";

  // Fetch-from-DB-as-you-scroll: accumulate customer pages and pull the next one
  // from the server when the bottom comes into view (no "next page" button).
  const fetchFilters = useMemo<CustomersFilters>(
    () => ({ withProjects, withOrders, withDebt, activeOnly }),
    [withProjects, withOrders, withDebt, activeOnly]
  );
  const fetchPage = useCallback(
    (page: number) => loadMoreCustomers(page, fetchFilters),
    [fetchFilters]
  );
  const getRowId = useCallback((row: Row) => s(row, "customer_id"), []);
  const {
    rows,
    setRows,
    hasMore,
    loading: loadingMore,
    sentinelRef,
    mobileSentinelRef,
    scrollRef,
  } = useInfiniteScroll<Row>({
    initialRows,
    initialHasMore,
    fetchPage,
    getId: getRowId,
  });

  function applyFilter(next: { withProjects?: FilterMode; withOrders?: FilterMode; withDebt?: FilterMode; activeOnly?: FilterMode }) {
    const merged = {
      withProjects: next.withProjects ?? withProjects,
      withOrders: next.withOrders ?? withOrders,
      withDebt: next.withDebt ?? withDebt,
      activeOnly: next.activeOnly ?? activeOnly,
    };
    const params = new URLSearchParams();
    if (merged.withProjects !== "all") params.set("with_projects", merged.withProjects);
    if (merged.withOrders !== "all") params.set("with_orders", merged.withOrders);
    if (merged.withDebt !== "all") params.set("with_debt", merged.withDebt);
    if (merged.activeOnly !== "all") params.set("active_only", merged.activeOnly);
    const qs = params.toString();
    router.push(qs ? `/customers?${qs}` : "/customers", { scroll: false });
  }

  // Export mirrors whatever filter is currently applied — same four params
  // applyFilter puts on the URL — so "no filter" naturally means "all customers".
  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (withProjects !== "all") params.set("with_projects", withProjects);
    if (withOrders !== "all") params.set("with_orders", withOrders);
    if (withDebt !== "all") params.set("with_debt", withDebt);
    if (activeOnly !== "all") params.set("active_only", activeOnly);
    const qs = params.toString();
    return qs ? `/api/customers/export?${qs}` : "/api/customers/export";
  }, [withProjects, withOrders, withDebt, activeOnly]);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditCustomerInput | null>(null);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactErr, setContactErr] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [targetCustomerName, setTargetCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactWhatsapp, setContactWhatsapp] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [contactPrimary, setContactPrimary] = useState(false);
  const [contactActive, setContactActive] = useState(true);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setApiSearchRows(null); return; }
    if (customerIndexLoading) return; // index still loading on first use
    let cancelled = false;

    // Instant: match the cached index in memory and paint the basic rows now.
    const matched = searchCustomerIndex(q, 50);
    const basicRows = matched.map((c) => ({
      customer_id: c.id, customer_name: c.name, name: c.name,
      phone: c.phone, whatsapp: c.whatsapp, email: c.email, address: c.address,
      name_for_invoice: c.name_for_invoice,
      requires_prepayment: c.requires_prepayment,
      contacts: c.contacts,
      orders_count: 0, projects_count: 0, total_sales: 0, total_paid: 0, open_balance: 0,
    }));
    setApiSearchRows(basicRows);

    // Then enrich (counts/totals) in the background, debounced, preserving order.
    const timer = setTimeout(async () => {
      try {
        const { rows: enriched } = await loadCustomerRowsByIds(matched.map((c) => c.id));
        if (cancelled || enriched.length === 0) return;
        const enrichedById = new Map(enriched.map((row) => [s(row, "customer_id"), row]));
        setApiSearchRows(basicRows.map((row) => enrichedById.get(row.customer_id) ?? row));
      } catch { /* ignore */ }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, searchCustomerIndex, customerIndexLoading]);

  const filtered = useMemo(() => {
    // When searching: API returns full-DB matches (search is global). When not searching:
    // server already applied the filters via URL params, so we just use the rows as-is.
    return apiSearchRows ?? rows;
  }, [rows, apiSearchRows]);

  useEffect(() => {
    if (handledInitialEdit || !initialEditCustomerId || rows.length === 0) return;
    const row = rows.find((current) => s(current, "customer_id") === initialEditCustomerId);
    if (!row) return;
    openEdit(row);
    setHandledInitialEdit(true);
  }, [handledInitialEdit, initialEditCustomerId, rows]);

  useEffect(() => {
    if (handledInitialAddContact || !initialAddContactCustomerId || rows.length === 0) return;
    const row = rows.find((current) => s(current, "customer_id") === initialAddContactCustomerId);
    if (!row) return;
    openAddContact(row);
    setHandledInitialAddContact(true);
  }, [handledInitialAddContact, initialAddContactCustomerId, rows]);

  function openEdit(row: Row) {
    setEditTarget({
      id: s(row, "customer_id"),
      name: s(row, "name") || s(row, "customer_name"),
      name_for_invoice: s(row, "name_for_invoice") || null,
      registration_number: s(row, "registration_number") || null,
      phone: s(row, "phone") || null,
      whatsapp: s(row, "whatsapp") || null,
      email: s(row, "email") || null,
      address: s(row, "address") || null,
      notes: s(row, "notes") || null,
      active: row.active !== false,
      requires_prepayment: row.requires_prepayment === true,
      linked_user_id: typeof row.linked_user_id === "string" ? row.linked_user_id : null,
      contacts: contactsOf(row),
    });
    setEditOpen(true);
  }

  function applySavedCustomer(u: Row, savedContacts: Row[]) {
    setRows((prev) =>
      prev.map((row) =>
        s(row, "customer_id") !== s(u, "id")
          ? row
          : {
              ...row,
              customer_name: s(u, "name") || s(row, "customer_name"),
              name: s(u, "name") || s(row, "name"),
              name_for_invoice: s(u, "name_for_invoice"),
              registration_number: s(u, "registration_number"),
              phone: s(u, "phone"),
              whatsapp: s(u, "whatsapp"),
              email: s(u, "email"),
              address: s(u, "address"),
              notes: s(u, "notes"),
              active: u.active !== false,
              requires_prepayment: u.requires_prepayment === true,
              // Only present when the edit actually touched the link — otherwise
              // keep the row's value instead of dropping the עובד badge.
              linked_user_id: "linked_user_id" in u ? u.linked_user_id : row.linked_user_id,
              contacts: savedContacts,
            }
      )
    );
  }

  function openAddContact(row: Row) {
    setContactErr("");
    setTargetCustomerId(s(row, "customer_id"));
    setTargetCustomerName(s(row, "customer_name") || "לקוח");
    setContactName("");
    setContactRole("");
    setContactPhone("");
    setContactEmail("");
    setContactWhatsapp("");
    setContactNotes("");
    setContactPrimary(false);
    setContactActive(true);
    setContactOpen(true);
  }

  async function createContact() {
    if (contactLoading) return;
    setContactErr("");
    if (!targetCustomerId) return setContactErr("חסר לקוח.");
    if (!contactName.trim()) return setContactErr("יש למלא שם איש קשר.");
    setContactLoading(true);
    try {
      const result = await offlineFetch(
        "/api/customer-contacts/create",
        {
          customer_id: targetCustomerId,
          full_name: contactName.trim(),
          role: contactRole.trim() || null,
          phone: contactPhone.trim() || null,
          email: contactEmail.trim() || null,
          whatsapp: contactWhatsapp.trim() || null,
          is_primary: contactPrimary,
          active: contactActive,
          notes: contactNotes.trim() || null,
        },
        "איש קשר חדש",
        { idempotent: true }
      );
      if (result.queued) {
        // Will appear in the list after it syncs and the page refreshes.
        setContactOpen(false);
        return;
      }
      const json = result.ok ? (result.data as { contact?: Row } | null) : null;
      if (!result.ok || !json?.contact) {
        return setContactErr((result.ok ? "יצירת איש קשר נכשלה." : result.error) || "יצירת איש קשר נכשלה.");
      }
      setRows((prev) =>
        prev.map((row) => {
          if (s(row, "customer_id") !== targetCustomerId) return row;
          const current = contactsOf(row);
          let next = [json.contact as Row, ...current];
          if ((json.contact as Row).is_primary === true) {
            next = next.map((c, i) => (i === 0 ? c : { ...c, is_primary: false }));
          }
          return { ...row, contacts: next };
        })
      );
      setContactOpen(false);
    } catch (e: unknown) {
      setContactErr(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setContactLoading(false);
    }
  }

  function customerDetailsHref(customerId: string) {
    return `/customers/${encodeURIComponent(customerId)}`;
  }

  function openCustomerDetails(customerId: string) {
    if (!customerId) return;
    emitNavigationStart();
    window.location.href = customerDetailsHref(customerId);
  }

  // Names the page in the mobile top bar (no sidebar on a phone to say where you
  // are). The count rides along as the subtitle and follows the active filter.
  useSetPageTitle("לקוחות", `${totalCount ?? filtered.length} לקוחות`);

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

  // Same four selects for the phone overlay and the inline tablet/desktop row.
  const filterFields = (
    <>
      <FilterSelect
        label="פרויקטים"
        value={withProjects}
        onChange={(v) => applyFilter({ withProjects: v })}
        yes="עם פרויקטים"
        no="ללא פרויקטים"
      />
      <FilterSelect
        label="הזמנות"
        value={withOrders}
        onChange={(v) => applyFilter({ withOrders: v })}
        yes="עם הזמנות"
        no="ללא הזמנות"
      />
      <FilterSelect
        label="חוב פתוח"
        value={withDebt}
        onChange={(v) => applyFilter({ withDebt: v })}
        yes="חייבים כסף"
        no="ללא חוב"
      />
      <FilterSelect
        label="סטטוס"
        value={activeOnly}
        onChange={(v) => applyFilter({ activeOnly: v })}
        yes="פעילים"
        no="לא פעילים"
      />
    </>
  );

  return (
    <PageStack>
      {/* Mobile toolbar lives INSIDE the dark header (see PageHeaderToolbar), so
          the page doesn't repeat the heading area in a second lighter strip. No
          "חיפוש לקוחות" label and no total line here either — the placeholder and
          the header subtitle already say both. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2">
          {/* No "לקוח" + button here: creating a customer belongs to the app's one
              quick-create + (top bar / bottom-nav FAB), which is on screen on this
              page too — see components/layout/QuickCreateMenu.tsx. */}
          {/* Icon + a short "חיפוש..." — what it searches over is discoverable by
              using it, and spelling out every field ate the whole bar. */}
          <div className="relative w-full min-w-0">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש..."
              className="h-10 w-full rounded-xl ps-9"
            />
          </div>
          {/* Filters read as ON via a sky fill — the one place colour is earned. */}
          <Button
            type="button"
            size="icon"
            aria-label={filtersOpen ? "הסתר מסננים" : "הצג מסננים"}
            className={
              filtersOpen
                ? "h-10 w-10 shrink-0 rounded-xl"
                : "h-10 w-10 shrink-0 rounded-xl "
            }
            onClick={() => setFiltersOpen((x) => !x)}
          >
            <FilterIcon className="h-4 w-4" />
          </Button>
          {/* Follows whatever filter is applied above — no filter set exports
              every customer, same rule the desktop button below uses. */}
          <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-xl" asChild>
            <Link href={exportHref} aria-label="יצוא לאקסל" prefetch={false}>
              <DownloadIcon className="h-4 w-4" />
            </Link>
          </Button>
        </div>
        {indexStale ? (
          <div className="mt-2 flex justify-end">
            <StaleDataBadge savedAt={indexSavedAt} />
          </div>
        ) : null}
      </PageHeaderToolbar>

      <AdaptiveGrid variant="customersToolbar" className="hidden lg:grid">
        <AdaptiveCell variant="customersPrimary">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm text-muted-foreground">חיפוש לקוחות</label>
            {indexStale ? <StaleDataBadge savedAt={indexSavedAt} /> : null}
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="שם, טלפון, אימייל או כתובת"
            className="h-11"
          />
        </AdaptiveCell>
        <AdaptiveCell variant="customersSecondary">
          <label className="text-sm text-muted-foreground opacity-0">מסננים</label>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setFiltersOpen((x) => !x)}
          >
            {filtersOpen ? "הסתר מסננים" : "הצג מסננים"}
          </Button>
        </AdaptiveCell>
        <AdaptiveCell variant="customersSecondary">
          <label className="text-sm text-muted-foreground opacity-0">יצוא</label>
          {/* Follows whatever filter is applied above — no filter set exports
              every customer. */}
          <Button type="button" variant="outline" className="h-11 w-full gap-1.5" asChild>
            <Link href={exportHref} prefetch={false}>
              <DownloadIcon className="h-4 w-4" />
              יצוא לאקסל
            </Link>
          </Button>
        </AdaptiveCell>
      </AdaptiveGrid>

      {/* Phone: the filters drop DOWN OVER the list, pinned right under the sticky
          header (60px top bar + 52px toolbar) — not inline at the top of the page.
          Inline meant that opening filters while scrolled halfway down the list
          changed something you couldn't see. As an overlay it always appears
          where you're looking, straight under the button you just pressed. */}
      {filtersOpen ? (
        <>
          <button
            type="button"
            aria-label="סגירת מסננים"
            className="fixed inset-0 top-[112px] z-20 bg-black/30 md:hidden"
            onClick={() => setFiltersOpen(false)}
          />
          <div className="fixed inset-x-0 top-[112px] z-20 border-b border-border bg-card p-3 shadow-lg md:hidden">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">מסננים</span>
              <button
                type="button"
                aria-label="סגירת מסננים"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
                onClick={() => setFiltersOpen(false)}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">{filterFields}</div>
          </div>
        </>
      ) : null}

      {/* Tablet and up there's no sticky page toolbar, so the filters stay inline. */}
      {filtersOpen ? (
        <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-4">{filterFields}</div>
      ) : null}

      <div className="hidden text-sm text-muted-foreground lg:block">
        {(() => {
          const usingApiSearch = apiSearchRows !== null;
          const hasActiveFilter =
            withProjects !== "all" ||
            withOrders !== "all" ||
            withDebt !== "all" ||
            activeOnly !== "all";
          if (usingApiSearch) {
            return `נמצאו ${filtered.length} לקוחות בחיפוש`;
          }
          if (hasActiveFilter) {
            return `סה״כ ${totalCount ?? filtered.length} לקוחות אחרי סינון`;
          }
          return `סה״כ ${totalCount ?? filtered.length} לקוחות`;
        })()}
      </div>

      {/* Mobile list. The four action buttons that used to sit under every card
          are now behind a swipe — the card stays compact so more customers fit
          on a screen, which is the whole point of the list. */}
      <div className="grid grid-cols-1 gap-2 xl:hidden">
        <p className="px-1 text-[11px] text-muted-foreground">
          החלק כרטיס ימינה לפעולות · הקש לפרטים
        </p>
        {filtered.map((row) => {
          const id = s(row, "customer_id");
          const customerName = s(row, "customer_name") || "לקוח";
          const linkedMorningClientId = s(row, "morning_client_id");
          const openBalance = n(row, "open_balance");
          const phone = s(row, "phone");
          const ordersCount = n(row, "orders_count");
          const projectsCount = n(row, "projects_count");
          const rowKey = id || customerName;
          return (
            <SwipeActions
              key={rowKey}
              className="border border-border/70 shadow-sm"
              open={swipedRow === rowKey}
              onOpenChange={(next) => setSwipedRow(next ? rowKey : null)}
              actions={[
                {
                  key: "project",
                  label: "פרויקט",
                  icon: <ProjectIcon className="h-5 w-5" />,
                  className: "bg-secondary",
                  onSelect: () => router.push(`/projects?create=1&customer_id=${encodeURIComponent(id)}`),
                },
                {
                  key: "order",
                  label: "הזמנה",
                  icon: <OrderIcon className="h-5 w-5" />,
                  className: "bg-secondary-3",
                  onSelect: () => router.push(`/sales/orders/new?customer_id=${encodeURIComponent(id)}`),
                },
                {
                  key: "edit",
                  label: "עריכה",
                  icon: <EditIcon className="h-5 w-5" />,
                  className: "bg-secondary-2",
                  onSelect: () => openEdit(row),
                },
              ]}
            >
              <div
                role="link"
                tabIndex={0}
                onClick={(event) => {
                  if (shouldIgnoreRowNavigation(event.target)) return;
                  openCustomerDetails(id);
                }}
                onKeyDown={(event) => {
                  if (shouldIgnoreRowNavigation(event.target)) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openCustomerDetails(id);
                }}
                className="flex w-full min-w-0 cursor-pointer items-center gap-3 p-3 text-right"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-sm font-semibold leading-snug">{customerName}</div>
                  {phone ? (
                    // A <div> (ContactTapZone), not an <a href="tel:…"> — see its own
                    // comment: a real tel: link claims the long-press gesture for the
                    // browser's own menu instead of leaving the number selectable/copyable.
                    <ContactTapZone
                      kind="tel"
                      value={phone}
                      className="inline-block text-xs text-muted-foreground hover:text-secondary hover:underline"
                    >
                      <span dir="ltr">{phone}</span>
                    </ContactTapZone>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ordersCount > 0 ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{ordersCount} הזמנות</Badge>
                    ) : null}
                    {projectsCount > 0 ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{projectsCount} פרויקטים</Badge>
                    ) : null}
                    {row.linked_user_id ? (
                      <Badge className={`${customerFlagBadgeClass("info")} px-1.5 py-0 text-[10px]`}>עובד</Badge>
                    ) : null}
                    {row.requires_prepayment === true ? (
                      <Badge className={`${customerFlagBadgeClass("danger")} px-1.5 py-0 text-[10px]`}>תשלום מראש</Badge>
                    ) : null}
                    {row.active === false ? (
                      <Badge className={`${customerFlagBadgeClass("danger")} px-1.5 py-0 text-[10px]`}>לא פעיל</Badge>
                    ) : null}
                    {linkedMorningClientId ? (
                      <Badge className={`${customerFlagBadgeClass("success")} px-1.5 py-0 text-[10px]`}>Morning</Badge>
                    ) : null}
                  </div>
                </div>
                {openBalance > 0 ? (
                  <div className="shrink-0 text-left">
                    <div className="whitespace-nowrap text-sm font-semibold tabular-nums text-destructive">
                      {ils(openBalance)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">יתרה</div>
                  </div>
                ) : null}
                <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </SwipeActions>
          );
        })}
      </div>
      {!apiSearchRows && hasMore ? <div ref={mobileSentinelRef} className="h-1 xl:hidden" /> : null}

      <Card className="hidden overflow-hidden border-border/70 shadow-sm xl:block">
        <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[17%]" />
            <col className="w-[15%]" />
            <col className="w-[14%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[6%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
            <col className="w-[16%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr className="border-b border-border/70 text-right">
              <th className="px-2 py-2 font-medium">לקוח</th>
              <th className="px-2 py-2 font-medium">טלפון ואימייל</th>
              <th className="px-2 py-2 font-medium">כתובת</th>
              <th className="px-2 py-2 font-medium">Morning</th>
              <th className="px-2 py-2 font-medium">הזמנות</th>
              <th className="px-2 py-2 font-medium">פרויקטים</th>
              <th className="px-2 py-2 font-medium">יתרה פתוחה</th>
              <th className="px-2 py-2 font-medium">סטטוס</th>
              <th className="px-2 py-2 font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {filtered.map((row) => {
              const id = s(row, "customer_id");
              const customerName = s(row, "customer_name") || "לקוח";
              const linkedMorningClientId = s(row, "morning_client_id");
              const openBalance = n(row, "open_balance");

              return (
                <tr
                  key={`${id || customerName}-desktop`}
                  className="cursor-pointer align-middle hover:bg-muted/20 focus-visible:bg-muted/20"
                  tabIndex={0}
                  role="link"
                  onClick={(event) => {
                    if (shouldIgnoreRowNavigation(event.target)) return;
                    openCustomerDetails(id);
                  }}
                  onKeyDown={(event) => {
                    if (shouldIgnoreRowNavigation(event.target)) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    openCustomerDetails(id);
                  }}
                >
                  <td className="px-2 py-1.5">
                    <div className="truncate text-right font-medium leading-tight">{customerName}</div>
                    {s(row, "name_for_invoice") && s(row, "name_for_invoice") !== customerName ? (
                      <div className="truncate text-right text-xs leading-tight text-muted-foreground">
                        שם לחשבונית: {s(row, "name_for_invoice")}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate leading-tight">{s(row, "phone") || "-"}</div>
                    {s(row, "email") ? (
                      <div className="truncate text-xs leading-tight text-muted-foreground">{s(row, "email")}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate text-muted-foreground">
                      {s(row, "address") ? (
                        <AddressLink
                          address={s(row, "address")}
                          className="inline-flex max-w-full items-center gap-1 align-middle"
                        >
                          <WazeIcon className="h-3 w-3 shrink-0" />
                          <span className="truncate">{s(row, "address")}</span>
                        </AddressLink>
                      ) : (
                        "-"
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {linkedMorningClientId ? (
                      <a href={morningClientUrl(linkedMorningClientId)} target="_blank" rel="noreferrer">
                        <Badge className={`${customerFlagBadgeClass("success")} px-1.5 py-0 text-[10px]`}>Morning</Badge>
                      </a>
                    ) : (
                      <Badge className={`${customerFlagBadgeClass("neutral")} px-1.5 py-0 text-[10px]`}>ללא</Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{n(row, "orders_count")}</td>
                  <td className="px-2 py-1.5">{n(row, "projects_count")}</td>
                  <td className="px-2 py-1.5">
                    {openBalance > 0 ? (
                      <div className="truncate font-medium text-destructive">{ils(openBalance)}</div>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {row.linked_user_id ? (
                        <Badge className={`${customerFlagBadgeClass("info")} px-1.5 py-0 text-[10px]`}>עובד</Badge>
                      ) : null}
                      {row.requires_prepayment === true ? (
                        <Badge className={`${customerFlagBadgeClass("danger")} px-1.5 py-0 text-[10px]`}>תשלום מראש</Badge>
                      ) : null}
                      {openBalance > 0 ? (
                        <Badge className={`${customerFlagBadgeClass("danger")} px-1.5 py-0 text-[10px]`}>חוב פתוח</Badge>
                      ) : null}
                      {row.active === false ? (
                        <Badge className={`${customerFlagBadgeClass("danger")} px-1.5 py-0 text-[10px]`}>לא פעיל</Badge>
                      ) : (
                        <Badge className={`${customerFlagBadgeClass("success")} px-1.5 py-0 text-[10px]`}>פעיל</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-nowrap gap-1">
                      <Button asChild size="sm" className="h-7 px-2 text-xs">
                        <Link href={`/sales/orders/new?customer_id=${encodeURIComponent(id)}`}>
                          + הזמנה
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary" className="h-7 px-2 text-xs">
                        <Link href={`/projects?create=1&customer_id=${encodeURIComponent(id)}`}>
                          + פרויקט
                        </Link>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!apiSearchRows && hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
        </div>
      </Card>

      {!apiSearchRows ? (
        <div className="pt-1 text-center text-xs text-muted-foreground">
          {loadingMore
            ? "טוען…"
            : `מציג ${rows.length}${totalCount != null ? ` מתוך ${Math.max(totalCount, rows.length)}` : ""} לקוחות`}
        </div>
      ) : null}

      {/* No create dialog on this page — "לקוח" is a tile in the global + menu,
          which refreshes the route on save, so the new customer shows up here. */}

      <EditCustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={editTarget}
        onSaved={({ customer, contacts }) => applySavedCustomer(customer, contacts)}
      />

      <FormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        title="הוספת איש קשר"
        description={`לקוח: ${targetCustomerName}`}
        submitLabel="יצירת איש קשר"
        busyLabel="יוצר..."
        onSubmit={() => void createContact()}
        error={contactErr || undefined}
        busy={contactLoading}
      >
        <Field label="שם מלא *">
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="תפקיד">
          <Input value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
        </Field>
        <AdaptiveGrid variant="formTwo">
          <Field label="טלפון">
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
          <Field label="וואטסאפ">
            <Input value={contactWhatsapp} onChange={(e) => setContactWhatsapp(e.target.value)} />
          </Field>
        </AdaptiveGrid>
        <Field label="אימייל">
          <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </Field>
        <Field label="הערות">
          <div className="relative">
            <Textarea
              value={contactNotes}
              onChange={(e) => setContactNotes(e.target.value)}
              rows={3}
              className="pe-11"
            />
            <DictateButton
              onTranscript={(text) => setContactNotes((prev) => appendDictatedText(prev, text))}
              disabled={contactLoading}
              className="absolute bottom-1 end-1 h-8 w-8"
            />
          </div>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={contactPrimary}
            onChange={(e) => setContactPrimary(e.target.checked)}
          />
          <span>איש קשר ראשי</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={contactActive}
            onChange={(e) => setContactActive(e.target.checked)}
          />
          <span>פעיל</span>
        </label>
      </FormDialog>
    </PageStack>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  yes,
  no,
}: {
  label: string;
  value: FilterMode;
  onChange: (v: FilterMode) => void;
  yes: string;
  no: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">{label}</label>
      <NativeSelect
        value={value}
        onChange={(e) => onChange(e.target.value as FilterMode)}
      >
        <option value="all">הכל</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </NativeSelect>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ValueField({
  label,
  value,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`rounded-xl border bg-background px-3 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium leading-6 text-foreground ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CustomerDetailsDialog({
  row,
  open,
  onOpenChange,
  onEdit,
  onAddContact,
}: {
  row: Row | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onEdit: (row: Row) => void;
  onAddContact: (row: Row) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [navigationTarget, setNavigationTarget] = useState<"projects" | "sales" | "financial" | "documents" | "">("");
  const contacts = row ? contactsOf(row) : [];
  const activeContacts = contacts.filter((c) => c.active !== false);
  const inactiveContacts = contacts.filter((c) => c.active === false);
  const id = row ? s(row, "customer_id") : "";

  function navigateToCustomerPage(
    target: "projects" | "sales" | "financial" | "documents",
    path: string
  ) {
    if (!id) return;
    setNavigationTarget(target);
    startNavigation(() => {
      router.push(path);
    });
  }

  const customerNameParam = row ? s(row, "customer_name").trim() : "";
  const customerPageParam = (searchParams.get("page") ?? "").trim();
  const name = row ? s(row, "customer_name") || "לקוח" : "לקוח";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="details4xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>פרטי לקוח, אנשי קשר וקישורים מהירים.</DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="space-y-4">
            <AdaptiveGrid variant="customerStats">
              <Stat label="הזמנות" value={`${n(row, "orders_count")}`} />
              <Stat label="פרויקטים" value={`${n(row, "projects_count")}`} />
              <Stat label='סה"כ מכירות' value={ils(n(row, "total_sales"))} />
              <Stat label="יתרה פתוחה" value={ils(n(row, "open_balance"))} />
            </AdaptiveGrid>

            <AdaptiveGrid variant="customerPanels">
              <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
                <div className="font-semibold">פרטי לקוח</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ValueField label="שם לחשבונית" value={s(row, "name_for_invoice") || "-"} />
                  <ValueField label="ח.פ/ת.ז" value={s(row, "registration_number") || "-"} />
                  <ValueField label="וואטסאפ" value={s(row, "whatsapp") || "-"} />
                  <ValueField label="הזמנה אחרונה" value={dateText(s(row, "last_order_at"))} />
                  <ValueField label="תשלום אחרון" value={dateText(s(row, "last_payment_at"))} />
                  <ValueField
                    label="כתובת"
                    value={
                      s(row, "address") ? (
                        <AddressLink
                          address={s(row, "address")}
                          className="inline-flex items-start gap-1"
                        >
                          <WazeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="whitespace-pre-wrap">{s(row, "address")}</span>
                        </AddressLink>
                      ) : (
                        "-"
                      )
                    }
                    className="sm:col-span-2"
                    valueClassName="whitespace-pre-wrap"
                  />
                  <ValueField
                    label="הערות"
                    value={s(row, "notes") || "-"}
                    className="sm:col-span-2"
                    valueClassName="whitespace-pre-wrap"
                  />
                </div>
                {/* Edit is the pencil, as everywhere else — so it sits beside the
                    navigation buttons rather than posing as one of them. */}
                <div className="flex justify-end pt-1">
                  <EditButton onClick={() => onEdit(row)} label="עריכת לקוח" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "projects",
                        `/projects?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "projects" ? "פותח פרויקטים..." : "צפייה בפרויקטים"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "sales",
                        `/sales?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "sales" ? "פותח הזמנות..." : "צפייה בהזמנות"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "financial",
                        `/financial?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "financial" ? "פותח מידע פיננסי..." : "מידע פיננסי"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "documents",
                        `/documents?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "documents" ? "פותח מסמכים..." : "קבלות ומסמכים"}
                  </Button>
                </div>
              </div>

              <MorningCustomerCard
                customerId={id}
                morningClientId={s(row, "morning_client_id") || null}
                morningMatchStatus={s(row, "morning_match_status") || null}
                morningSyncedAt={s(row, "morning_synced_at") || null}
                morningLastSyncError={s(row, "morning_last_sync_error") || null}
                morningDocuments={Array.isArray(row.morning_documents) ? (row.morning_documents as never[]) : []}
                onChanged={() => router.refresh()}
              />

              <div className="space-y-2 rounded-md border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">אנשי קשר</div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onAddContact(row)}
                  >
                    הוספת איש קשר
                  </Button>
                </div>
                {contacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">אין אנשי קשר ללקוח זה.</p>
                ) : null}
                {activeContacts.map((c, i) => (
                  <div key={s(c, "id") || `${id}-active-${i}`} className="rounded-md border p-2 text-sm">
                    <div className="font-medium">
                      {s(c, "full_name") || `איש קשר ${i + 1}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s(c, "role") || "ללא תפקיד"} | {s(c, "phone") || "-"} |{" "}
                      {s(c, "email") || "-"}
                    </div>
                  </div>
                ))}
                {inactiveContacts.length > 0 ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive-soft p-2">
                    <div className="mb-1 text-xs font-medium text-destructive">
                      אנשי קשר לא פעילים
                    </div>
                    {inactiveContacts.map((c, i) => (
                      <div
                        key={s(c, "id") || `${id}-inactive-${i}`}
                        className="text-xs text-destructive"
                      >
                        {s(c, "full_name") || `איש קשר ${i + 1}`} | {s(c, "phone") || "-"}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </AdaptiveGrid>

          </div>
        ) : null}
      </AdaptiveDialog>
    </Dialog>
  );
}

