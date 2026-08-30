"use client";
import { toHebrewError } from "@/lib/error-messages";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownIcon, ArrowUpIcon, BalanceIcon, CalculatorIcon, ChartIcon, ClockIcon, CoinsIcon, FilterIcon, HistoryIcon, LedgerIcon, RefreshIcon, ScheduleIcon, SearchIcon, SuccessIcon, TrendChartIcon, UsersIcon } from "@/components/ui/icons";
import { TagPicker } from "@/components/tags/TagPicker";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import ProfitLossPanel from "@/app/(app)/financial/reports/ProfitLossPanel";
import BottomLinePanel from "@/app/(app)/financial/reports/BottomLinePanel";
import MonthlyTrendPanel from "@/app/(app)/financial/reports/MonthlyTrendPanel";
import ForecastPanel from "@/app/(app)/financial/reports/ForecastPanel";
import EarnedRevenuePanel from "@/app/(app)/financial/reports/EarnedRevenuePanel";
import ProductMarginPanel from "@/app/(app)/financial/reports/ProductMarginPanel";
import CustomerRankingPanel from "@/app/(app)/financial/reports/CustomerRankingPanel";
import type { CustomerRankingReport } from "@/lib/financial/customerRanking";
import type { ProductMarginReport } from "@/lib/financial/productMargin";
import PositionPanel from "@/app/(app)/financial/reports/PositionPanel";
import type { EarnedRevenueReport } from "@/lib/financial/earnedRevenue";
import type { ProjectBreakdown } from "@/lib/financial/projectBreakdown";
import type { DomainProofMap } from "@/lib/financial/domainProof";
import { formatRelativeDateLabel, formatShortDate } from "@/lib/date";
import { appendDictatedText } from "@/lib/dictation";
import {
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { monthRange, recentMonthKeys } from "@/lib/financial/periodPresets";
import { DomainSelect } from "@/components/financial/DomainSelect";
import DomainMultiSelect from "@/components/financial/DomainMultiSelect";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import type {
  FinancialEntry,
  FinancialPageData,
} from "@/lib/financial";
import { includePersonalRow } from "@/lib/financial/entries";
import {
  SelectField,
  SummaryCard,
  sourceKindLabel,
  sourceTypeTitle,
  stageLabel,
  stageVariant,
  typeAmountClass,
  typeLabel,
  typeVariant,
} from "./FinancialPage.ui";
import { cn } from "@/lib/utils";
import { useRevealOnScroll } from "@/hooks/useRevealOnScroll";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { uploadCheckPhotos } from "@/lib/payments/uploadCheckPhotos";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const HE_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

function readCachedIsAdmin(): boolean | null {
  try {
    const raw = localStorage.getItem("biz_viewer_role");
    if (!raw) return null;
    const { role, ts } = JSON.parse(raw) as { role: string; ts: number };
    if (Date.now() - ts > 24 * 60 * 60 * 1000) return null;
    return role === "admin";
  } catch {
    return null;
  }
}

type InitialFilters = {
  from: string;
  to: string;
  domain: string;
  sourceId: string;
  type: string;
  stage: string;
  q: string;
  ledgerPage: number;
  upcomingPage: number;
};

type Props = {
  data: FinancialPageData;
  earnedRevenue?: EarnedRevenueReport | null;
  projectBreakdown?: ProjectBreakdown | null;
  domainProof?: DomainProofMap | null;
  customerRanking?: CustomerRankingReport | null;
  productMargin?: ProductMarginReport | null;
  initialFilters: InitialFilters;
  /** "flow" = the cash-flow ledger page; "reports" = totals + domain views + P&L. */
  view?: "flow" | "reports";
  canManageExpenses: boolean;
  canViewCashflow: boolean;
  recurringProjects: Array<{ id: string; label: string }>;
  recurringOrders: Array<{ id: string; label: string }>;
  recurringProperties: Array<{ id: string; label: string }>;
};

type EditableExpenseEntry = FinancialEntry & {
  origin: "expense";
  expenseId: string;
  expenseCategory: string | null;
  expenseDescriptionRaw?: string | null;
  expenseNotes: string | null;
  expenseProjectId: string | null;
  expenseOrderId: string | null;
  expensePropertyId: string | null;
};

type IncomeCreateFormState = {
  businessDomain: ExpenseBusinessDomain | "";
  projectId: string;
  orderId: string;
  propertyId: string;
  amount: string;
  paymentDate: string;
  dueDate: string;
  paymentMethod: "bank_transfer" | "cash" | "check" | "credit_card" | "other";
  accountId: string;
  referenceNumber: string;
  checkNumber: string;
  notes: string;
  requiresSplit: boolean;
  tagIds: string[];
};

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function isEditableExpenseEntry(entry: FinancialEntry): entry is EditableExpenseEntry {
  return entry.origin === "expense" && typeof entry.expenseId === "string" && entry.expenseId.length > 0;
}

// Ledger/History tab search. Match on the entry's full searchText (notes,
// category, payment method/status, domain, payer — the same rich field the
// server-side filter uses), falling back to the display fields if it's absent.
// `q` is expected already trimmed + lowercased.
function entryMatchesQuery(entry: FinancialEntry, q: string): boolean {
  if (typeof entry.searchText === "string" && entry.searchText) {
    return entry.searchText.includes(q);
  }
  return [entry.description, entry.domainName, entry.sourceLabel, entry.reference, entry.recordedByName].some(
    (v) => typeof v === "string" && v.toLowerCase().includes(q)
  );
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function createIncomeFormState(): IncomeCreateFormState {
  return {
    businessDomain: "",
    projectId: "",
    orderId: "",
    propertyId: "",
    amount: "",
    paymentDate: todayIsoDate(),
    dueDate: "",
    paymentMethod: "bank_transfer",
    accountId: "",
    referenceNumber: "",
    checkNumber: "",
    notes: "",
    requiresSplit: false,
    tagIds: [],
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    params.delete(key);
    return;
  }

  params.set(key, String(value));
}

export default function FinancialPageClient({
  data,
  initialFilters,
  view = "flow",
  earnedRevenue = null,
  projectBreakdown = null,
  domainProof = null,
  customerRanking = null,
  productMargin = null,
  canManageExpenses,
  canViewCashflow,
  recurringProjects,
  recurringOrders,
  recurringProperties,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Inner report tab. Local state — switching it must not trigger a server
  // re-query, unlike the shared URL-driven filters. 5 views: overview / pl /
  // monthly / balance / forecast.
  const [reportTab, setReportTab] = useState("overview");
  // ── Global report toggles (drive every report tab, live in the top control row) ──
  //  reportBasis "cash"  = money that actually ENTERED accounts this period (liquidity, by date received).
  //              "earned"= money MADE this period (booked to the month of the work/sale).
  //  includeOpen  = also count open debts owed to/by me (cash → accrual). N/A in earned mode.
  //  includeHomeCharity / includeProperties = two INDEPENDENT toggles for the two
  //                     personal/off-books domain groups (see lib/financial/entries.ts).
  const [reportBasis, setReportBasis] = useState<"cash" | "earned">("earned");
  const [includeOpen, setIncludeOpen] = useState(false);
  const [includeHomeCharity, setIncludeHomeCharity] = useState(false);
  const [includeProperties, setIncludeProperties] = useState(false);
  // Global domain chips (empty = all) — live in the report control row and filter
  // the by-domain views (לפי תחום / חודשי) across every tab, not just one panel.
  const [selectedReportDomains, setSelectedReportDomains] = useState<string[]>([]);
  // Resolved P&L basis for the domain/waterfall views (earned wins; else cash±open).
  const plBasis: "cash" | "accrual" | "earned" =
    reportBasis === "earned" ? "earned" : includeOpen ? "accrual" : "cash";
  // Flow view: which table is shown (full ledger vs upcoming flow).
  const [flowTab, setFlowTab] = useState<"ledger" | "upcoming" | "history">("history");
  // Filter panel is collapsed by default; opens automatically when filters arrive active.
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      Boolean(
        initialFilters.q ||
          initialFilters.from ||
          initialFilters.to ||
          initialFilters.domain ||
          initialFilters.sourceId ||
          (initialFilters.type && initialFilters.type !== "all") ||
          (initialFilters.stage && initialFilters.stage !== "all")
      )
  );
  const [query, setQuery] = useState(initialFilters.q);
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [domain, setDomain] = useState(initialFilters.domain);
  const [sourceId, setSourceId] = useState(initialFilters.sourceId);
  const [type, setType] = useState(initialFilters.type);
  const [stage, setStage] = useState(initialFilters.stage);
  const [resolvedCanView, setResolvedCanView] = useState(canViewCashflow);

  useIsomorphicLayoutEffect(() => {
    const cached = readCachedIsAdmin();
    const effective = cached !== null ? cached : canViewCashflow;
    setResolvedCanView(effective);
  }, [canViewCashflow]);
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const queryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshResolveRef = useRef<(() => void) | null>(null);
  const sourceKind = data.sourceKind;
  const domainOptions = data.domainOptions;
  const sourceOptions = data.sourceOptions;
  const summaries = {
    actual: data.actualSummary,
    future: data.futureSummary,
    total: data.totalSummary,
  };
  const currentWorthNow =
    summaries.actual.net +
    data.openReceivablesSummary.inflow -
    data.openLiabilitiesSummary.outflow +
    data.loansSummary.lentOutstanding -
    data.loansSummary.borrowedOutstanding;
  const hasLoans =
    data.loansSummary.borrowedOutstanding > 0.5 || data.loansSummary.lentOutstanding > 0.5;
  const activeFilterCount = [
    query,
    from,
    to,
    domain,
    sourceId,
    type !== "all" ? type : "",
    stage !== "all" ? stage : "",
  ].filter(Boolean).length;
  const upcomingEntries = data.upcomingEntries;
  const ledgerEntries = data.ledgerEntries;

  // Deep link from the activity feed: /financial?focus=expense:<uuid> must OPEN
  // that expense's own dialog — the whole record, exactly as if it had been
  // clicked here — not merely scroll the page down to its row. Derived (not an
  // effect) so the dialog is already open on the first paint, and so closing it
  // doesn't fight the URL. `focusDismissed` remembers the close, since the param
  // stays in the address bar.
  const focusId = searchParams.get("focus");
  const [focusDismissed, setFocusDismissed] = useState<string | null>(null);
  const focusExpense = useMemo(() => {
    if (!focusId || focusDismissed === focusId) return null;
    const entry =
      ledgerEntries.find((e) => e.id === focusId) ?? upcomingEntries.find((e) => e.id === focusId);
    // Not an expense (or filtered out of the loaded window) → the row flash in
    // FocusHighlighter is the fallback.
    return entry && isEditableExpenseEntry(entry) ? entry : null;
  }, [focusId, focusDismissed, ledgerEntries, upcomingEntries]);
  // Scroll-to-load the upcoming list instead of paging it (same feel as the ledger).
  const upcomingReveal = useRevealOnScroll(upcomingEntries, { initial: 15, step: 15, watch: flowTab });
  const pagedUpcomingEntries = upcomingReveal.visibleItems;

  // ── Ledger-only client controls (instant, no route reload) ──────────────────
  const [ledgerVisible, setLedgerVisible] = useState(60);
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerMonth, setLedgerMonth] = useState("");
  const [ledgerSort, setLedgerSort] = useState<{ key: "date" | "amount" | "domain"; dir: "asc" | "desc" }>({
    key: "date",
    dir: "desc",
  });
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const ledgerSentinelRef = useRef<HTMLDivElement>(null);
  const ledgerMobileSentinelRef = useRef<HTMLDivElement>(null);
  const [historyVisible, setHistoryVisible] = useState(60);
  const [historySearch, setHistorySearch] = useState("");
  const historyScrollRef = useRef<HTMLDivElement>(null);
  const historySentinelRef = useRef<HTMLDivElement>(null);
  const historyMobileSentinelRef = useRef<HTMLDivElement>(null);

  const ledgerMonths = useMemo(() => {
    const set = new Set<string>();
    for (const e of ledgerEntries) {
      const m = (e.flowDate ?? "").slice(0, 7);
      if (m) set.add(m);
    }
    return Array.from(set).sort().reverse();
  }, [ledgerEntries]);

  const displayLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    let list = ledgerEntries;
    if (ledgerMonth) list = list.filter((e) => (e.flowDate ?? "").slice(0, 7) === ledgerMonth);
    if (q) list = list.filter((e) => entryMatchesQuery(e, q));
    const { key, dir } = ledgerSort;
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      if (key === "amount") cmp = a.amount - b.amount;
      else if (key === "domain") cmp = (a.domainName ?? "").localeCompare(b.domainName ?? "", "he");
      else cmp = (a.flowDate ?? "").localeCompare(b.flowDate ?? "");
      if (cmp === 0) cmp = a.id.localeCompare(b.id);
      return dir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [ledgerEntries, ledgerSearch, ledgerMonth, ledgerSort]);

  const filteredEntries = { length: displayLedger.length };

  const displayHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    let list = ledgerEntries.filter((e) => (e.flowDate ?? "") <= data.todayIso);
    if (q) list = list.filter((e) => entryMatchesQuery(e, q));
    return [...list].sort((a, b) => {
      const cmp = (b.flowDate ?? "").localeCompare(a.flowDate ?? "");
      return cmp !== 0 ? cmp : b.id.localeCompare(a.id);
    });
  }, [ledgerEntries, historySearch, data.todayIso]);

  const pagedHistoryEntries = displayHistory.slice(0, historyVisible);
  const historyHasMore = pagedHistoryEntries.length < displayHistory.length;
  const pagedLedgerEntries = displayLedger.slice(0, ledgerVisible);
  const ledgerHasMore = pagedLedgerEntries.length < displayLedger.length;

  const toggleLedgerSort = (key: "date" | "amount" | "domain") => {
    setLedgerVisible(60);
    setLedgerSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "domain" ? "asc" : "desc" }
    );
  };
  // The active sort column shows its direction with the palette arrow, never a
  // ▲/▼ text glyph.
  const sortArrow = (key: "date" | "amount" | "domain") =>
    ledgerSort.key !== key ? null : ledgerSort.dir === "asc" ? (
      <ArrowUpIcon className="ms-1 h-3 w-3" />
    ) : (
      <ArrowDownIcon className="ms-1 h-3 w-3" />
    );

  function exportLedgerCsv() {
    const csvCell = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["תאריך תזרים", "סוג", "סטטוס", "תחום", "מקור", "פירוט", "סכום"];
    const lines = displayLedger.map((e) => [
      e.flowDate ?? "",
      typeLabel(e.type),
      stageLabel(e.stage),
      e.domainName ?? "",
      e.sourceLabel ?? "",
      e.description ?? "",
      `${e.type === "inflow" ? "" : "-"}${e.amount}`,
    ]);
    const csv = [headers, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cashflow-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Infinite scroll: reveal more of the (filtered) ledger as the user scrolls.
  // Uses a scroll event rather than IntersectionObserver so it works correctly
  // even when the container starts hidden (inactive Radix tab → display:none).
  useEffect(() => {
    if (ledgerVisible >= displayLedger.length) return;
    const loadMore = () => setLedgerVisible((v) => Math.min(v + 60, displayLedger.length));
    const cleanups: (() => void)[] = [];

    const container = ledgerScrollRef.current;
    if (container) {
      const onScroll = () => {
        if (container.clientHeight === 0) return;
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 400) loadMore();
      };
      container.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      cleanups.push(() => container.removeEventListener("scroll", onScroll));
    }

    const mobileSentinel = ledgerMobileSentinelRef.current;
    if (mobileSentinel) {
      const io = new IntersectionObserver(
        (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
        { rootMargin: "400px" }
      );
      io.observe(mobileSentinel);
      cleanups.push(() => io.disconnect());
    }

    return () => cleanups.forEach((fn) => fn());
    // flowTab is a dep so the listener re-attaches (and auto-fills) when this tab
    // becomes visible — its container has zero height while the tab is hidden.
  }, [ledgerVisible, displayLedger, flowTab]);

  useEffect(() => {
    if (historyVisible >= displayHistory.length) return;
    const loadMore = () => setHistoryVisible((v) => Math.min(v + 60, displayHistory.length));
    const cleanups: (() => void)[] = [];

    const container = historyScrollRef.current;
    if (container) {
      const onScroll = () => {
        if (container.clientHeight === 0) return;
        if (container.scrollHeight - container.scrollTop - container.clientHeight < 400) loadMore();
      };
      container.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      cleanups.push(() => container.removeEventListener("scroll", onScroll));
    }

    const mobileSentinel = historyMobileSentinelRef.current;
    if (mobileSentinel) {
      const io = new IntersectionObserver(
        (entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
        { rootMargin: "400px" }
      );
      io.observe(mobileSentinel);
      cleanups.push(() => io.disconnect());
    }

    return () => cleanups.forEach((fn) => fn());
    // flowTab is a dep so the listener re-attaches (and auto-fills) when this tab
    // becomes visible — its container has zero height while the tab is hidden.
  }, [historyVisible, displayHistory, flowTab]);

  const replaceSearch = (
    mutate: (params: URLSearchParams) => void,
    options?: { pending?: boolean }
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const nextQueryString = params.toString();
    const nextHref = nextQueryString ? `${pathname}?${nextQueryString}` : pathname;

    if (options?.pending) {
      startFilterTransition(() => {
        router.replace(nextHref);
      });
      return;
    }

    router.replace(nextHref);
  };

  const replaceFilters = (
    nextValues: Partial<
      Pick<
        InitialFilters,
        "q" | "from" | "to" | "domain" | "sourceId" | "type" | "stage" | "ledgerPage" | "upcomingPage"
      >
    >
  ) => {
    replaceSearch((params) => {
      const nextQuery = nextValues.q ?? query;
      const nextFrom = nextValues.from ?? from;
      const nextTo = nextValues.to ?? to;
      const nextDomain = nextValues.domain ?? domain;
      const nextSourceId = nextValues.sourceId ?? sourceId;
      const nextType = nextValues.type ?? type;
      const nextStage = nextValues.stage ?? stage;
      const nextLedgerPage = nextValues.ledgerPage ?? initialFilters.ledgerPage;
      const nextUpcomingPage = nextValues.upcomingPage ?? initialFilters.upcomingPage;

      setOrDelete(params, "q", nextQuery);
      setOrDelete(params, "from", nextFrom);
      setOrDelete(params, "to", nextTo);
      setOrDelete(params, "domain", nextDomain);
      setOrDelete(params, "sourceId", nextSourceId);
      setOrDelete(params, "type", nextType === "all" ? null : nextType);
      setOrDelete(params, "stage", nextStage === "all" ? null : nextStage);
      setOrDelete(params, "ledgerPage", nextLedgerPage > 1 ? nextLedgerPage : null);
      setOrDelete(params, "upcomingPage", nextUpcomingPage > 1 ? nextUpcomingPage : null);
    }, { pending: true });
  };

  // Set both ends of the date range in one route update (used by the period chips
  // and the month picker). Empty strings clear the range.
  const applyRange = (nextFrom: string, nextTo: string) => {
    setFrom(nextFrom);
    setTo(nextTo);
    replaceFilters({ from: nextFrom, to: nextTo, ledgerPage: 1, upcomingPage: 1 });
  };

  const resetFilters = () => {
    setQuery("");
    setFrom("");
    setTo("");
    setDomain("");
    setSourceId("");
    setType("all");
    setStage("all");
    replaceFilters({
      q: "",
      from: "",
      to: "",
      domain: "",
      sourceId: "",
      type: "all",
      stage: "all",
      ledgerPage: 1,
      upcomingPage: 1,
    });
  };

  const upcomingCount = data.upcomingTotalCount;
  const sourceCount = data.sourceCount;
  const [editingExpense, setEditingExpense] = useState<EditableExpenseEntry | null>(null);
  // What the edit dialog shows: an expense clicked here, or the one a ?focus=
  // deep link asked us to open.
  const activeEditingExpense = editingExpense ?? focusExpense;
  const [deletingExpense, setDeletingExpense] = useState<EditableExpenseEntry | null>(null);
  const [isDeletingExpense, setIsDeletingExpense] = useState(false);
  const [markPaidExpense, setMarkPaidExpense] = useState<EditableExpenseEntry | null>(null);
  const [markPaidMethod, setMarkPaidMethod] = useState<string>("");
  const [markPaidAccountId, setMarkPaidAccountId] = useState<string>("");
  const [markPaidAccountsList, setMarkPaidAccountsList] = useState<Account[]>([]);
  const [markPaidDate, setMarkPaidDate] = useState<string>(todayIsoDate());
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [expenseCreateOpen, setExpenseCreateOpen] = useState(false);
  const [incomeCreateOpen, setIncomeCreateOpen] = useState(false);
  const [incomeAccountsList, setIncomeAccountsList] = useState<Account[]>([]);
  const [incomeCreateForm, setIncomeCreateForm] = useState<IncomeCreateFormState>(
    () => loadDraft<IncomeCreateFormState>("income-create") ?? createIncomeFormState()
  );
  const [incomeCheckPhotoFiles, setIncomeCheckPhotoFiles] = useState<File[]>([]);
  const [isCreatingIncome, setIsCreatingIncome] = useState(false);


  useEffect(() => {
    if (!isRefreshPending && refreshResolveRef.current) {
      const resolve = refreshResolveRef.current;
      refreshResolveRef.current = null;
      resolve();
    }
  }, [isRefreshPending]);

  // Trigger a background refresh of server data WITHOUT blocking the caller.
  // Dialogs that call this on save close instantly; the page reconciles a moment
  // later. (Previously this awaited the full refetch, which made saves feel slow.)
  function refreshAndWait() {
    startRefreshTransition(() => {
      router.refresh();
    });
    return Promise.resolve();
  }

  useEffect(() => {
    if (!incomeCreateOpen) return;
    saveDraft("income-create", incomeCreateForm);
  }, [incomeCreateForm, incomeCreateOpen]);

  const navigateToEntry = (entry: FinancialEntry) => {
    if (!entry.sourceHref) return;
    emitNavigationStart();
    router.push(entry.sourceHref);
  };

  const openExpenseEditor = (entry: FinancialEntry) => {
    if (!isEditableExpenseEntry(entry)) return;
    setEditingExpense(entry);
  };

  const openMarkPaid = (entry: FinancialEntry) => {
    if (!isEditableExpenseEntry(entry)) return;
    setMarkPaidMethod(entry.expensePaymentMethod ?? "");
    setMarkPaidAccountId(entry.expenseAccountId ?? "");
    // Default the pay date to the scheduled date if it's already due, else today.
    const scheduled = entry.recordedDate;
    setMarkPaidDate(scheduled && scheduled <= data.todayIso ? scheduled : todayIsoDate());
    setMarkPaidExpense(entry);
  };

  const confirmMarkPaid = async () => {
    if (!markPaidExpense) return;
    if (markPaidAccountsList.length > 0 && !markPaidAccountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    setIsMarkingPaid(true);
    try {
      const res = await fetch("/api/expenses/mark-paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: markPaidExpense.expenseId,
          payment_method: markPaidMethod || null,
          account_id: markPaidAccountId || null,
          paid_date: markPaidDate || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error("שגיאה בסימון ההוצאה כשולמה", {
          description: typeof json?.error === "string" ? json.error : "",
        });
        return;
      }
      setMarkPaidExpense(null);
      toast.success("ההוצאה סומנה כשולמה");
      router.refresh();
    } catch (error) {
      toast.error("שגיאה בסימון ההוצאה כשולמה", {
        description: toHebrewError(error, ""),
      });
    } finally {
      setIsMarkingPaid(false);
    }
  };

  const confirmExpenseDelete = async () => {
    if (!deletingExpense) return;

    setIsDeletingExpense(true);
    try {
      const result = await offlineFetch(
        "/api/expenses/delete",
        {
          id: deletingExpense.expenseId,
          project_id: deletingExpense.expenseProjectId,
          order_id: deletingExpense.expenseOrderId,
          property_id: deletingExpense.expensePropertyId,
        },
        "מחיקת חיוב"
      );
      if (!result.queued && !result.ok) {
        toast.error("שגיאה במחיקת החיוב", { description: toHebrewError(result.error, "") });
        return;
      }

      if (!result.queued) toast.success("החיוב נמחק");
      setDeletingExpense(null);
      router.refresh();
    } catch (error) {
      toast.error("שגיאה במחיקת החיוב", {
        description: toHebrewError(error, ""),
      });
    } finally {
      setIsDeletingExpense(false);
    }
  };

  const createIncome = async () => {
    if (!incomeCreateForm.businessDomain) {
      toast.error("יש לבחור תחום");
      return;
    }
    const amountNumber = Number(incomeCreateForm.amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!incomeCreateForm.paymentDate.trim()) {
      toast.error("יש לבחור תאריך");
      return;
    }
    if (incomeCreateForm.paymentMethod === "check" && !incomeCreateForm.dueDate.trim()) {
      toast.error("יש להזין תאריך פירעון לצ'ק");
      return;
    }
    if (incomeAccountsList.length > 0 && !incomeCreateForm.accountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    // due_date is optional for non-check methods (e.g., שוטף+30 bank transfer).

    setIsCreatingIncome(true);
    try {
      const result = await offlineFetch("/api/payments/create", {
        business_domain: incomeCreateForm.businessDomain,
        project_id: incomeCreateForm.businessDomain === "logistics_projects" ? incomeCreateForm.projectId : null,
        order_id: incomeCreateForm.businessDomain === "sales" ? incomeCreateForm.orderId : null,
        property_id:
          incomeCreateForm.businessDomain === "property_management" ? incomeCreateForm.propertyId : null,
        amount_total: amountNumber,
        payment_date: incomeCreateForm.paymentDate,
        due_date: incomeCreateForm.dueDate.trim() || null,
        requires_split: incomeCreateForm.requiresSplit,
        payment_method: incomeCreateForm.paymentMethod,
        account_id: incomeCreateForm.accountId || null,
        reference_number: incomeCreateForm.referenceNumber.trim() || null,
        check_number:
          incomeCreateForm.paymentMethod === "check" && incomeCreateForm.checkNumber.trim()
            ? incomeCreateForm.checkNumber.trim()
            : null,
        notes: incomeCreateForm.notes.trim() || null,
        tag_ids: incomeCreateForm.tagIds,
      }, "הכנסה חדשה", { idempotent: true });

      if (result.queued) {
        setIncomeCreateOpen(false);
        clearDraft("income-create");
        setIncomeCreateForm(createIncomeFormState());
        setIncomeCheckPhotoFiles([]);
        return;
      }
      if (!result.ok) {
        toast.error("שגיאה ביצירת ההכנסה", { description: result.error });
        return;
      }

      const createdPaymentId =
        (result.data as { payment?: { id?: string } } | null)?.payment?.id ?? "";
      if (
        incomeCreateForm.paymentMethod === "check" &&
        createdPaymentId &&
        incomeCheckPhotoFiles.length > 0
      ) {
        await uploadCheckPhotos(createdPaymentId, incomeCheckPhotoFiles);
      }

      toast.success("ההכנסה נוספה");
      setIncomeCreateOpen(false);
      clearDraft("income-create");
      setIncomeCreateForm(createIncomeFormState());
      setIncomeCheckPhotoFiles([]);
      router.refresh();
    } catch (error) {
      toast.error("שגיאה ביצירת ההכנסה", {
        description: toHebrewError(error, ""),
      });
    } finally {
      setIsCreatingIncome(false);
    }
  };

  // Month picker — always visible in the filter-button row (outside the
  // collapsible filters panel) so switching month is one tap.
  const periodControls = (
    <NativeSelect dense
      aria-label="בחר חודש"
      value={from && to && monthRange(from.slice(0, 7))?.from === from && monthRange(from.slice(0, 7))?.to === to ? from.slice(0, 7) : ""}
      onChange={(event) => {
        const range = event.target.value ? monthRange(event.target.value) : null;
        applyRange(range?.from ?? "", range?.to ?? "");
      }} className="w-36"
    >
      <option value="">כל התקופה</option>
      {recentMonthKeys(data.todayIso).map((key) => (
        <option key={key} value={key}>
          {key.slice(5)}/{key.slice(2, 4)}
        </option>
      ))}
    </NativeSelect>
  );

  const advancedFilterButton = (
    <>
      <Button type="button" variant="outline" onClick={() => setFiltersOpen((value) => !value)}>
        <FilterIcon className="h-4 w-4" />
        סינון מתקדם
        {activeFilterCount > 0 ? (
          <Badge variant="secondary" className="ms-2">{activeFilterCount}</Badge>
        ) : null}
      </Button>
      {activeFilterCount > 0 ? (
        <Button type="button" variant="ghost" onClick={resetFilters}>
          <RefreshIcon className="h-4 w-4" />
          איפוס סינון
        </Button>
      ) : null}
    </>
  );

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      {periodControls}
      {advancedFilterButton}
    </div>
  );

  // The shared report control row: month + the 3 global toggles + advanced filters.
  // These drive every report tab (סקירה / לפי תחום / חודשי / מאזן).
  // Domain chips for the report row (empty = all). Business domains present in the
  // data, plus בית/צדקה and/or ניהול נכסים only when their own toggle is on.
  const reportDomainOptions = data.domainOptions
    .filter((key) => includePersonalRow(key, { includeHomeCharity, includeProperties }))
    .map((key) => ({ key, label: getBusinessDomainLabel(key) }));

  const reportControls = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 print:hidden">
      {periodControls}
      <div className="flex h-9 overflow-hidden rounded-lg border text-sm">
        <button
          type="button"
          onClick={() => setReportBasis("cash")}
          className={cn("flex items-center px-3 transition-colors", reportBasis === "cash" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
          title="כמה כסף באמת נכנס לחשבונות בתקופה — לפי תאריך הקבלה"
        >
          נכנס בפועל
        </button>
        <button
          type="button"
          onClick={() => setReportBasis("earned")}
          className={cn("flex items-center px-3 transition-colors", reportBasis === "earned" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted")}
          title="מה שהרווחתי בתקופה — לפי החודש שבו נוצר, גם אם עדיין לא נגבה"
        >
          הרווחתי
        </button>
      </div>
      {/* Open debts only apply on the cash basis — hide it entirely in earned mode
          rather than showing a greyed-out control. */}
      {reportBasis !== "earned" ? (
        <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={includeOpen}
            onChange={(e) => setIncludeOpen(e.target.checked)}
          />
          <span>כולל פתוחים</span>
        </label>
      ) : null}
      <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={includeHomeCharity}
          onChange={(e) => setIncludeHomeCharity(e.target.checked)}
        />
        <span>כולל בית וצדקה</span>
      </label>
      <label className="flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={includeProperties}
          onChange={(e) => setIncludeProperties(e.target.checked)}
        />
        <span>כולל ניהול נכסים</span>
      </label>
      {activeFilterCount > 0 ? (
        <Button type="button" variant="ghost" size="sm" onClick={resetFilters} className="ms-auto h-9">
          <RefreshIcon className="h-4 w-4" />
          איפוס
        </Button>
      ) : null}
    </div>
  );

  // "מציג:" summary — the active period + basis, shown as chips under the control
  // row so the current view is unmistakable no matter which tab is open.
  const reportPeriodMonthKey =
    from && to && monthRange(from.slice(0, 7))?.from === from && monthRange(from.slice(0, 7))?.to === to
      ? from.slice(0, 7)
      : null;
  const reportPeriodLabel = reportPeriodMonthKey
    ? `${HE_MONTHS[Number(reportPeriodMonthKey.slice(5, 7)) - 1]} ${reportPeriodMonthKey.slice(0, 4)}`
    : from || to
    ? `${from || "…"} – ${to || "…"}`
    : "כל התקופה";
  const reportBasisLabel = reportBasis === "earned" ? "הרווחתי" : "נכנס בפועל";

  // The advanced-filter FIELDS (search / date range / domain / source / type /
  // stage). Rendered as the lower part of the SAME filter box as the control row,
  // so the two read as one connected area (not two floating cards).
  const advancedFilterFields = (
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* Free-text search filters the ledger — not the reports — so flow only. */}
          {view === "flow" ? (
          <label className="space-y-1 text-sm text-right sm:col-span-2">
            <span className="font-medium">חיפוש</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQuery(nextValue);
                  if (queryDebounceRef.current) clearTimeout(queryDebounceRef.current);
                  queryDebounceRef.current = setTimeout(() => {
                    replaceFilters({ q: nextValue, ledgerPage: 1, upcomingPage: 1 });
                  }, 300);
                }}
                placeholder="חפש לפי תיאור, מקור, תחום או אסמכתא..."
                className="pr-9"
              />
            </div>
          </label>
          ) : null}

          <label className="space-y-1 text-sm text-right">
            <span className="font-medium">מתאריך</span>
            <DateInput
              value={from}
              onChange={(event) => {
                const nextValue = event.target.value;
                setFrom(nextValue);
                if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
                dateDebounceRef.current = setTimeout(() => {
                  replaceFilters({ from: nextValue, ledgerPage: 1, upcomingPage: 1 });
                }, 400);
              }}
            />
          </label>

          <label className="space-y-1 text-sm text-right">
            <span className="font-medium">עד תאריך</span>
            <DateInput
              value={to}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTo(nextValue);
                if (dateDebounceRef.current) clearTimeout(dateDebounceRef.current);
                dateDebounceRef.current = setTimeout(() => {
                  replaceFilters({ to: nextValue, ledgerPage: 1, upcomingPage: 1 });
                }, 400);
              }}
            />
          </label>

          <SelectField value={domain} onChange={(value) => {
            setDomain(value);
            setSourceId("");
            replaceFilters({ domain: value, sourceId: "", ledgerPage: 1, upcomingPage: 1 });
          }} label="תחום עסקי">
            <option value="">כל התחומים</option>
            {domainOptions.map((option) => (
              <option key={option} value={option}>
                {getBusinessDomainLabel(option)}
              </option>
            ))}
          </SelectField>

          {/* Source / type / stage only affect the ledger — flow only. */}
          {view === "flow" ? (
          <>
          <SelectField value={sourceId} onChange={(value) => {
            setSourceId(value);
            replaceFilters({ sourceId: value, ledgerPage: 1, upcomingPage: 1 });
          }} label={sourceKindLabel(sourceKind)}>
            <option value="">{sourceKind ? `כל ה${sourceKindLabel(sourceKind)}` : "בחר תחום קודם"}</option>
            {sourceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectField>

          <SelectField value={type} onChange={(value) => {
            setType(value);
            replaceFilters({ type: value, ledgerPage: 1, upcomingPage: 1 });
          }} label="סוג תנועה">
            <option value="all">הכול</option>
            <option value="inflow">כניסות בלבד</option>
            <option value="outflow">יציאות בלבד</option>
          </SelectField>

          <SelectField value={stage} onChange={(value) => {
            setStage(value);
            replaceFilters({ stage: value, ledgerPage: 1, upcomingPage: 1 });
          }} label="סטטוס תזרים">
            <option value="all">הכול</option>
            <option value="actual">בפועל</option>
            <option value="future">צפוי / ממתין</option>
            <option value="pending">ממתין בלבד</option>
          </SelectField>
          </>
          ) : null}
        </div>

        {view === "flow" ? (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
            <Badge variant="outline">{filteredEntries.length} תנועות</Badge>
            <Badge variant="outline">{sourceCount} מקורות</Badge>
            <Badge variant="outline">{upcomingCount} צפויות / ממתינות</Badge>
          </div>
        ) : null}
      </div>
  );

  const flowActions =
    canManageExpenses && view === "flow" ? (
      <>
        <Button type="button" variant="secondary" onClick={() => setIncomeCreateOpen(true)}>
          הוספת הכנסה
        </Button>
        <Button type="button" variant="secondary" onClick={() => setExpenseCreateOpen(true)}>
          הוספת הוצאה
        </Button>
      </>
    ) : null;

  return (
    <div className="space-y-4" dir="rtl">
      {resolvedCanView ? (
        <>
      <div dir="rtl" className="space-y-4 text-right">
      <div ref={contentAreaRef} className="relative space-y-4">
        {/* Slim, non-blocking loading bar — clearly visible, no scroll lock, no blur. */}
        {isFilterPending ? (
          <div className="pointer-events-none absolute inset-x-0 -top-1 z-20 h-1 overflow-hidden rounded-full bg-primary/15 print:hidden">
            <div className="h-full w-full rounded-full bg-primary animate-progress-indeterminate" />
          </div>
        ) : null}

      {view === "reports" ? (
      <Tabs value={reportTab} onValueChange={setReportTab} dir="rtl" className="space-y-4">
        {/* Global filters — a flat full-width band (no rounding / side borders),
            its two sections color-coded: the CONTROLS row and the "מציג:" summary
            of what's currently shown. Separated from the tabs by clear space. */}
        <div className="border-y border-border/60">
          {/* Section 1 — controls (drive every tab). Reset pinned to the far end. */}
          <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2.5">
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
              <FilterIcon className="h-4 w-4 text-muted-foreground" />
              מסננים גלובליים
            </span>
            <span className="mx-1 hidden h-5 w-px self-center bg-border sm:block" />
            {reportControls}
          </div>
          {/* Section 2 — "מציג:" what you're looking at now (different color). */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-primary/[0.06] px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">מציג:</span>
            <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {reportPeriodLabel}
            </span>
            <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">
              שיטה: {reportBasisLabel}
            </span>
            {includeOpen && reportBasis !== "earned" ? (
              <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">כולל פתוחים</span>
            ) : null}
            {includeHomeCharity ? (
              <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">כולל בית וצדקה</span>
            ) : null}
            {includeProperties ? (
              <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">כולל ניהול נכסים</span>
            ) : null}
          </div>
        </div>
        {/* Tabs — separated from the filter band with clear breathing room. */}
        <div className="min-w-0 pt-2">
          <TabsList variant="underline">
            <TabsTrigger value="overview"><CalculatorIcon className="h-4 w-4 shrink-0" />סקירה</TabsTrigger>
            <TabsTrigger value="pl"><ChartIcon className="h-4 w-4 shrink-0" />לפי תחום</TabsTrigger>
            <TabsTrigger value="monthly"><TrendChartIcon className="h-4 w-4 shrink-0" />חודשי</TabsTrigger>
            <TabsTrigger value="margin"><CoinsIcon className="h-4 w-4 shrink-0" />מכירות</TabsTrigger>
            <TabsTrigger value="balance"><BalanceIcon className="h-4 w-4 shrink-0" />מאזן</TabsTrigger>
            <TabsTrigger value="forecast"><ScheduleIcon className="h-4 w-4 shrink-0" />תחזית</TabsTrigger>
            <TabsTrigger value="customers"><UsersIcon className="h-4 w-4 shrink-0" />לקוחות</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="balance" className="space-y-6">
      {/* ── עכשיו: כסף שכבר זז בפועל ── */}
      <section dir="rtl" className="space-y-2">
        <div>
          <h3 className="text-base font-semibold">עכשיו — מה כבר קרה בפועל</h3>
          <p className="text-xs text-muted-foreground">כסף שכבר נכנס או יצא בפועל.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryCard
            title="כניסות בפועל"
            value={formatCurrency(summaries.actual.inflow)}
            description={`${summaries.actual.count} תנועות שכבר נכנסו לתזרים`}
            accent="success"
          />
          <SummaryCard
            title="יציאות בפועל"
            value={formatCurrency(summaries.actual.outflow)}
            description="הוצאות שכבר ירדו בפועל"
            accent="destructive"
          />
          <SummaryCard
            title="יתרה בפועל"
            value={formatCurrency(summaries.actual.net)}
            description="מאזן מזומנים שכבר נרשם בפועל"
            accent={summaries.actual.net >= 0 ? "success" : "destructive"}
          />
        </div>
      </section>

      {/* ── צפוי: כסף שעדיין לא זז ── */}
      <section dir="rtl" className="space-y-2">
        <div>
          <h3 className="text-base font-semibold">צפוי — מה צפוי קדימה</h3>
          <p className="text-xs text-muted-foreground">כסף שעדיין לא זז — צפוי להיכנס או לצאת בהמשך.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <SummaryCard
            title="הכנסות מתוכננות"
            value={formatCurrency(data.plannedReceivablesSummary.inflow)}
            description={`${data.plannedReceivablesSummary.count} תקבולים צפויים מצ'קים, פרויקטים והזמנות שעדיין בתהליך`}
            accent="success"
          />
          <SummaryCard
            title="תשלומים מתוזמנים"
            value={formatCurrency(data.scheduledLiabilitiesSummary.outflow)}
            description={`${data.scheduledLiabilitiesSummary.count} תשלומים עתידיים שעדיין לא הגיע מועד התזרים שלהם`}
            accent="destructive"
          />
          <SummaryCard
            title={initialFilters.to ? "תחזית עד תאריך" : "תחזית ל-30 יום"}
            value={formatCurrency(data.forecastSummary.net)}
            description={`כולל בפועל וצפי עד ${formatShortDate(data.forecastEndIso)}`}
            accent={data.forecastSummary.net >= 0 ? "success" : "destructive"}
          />
        </div>
      </section>

      {/* ── מאזן: רכוש מול חוב ── */}
      <section dir="rtl" className="space-y-2">
        <div>
          <h3 className="text-base font-semibold">מאזן — רכוש מול חוב</h3>
          <p className="text-xs text-muted-foreground">
            מה שיש מול מה שחייבים. פירוט מלא בלשונית ״מאזן״.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            title="חובות לקוחות פתוחים"
            value={formatCurrency(data.openReceivablesSummary.inflow)}
            description={`${data.openReceivablesSummary.count} יתרות מפרויקטים/הזמנות שהושלמו ועדיין לא שולמו`}
            accent="success"
          />
          <SummaryCard
            title="התחייבויות פתוחות"
            value={formatCurrency(data.openLiabilitiesSummary.outflow)}
            description={`${data.openLiabilitiesSummary.count} חובות שכבר נוצרו ועדיין לא שולמו`}
            accent="destructive"
          />
          {hasLoans ? (
            <SummaryCard
              title="הלוואות (נטו)"
              value={formatCurrency(data.loansSummary.netPosition)}
              description="הלוואות שנתתי פחות הלוואות שלקחתי"
              accent={data.loansSummary.netPosition >= 0 ? "success" : "destructive"}
            />
          ) : null}
          <SummaryCard
            title="שווי נוכחי"
            value={formatCurrency(currentWorthNow)}
            description="יתרה בפועל + חובות לקוחות + הלוואות שנתתי − התחייבויות − הלוואות שלקחתי"
            accent={currentWorthNow >= 0 ? "success" : "destructive"}
          />
        </div>
      </section>
      <PositionPanel data={data} />
        </TabsContent>
        <TabsContent value="overview" className="space-y-4">
          <BottomLinePanel
            rows={data.profitLoss}
            earned={earnedRevenue}
            basis={plBasis}
            includeHomeCharity={includeHomeCharity}
            includeProperties={includeProperties}
            domainProof={domainProof}
            projectBreakdown={projectBreakdown}
            profitLossProof={data.profitLossProof}
          />
        </TabsContent>
        <TabsContent value="pl" className="space-y-4">
          {/* Domain filter belongs to this tab (it only affects the by-domain view). */}
          {reportDomainOptions.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">סינון תחומים:</span>
              <DomainMultiSelect domains={reportDomainOptions} selected={selectedReportDomains} onChange={setSelectedReportDomains} />
            </div>
          ) : null}
          <ProfitLossPanel
            rows={data.profitLoss}
            earned={earnedRevenue}
            projectBreakdown={projectBreakdown}
            domainProof={domainProof}
            expenseCategories={data.profitLossExpenseCategories}
            previousRows={data.profitLossPrevious}
            previousPeriod={data.profitLossPreviousPeriod}
            from={initialFilters.from || null}
            to={initialFilters.to || null}
            basis={plBasis}
            includeHomeCharity={includeHomeCharity}
            includeProperties={includeProperties}
            selectedDomains={selectedReportDomains}
          />
        </TabsContent>
        <TabsContent value="monthly" className="space-y-4">
          {reportBasis === "earned" ? (
            earnedRevenue ? (
              <EarnedRevenuePanel report={earnedRevenue} selectedDomains={selectedReportDomains} />
            ) : (
              <EmptyState>
                אין נתוני הכנסה להצגה.
              </EmptyState>
            )
          ) : (
            <MonthlyTrendPanel points={data.monthlyTrend} />
          )}
        </TabsContent>
        <TabsContent value="margin" className="space-y-4">
          {productMargin ? (
            <ProductMarginPanel report={productMargin} />
          ) : (
            <EmptyState>
              אין נתוני מכירות להצגה.
            </EmptyState>
          )}
        </TabsContent>
        <TabsContent value="forecast" className="space-y-4">
          <ForecastPanel changes={data.forecastMonthly} openingBalance={data.actualSummary.net} />
        </TabsContent>
        <TabsContent value="customers" className="space-y-4">
          {customerRanking ? (
            <CustomerRankingPanel report={customerRanking} />
          ) : (
            <EmptyState>
              אין נתוני לקוחות להצגה.
            </EmptyState>
          )}
        </TabsContent>
      </Tabs>
      ) : (
      <Tabs
        value={flowTab}
        onValueChange={(value) => setFlowTab(value as "ledger" | "upcoming" | "history")}
        dir="rtl"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="min-w-0 flex-1">
            <TabsList variant="underline">
              <TabsTrigger value="history"><HistoryIcon className="h-4 w-4 shrink-0" />היסטוריה</TabsTrigger>
              <TabsTrigger value="ledger"><LedgerIcon className="h-4 w-4 shrink-0" />יומן מלא</TabsTrigger>
              <TabsTrigger value="upcoming">
                <ClockIcon className="h-4 w-4 shrink-0" />
                תזרים עתידי
                {upcomingCount > 0 ? (
                  <span className="ms-2 inline-flex items-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-semibold leading-5">
                    {upcomingCount}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {flowActions}
            {filterControls}
          </div>
        </div>
        {/* Advanced filters open inline under the flow controls, same box style. */}
        {filtersOpen ? (
          <div className="rounded-xl border bg-muted/20 p-3 print:hidden">{advancedFilterFields}</div>
        ) : null}
        <TabsContent value="history" forceMount className="data-[state=inactive]:hidden">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-right">היסטוריית תזרים</CardTitle>
          <CardDescription className="text-right">
            כל התנועות מהיום ואחורה — מה שכבר קרה ומה שממתין עד היום.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={historySearch}
                onChange={(e) => {
                  setHistoryVisible(60);
                  setHistorySearch(e.target.value);
                }}
                placeholder="חיפוש (פירוט, מקור, תחום)"
                className="h-9 pr-9"
              />
            </div>
            {historySearch ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHistoryVisible(60);
                  setHistorySearch("");
                }}
              >
                ניקוי
              </Button>
            ) : null}
          </div>
          {displayHistory.length === 0 ? (
            <EmptyState>
              לא נמצאו תנועות עבר בהתאם לסינון.
            </EmptyState>
          ) : (
            <>
              <div dir="rtl" className="grid gap-3 md:hidden">
                {pagedHistoryEntries.map((entry) => {
                  const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                  const isToday = entry.flowDate === data.todayIso;
                  return (
                  <article
                    key={entry.id}
                    data-focus-id={entry.id}
                    className={cn(
                      "rounded-2xl border p-4 text-right",
                      isToday ? "border-primary/30 bg-primary/5" : "",
                      entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                    )}
                    onClick={() => navigateToEntry(entry)}
                  >
                    <div className="flex items-start justify-between gap-3 sm:flex-row-reverse">
                      <div className="space-y-1">
                        <div dir="ltr" className="text-sm font-medium tabular-nums">{formatShortDate(entry.flowDate)}</div>
                        {isToday ? (
                          <div className="text-xs font-semibold text-primary">היום</div>
                        ) : (
                          <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate, "-", data.todayIso)}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="font-medium">{entry.description}</div>
                      <div className="text-muted-foreground">{entry.domainName}</div>
                      <div className="text-muted-foreground">
                        {entry.sourceHref ? (
                          <Link href={entry.sourceHref} className="transition-colors hover:text-foreground" onClick={(event) => { event.stopPropagation(); emitNavigationStart(); }}>
                            <span dir="auto">{entry.sourceLabel}</span>
                          </Link>
                        ) : (
                          <span dir="auto">{entry.sourceLabel}</span>
                        )}
                      </div>
                      <div dir="ltr" className={cn("font-semibold tabular-nums", typeAmountClass(entry.type))}>
                        {entry.type === "inflow" ? "+" : "-"}
                        {formatCurrency(entry.amount)}
                      </div>
                      {canManageExpenses && editableExpense ? (
                        <div className="flex justify-end gap-2 pt-1">
                          <EditButton onClick={(event) => { event.stopPropagation(); openExpenseEditor(editableExpense); }} label="עריכה" />
                          <DeleteButton onClick={(event) => { event.stopPropagation(); setDeletingExpense(editableExpense); }} />
                        </div>
                      ) : null}
                    </div>
                  </article>
                  );
                })}
              </div>
              <div ref={historyScrollRef} className="hidden max-h-[70vh] overflow-auto md:block">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-right text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">תאריך תזרים</th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">סוג</th>
                      <th className="px-3 py-2 font-medium">תחום / מקור</th>
                      <th className="px-3 py-2 font-medium">פירוט</th>
                      <th className="px-3 py-2 font-medium">סכום</th>
                      {canManageExpenses ? <th className="px-3 py-2 font-medium">פעולות</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedHistoryEntries.map((entry) => {
                      const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                      const isToday = entry.flowDate === data.todayIso;
                      return (
                      <tr
                        key={entry.id}
                        data-focus-id={entry.id}
                        className={cn(
                          "border-b last:border-b-0",
                          isToday ? "bg-primary/5" : "",
                          entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                        )}
                        onClick={() => navigateToEntry(entry)}
                      >
                        <td className="px-3 py-2 align-top">
                          <div dir="ltr" className="tabular-nums">{formatShortDate(entry.flowDate)}</div>
                          {isToday ? (
                            <div className="text-xs font-semibold text-primary">היום</div>
                          ) : (
                            <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate, "-", data.todayIso)}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div>{entry.domainName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.sourceHref ? (
                              <Link href={entry.sourceHref} className="transition-colors hover:text-foreground" onClick={(event) => { event.stopPropagation(); emitNavigationStart(); }}>
                                <span dir="auto">{entry.sourceLabel}</span>
                              </Link>
                            ) : (
                              <span dir="auto">{entry.sourceLabel}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div>{entry.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {[
                              entry.paymentMethodLabel,
                              entry.reference,
                              entry.recordedDate && entry.recordedDate !== entry.flowDate
                                ? `נרשם: ${formatShortDate(entry.recordedDate)}`
                                : null,
                              entry.recordedByName ? `הוזן ע"י ${entry.recordedByName}` : null,
                            ].filter(Boolean).join(" • ")}
                          </div>
                        </td>
                        <td dir="ltr" className={cn("px-3 py-2 align-top text-left font-semibold tabular-nums", typeAmountClass(entry.type))}>
                          {entry.type === "inflow" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </td>
                        {canManageExpenses ? (
                          <td className="px-3 py-2 align-top">
                            {editableExpense ? (
                              <div className="flex items-center justify-end gap-1">
                                <EditButton onClick={(event) => { event.stopPropagation(); openExpenseEditor(editableExpense); }} label="עריכה" />
                                <DeleteButton onClick={(event) => { event.stopPropagation(); setDeletingExpense(editableExpense); }} />
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {historyHasMore ? <div ref={historySentinelRef} className="h-1" /> : null}
              </div>
              {historyHasMore ? <div ref={historyMobileSentinelRef} className="h-1 md:hidden" /> : null}
              <div className="pt-3 text-center text-xs text-muted-foreground">
                מציג {pagedHistoryEntries.length} מתוך {displayHistory.length} תנועות
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>
        <TabsContent value="upcoming" forceMount className="data-[state=inactive]:hidden">
      <section dir="rtl" className="grid gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-right">תזרים עתידי קרוב</CardTitle>
            <CardDescription className="text-right">
              כאן רואים מה עוד אמור להיכנס או לצאת, כולל צ&apos;קים עם תאריך פירעון והוצאות עתידיות.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingEntries.length === 0 ? (
              <EmptyState>
                אין כרגע תנועות עתידיות או ממתינות בהתאם לסינון.
              </EmptyState>
            ) : (
              <div ref={upcomingReveal.scrollRef} className="max-h-[70vh] overflow-auto">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-right text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-2 py-2 font-medium">תאריך תזרים</th>
                      <th className="px-2 py-2 font-medium">פירעון</th>
                      <th className="px-2 py-2 font-medium">סוג</th>
                      <th className="px-2 py-2 font-medium">סטטוס</th>
                      <th className="px-2 py-2 font-medium">תחום</th>
                      <th className="px-2 py-2 font-medium">מקור</th>
                      <th className="px-2 py-2 font-medium">פירוט</th>
                      <th className="px-2 py-2 font-medium">סכום</th>
                      {canManageExpenses ? <th className="px-2 py-2 font-medium">פעולות</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedUpcomingEntries.map((entry) => {
                      const showDueDate = Boolean(entry.dueDate && entry.dueDate !== entry.flowDate);
                      const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                      return (
                      <tr
                        key={entry.id}
                        data-focus-id={entry.id}
                        className={cn(
                          "border-b last:border-b-0",
                          entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                        )}
                        onClick={() => navigateToEntry(entry)}
                      >
                        <td className="px-2 py-2 align-top">
                          <div dir="ltr" className="tabular-nums">
                            {formatShortDate(entry.flowDate)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatRelativeDateLabel(entry.flowDate, "-", data.todayIso)}
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          {showDueDate ? (
                            <span dir="ltr" className="tabular-nums text-xs">
                              {formatShortDate(entry.dueDate)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Badge className="px-2 py-0.5 text-[11px]" variant={typeVariant(entry.type)}>
                            {typeLabel(entry.type)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Badge className="px-2 py-0.5 text-[11px]" variant={stageVariant(entry.stage)}>
                            {stageLabel(entry.stage)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 align-top text-xs">{entry.domainName}</td>
                        <td className="px-2 py-2 align-top">
                          <div className="text-xs">
                            {entry.sourceHref ? (
                              <Link
                                href={entry.sourceHref}
                                className="transition-colors hover:text-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  emitNavigationStart();
                                }}
                              >
                                <span dir="auto">{entry.sourceLabel}</span>
                              </Link>
                            ) : (
                              <span dir="auto">{entry.sourceLabel}</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{sourceTypeTitle(entry.sourceKind)}</div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          <div className="text-xs font-medium">{entry.description}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {[
                              entry.paymentMethodLabel,
                              entry.reference,
                              entry.recordedDate && entry.recordedDate !== entry.flowDate
                                ? `נרשם: ${formatShortDate(entry.recordedDate)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </div>
                          {entry.origin === "expense" ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={cn(
                                "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                (entry.paymentStatus ?? "not_paid") === "paid" ? "border-success/40 bg-success/10 text-success" :
                                (entry.paymentStatus ?? "not_paid") === "partial" ? "border-warning/40 bg-warning/15 text-warning-strong" :
                                "border-destructive/40 bg-destructive/10 text-destructive"
                              )}>
                                {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקית" : "לא שולם"}
                              </span>
                              {(() => {
                                const st = entry.paymentStatus ?? "not_paid";
                                if (st !== "paid" && st !== "partial") return null;
                                const methodLabel = entry.expensePaymentMethod === "bank_transfer" ? "העברה בנקאית"
                                  : entry.expensePaymentMethod === "cash" ? "מזומן"
                                  : entry.expensePaymentMethod === "check" ? "צ'ק"
                                  : entry.expensePaymentMethod === "credit_card" ? "כרטיס אשראי"
                                  : entry.expensePaymentMethod === "other" ? "אחר" : null;
                                const parts: string[] = [];
                                if (st === "partial" && entry.expensePaidAmount != null && entry.expensePaidAmount > 0) parts.push(`שולם ${formatCurrency(entry.expensePaidAmount)}`);
                                if (methodLabel) parts.push(methodLabel);
                                if (!parts.length) return null;
                                return <span className="text-[10px] text-muted-foreground">{parts.join(" • ")}</span>;
                              })()}
                            </div>
                          ) : null}
                        </td>
                        <td
                          dir="ltr"
                          className={cn("px-2 py-2 align-top text-left font-semibold tabular-nums", typeAmountClass(entry.type))}
                        >
                          {entry.type === "inflow" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </td>
                        {canManageExpenses ? (
                          <td className="px-2 py-2 align-top">
                            {editableExpense ? (
                              <div className="flex items-center justify-end gap-1">
                                {(editableExpense.paymentStatus ?? "not_paid") !== "paid" ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-success hover:text-success"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openMarkPaid(editableExpense);
                                    }}
                                  >
                                    <SuccessIcon className="h-4 w-4" />
                                    <span className="sr-only">סמן כשולם</span>
                                  </Button>
                                ) : null}
                                <EditButton onClick={(event) => {
                                    event.stopPropagation();
                                    openExpenseEditor(editableExpense);
                                  }} label="עריכה" />
                                <DeleteButton
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingExpense(editableExpense);
                                  }}
                                />
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {upcomingReveal.hasMore ? <div ref={upcomingReveal.sentinelRef} className="h-1" /> : null}
              </div>
            )}
            {upcomingEntries.length > 0 ? (
              <div className="pt-3 text-center text-xs text-muted-foreground">
                מציג {upcomingReveal.visibleCount} מתוך {upcomingCount} תנועות עתידיות
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
        </TabsContent>
        <TabsContent value="ledger" forceMount className="data-[state=inactive]:hidden">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-right">יומן תזרים מלא</CardTitle>
          <CardDescription className="text-right">
            כל התנועות לאחר הסינון, לפי תאריך התזרים האמיתי שלהן.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <SearchIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={ledgerSearch}
                onChange={(e) => {
                  setLedgerVisible(60);
                  setLedgerSearch(e.target.value);
                }}
                placeholder="חיפוש ביומן (פירוט, מקור, תחום)"
                className="h-9 pr-9"
              />
            </div>
            <NativeSelect dense
              value={ledgerMonth}
              onChange={(e) => {
                setLedgerVisible(60);
                setLedgerMonth(e.target.value);
              }}
            >
              <option value="">כל החודשים</option>
              {ledgerMonths.map((m) => (
                <option key={m} value={m}>{`${m.slice(5)}/${m.slice(0, 4)}`}</option>
              ))}
            </NativeSelect>
            {ledgerSearch || ledgerMonth ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLedgerVisible(60);
                  setLedgerSearch("");
                  setLedgerMonth("");
                }}
              >
                ניקוי
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={exportLedgerCsv} disabled={displayLedger.length === 0}>
              ייצוא ל-CSV
            </Button>
          </div>
          {filteredEntries.length === 0 ? (
            <EmptyState>
              לא נמצאו תנועות עבור הסינון שנבחר.
            </EmptyState>
          ) : (
            <>
              <div dir="rtl" className="grid gap-3 md:hidden">
                {pagedLedgerEntries.map((entry) => {
                  const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                  return (
                  <article
                    key={entry.id}
                    data-focus-id={entry.id}
                    className={cn(
                      "rounded-2xl border p-4 text-right",
                      entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                    )}
                    onClick={() => navigateToEntry(entry)}
                  >
                    <div className="flex items-start justify-between gap-3 sm:flex-row-reverse">
                      <div className="space-y-1">
                        <div dir="ltr" className="text-sm font-medium tabular-nums">{formatShortDate(entry.flowDate)}</div>
                        <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate, "-", data.todayIso)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2 text-sm">
                      <div className="font-medium">{entry.description}</div>
                      <div className="text-muted-foreground">{entry.domainName}</div>
                      <div className="text-muted-foreground">
                        {entry.sourceHref ? (
                          <Link
                            href={entry.sourceHref}
                            className="transition-colors hover:text-foreground"
                            onClick={(event) => {
                              event.stopPropagation();
                              emitNavigationStart();
                            }}
                          >
                            <span dir="auto">{entry.sourceLabel}</span>
                          </Link>
                        ) : (
                          <span dir="auto">{entry.sourceLabel}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {entry.paymentMethodLabel ? <span>{entry.paymentMethodLabel}</span> : null}
                        {entry.reference ? <span>{entry.reference}</span> : null}
                        {entry.recordedByName ? <span>הוזן ע&quot;י {entry.recordedByName}</span> : null}
                        {entry.origin === "expense" ? (
                          <>
                            <span className={cn(
                              "rounded-full border px-2 py-0.5 font-medium",
                              (entry.paymentStatus ?? "not_paid") === "paid" ? "border-success/40 bg-success/10 text-success" :
                              (entry.paymentStatus ?? "not_paid") === "partial" ? "border-warning/40 bg-warning/15 text-warning-strong" :
                              "border-destructive/40 bg-destructive/10 text-destructive"
                            )}>
                              {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקית" : "לא שולם"}
                            </span>
                            {(() => {
                              const st = entry.paymentStatus ?? "not_paid";
                              if (st !== "paid" && st !== "partial") return null;
                              const methodLabel = entry.expensePaymentMethod === "bank_transfer" ? "העברה בנקאית"
                                : entry.expensePaymentMethod === "cash" ? "מזומן"
                                : entry.expensePaymentMethod === "check" ? "צ'ק"
                                : entry.expensePaymentMethod === "credit_card" ? "כרטיס אשראי"
                                : entry.expensePaymentMethod === "other" ? "אחר" : null;
                              const parts: string[] = [];
                              if (st === "partial" && entry.expensePaidAmount != null && entry.expensePaidAmount > 0) parts.push(`שולם ${formatCurrency(entry.expensePaidAmount)}`);
                              if (methodLabel) parts.push(methodLabel);
                              if (!parts.length) return null;
                              return <span>{parts.join(" • ")}</span>;
                            })()}
                          </>
                        ) : null}
                      </div>
                      <div dir="ltr" className={cn("font-semibold tabular-nums", typeAmountClass(entry.type))}>
                        {entry.type === "inflow" ? "+" : "-"}
                        {formatCurrency(entry.amount)}
                      </div>
                      {canManageExpenses && editableExpense ? (
                        <div className="flex justify-end gap-2 pt-1">
                          <EditButton onClick={(event) => {
                              event.stopPropagation();
                              openExpenseEditor(editableExpense);
                            }} label="עריכה" />
                          <DeleteButton
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeletingExpense(editableExpense);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </article>
                  );
                })}
              </div>

              <div ref={ledgerScrollRef} className="hidden max-h-[70vh] overflow-auto md:block">
                <table className="w-full text-right text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-right text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-3 py-2 font-medium">
                        <button type="button" onClick={() => toggleLedgerSort("date")} className="inline-flex items-center hover:text-foreground">
                          תאריך תזרים{sortArrow("date")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">סטטוס</th>
                      <th className="px-3 py-2 font-medium">סוג</th>
                      <th className="px-3 py-2 font-medium">
                        <button type="button" onClick={() => toggleLedgerSort("domain")} className="inline-flex items-center hover:text-foreground">
                          תחום / מקור{sortArrow("domain")}
                        </button>
                      </th>
                      <th className="px-3 py-2 font-medium">פירוט</th>
                      <th className="px-3 py-2 font-medium">
                        <button type="button" onClick={() => toggleLedgerSort("amount")} className="inline-flex items-center hover:text-foreground">
                          סכום{sortArrow("amount")}
                        </button>
                      </th>
                      {canManageExpenses ? <th className="px-3 py-2 font-medium">פעולות</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLedgerEntries.map((entry) => {
                      const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                      return (
                      <tr
                        key={entry.id}
                        data-focus-id={entry.id}
                        className={cn(
                          "border-b last:border-b-0",
                          entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                        )}
                        onClick={() => navigateToEntry(entry)}
                      >
                        <td className="px-3 py-2 align-top">
                          <div dir="ltr" className="tabular-nums">{formatShortDate(entry.flowDate)}</div>
                          <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate, "-", data.todayIso)}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div>{entry.domainName}</div>
                          <div className="text-xs text-muted-foreground">
                            {entry.sourceHref ? (
                              <Link
                                href={entry.sourceHref}
                                className="transition-colors hover:text-foreground"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  emitNavigationStart();
                                }}
                              >
                                <span dir="auto">{entry.sourceLabel}</span>
                              </Link>
                            ) : (
                              <span dir="auto">{entry.sourceLabel}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div>{entry.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {[
                              entry.paymentMethodLabel,
                              entry.reference,
                              entry.recordedDate && entry.recordedDate !== entry.flowDate
                                ? `נרשם: ${formatShortDate(entry.recordedDate)}`
                                : null,
                              entry.dueDate ? `פירעון: ${formatShortDate(entry.dueDate)}` : null,
                              entry.recordedByName ? `הוזן ע"י ${entry.recordedByName}` : null,
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </div>
                          {entry.origin === "expense" ? (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={cn(
                                "inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium",
                                (entry.paymentStatus ?? "not_paid") === "paid" ? "border-success/40 bg-success/10 text-success" :
                                (entry.paymentStatus ?? "not_paid") === "partial" ? "border-warning/40 bg-warning/15 text-warning-strong" :
                                "border-destructive/40 bg-destructive/10 text-destructive"
                              )}>
                                {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקית" : "לא שולם"}
                              </span>
                              {(() => {
                                const st = entry.paymentStatus ?? "not_paid";
                                if (st !== "paid" && st !== "partial") return null;
                                const methodLabel = entry.expensePaymentMethod === "bank_transfer" ? "העברה בנקאית"
                                  : entry.expensePaymentMethod === "cash" ? "מזומן"
                                  : entry.expensePaymentMethod === "check" ? "צ'ק"
                                  : entry.expensePaymentMethod === "credit_card" ? "כרטיס אשראי"
                                  : entry.expensePaymentMethod === "other" ? "אחר" : null;
                                const parts: string[] = [];
                                if (st === "partial" && entry.expensePaidAmount != null && entry.expensePaidAmount > 0) parts.push(`שולם ${formatCurrency(entry.expensePaidAmount)}`);
                                if (methodLabel) parts.push(methodLabel);
                                if (!parts.length) return null;
                                return <span className="text-[10px] text-muted-foreground">{parts.join(" • ")}</span>;
                              })()}
                            </div>
                          ) : null}
                        </td>
                        <td dir="ltr" className={cn("px-3 py-2 align-top text-left font-semibold tabular-nums", typeAmountClass(entry.type))}>
                          {entry.type === "inflow" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </td>
                        {canManageExpenses ? (
                          <td className="px-3 py-2 align-top">
                            {editableExpense ? (
                              <div className="flex items-center justify-end gap-1">
                                {(editableExpense.paymentStatus ?? "not_paid") !== "paid" ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-success hover:text-success"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openMarkPaid(editableExpense);
                                    }}
                                  >
                                    <SuccessIcon className="h-4 w-4" />
                                    <span className="sr-only">סמן כשולם</span>
                                  </Button>
                                ) : null}
                                <EditButton onClick={(event) => {
                                    event.stopPropagation();
                                    openExpenseEditor(editableExpense);
                                  }} label="עריכה" />
                                <DeleteButton
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingExpense(editableExpense);
                                  }}
                                />
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ledgerHasMore ? <div ref={ledgerSentinelRef} className="h-1" /> : null}
              </div>
              {ledgerHasMore ? <div ref={ledgerMobileSentinelRef} className="h-1 md:hidden" /> : null}
              <div className="pt-3 text-center text-xs text-muted-foreground">
                מציג {pagedLedgerEntries.length} מתוך {displayLedger.length} תנועות
                {data.ledgerTotalCount > ledgerEntries.length
                  ? " · המערכת טוענת עד 1500 — סננו לפי תאריך לצפייה בנוספות"
                  : ""}
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
      )}

      <ExpenseDialog
        open={expenseCreateOpen}
        onOpenChange={(open) => {
          if (!open) clearDraft("expense-create");
          setExpenseCreateOpen(open);
        }}
        recurringProjects={recurringProjects}
        recurringOrders={recurringOrders}
        recurringProperties={recurringProperties}
        onSaved={() => {
          clearDraft("expense-create");
          return refreshAndWait();
        }}
      />

      <FormDialog
        open={incomeCreateOpen}
        onOpenChange={(open) => {
          setIncomeCreateOpen(open);
          if (!open) {
            clearDraft("income-create");
            setIncomeCreateForm(createIncomeFormState());
          }
        }}
        title="הוספת הכנסה"
        description="יצירת תקבול חדש ישירות מעמוד הפיננסי."
        onSubmit={() => void createIncome()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={isCreatingIncome}
      >
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום עסקי *</div>
              <DomainSelect
                value={incomeCreateForm.businessDomain}
                onChange={(value) =>
                  setIncomeCreateForm((current) => ({
                    ...current,
                    businessDomain: value as ExpenseBusinessDomain | "",
                    projectId: value === "logistics_projects" ? current.projectId : "",
                    orderId: value === "sales" ? current.orderId : "",
                    propertyId: value === "property_management" ? current.propertyId : "",
                    tagIds: value === "general_business" ? current.tagIds : [],
                  }))
                }
              />
            </div>

            {incomeCreateForm.businessDomain === "logistics_projects" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט</div>
                <ProjectPicker
                  projects={recurringProjects}
                  value={incomeCreateForm.projectId}
                  onChange={(id) =>
                    setIncomeCreateForm((current) => ({ ...current, projectId: id }))
                  }
                  emptyLabel="ללא פרויקט"
                />
              </div>
            ) : null}

            {incomeCreateForm.businessDomain === "sales" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">הזמנה</div>
                <NativeSelect
                  value={incomeCreateForm.orderId}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, orderId: event.target.value }))
                  }
                >
                  <option value="">בחר הזמנה</option>
                  {recurringOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {incomeCreateForm.businessDomain === "property_management" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס *</div>
                <NativeSelect
                  value={incomeCreateForm.propertyId}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, propertyId: event.target.value }))
                  }
                >
                  <option value="">בחר נכס</option>
                  {recurringProperties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}

            {incomeCreateForm.businessDomain ? (
              <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">סכום *</div>
                <CurrencyInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={incomeCreateForm.amount}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, amount: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">תאריך</div>
                <DateInput
                  value={incomeCreateForm.paymentDate}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, paymentDate: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">אמצעי תשלום</div>
                <NativeSelect
                  value={incomeCreateForm.paymentMethod}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => {
                      const paymentMethod = event.target.value as IncomeCreateFormState["paymentMethod"];
                      return {
                        ...current,
                        paymentMethod,
                        accountId: current.accountId || defaultAccountForMethod(incomeAccountsList, paymentMethod),
                      };
                    })
                  }
                >
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="cash">מזומן</option>
                  <option value="check">צ׳ק</option>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="other">אחר</option>
                </NativeSelect>
              </div>
              <AccountSelect
                required
                value={incomeCreateForm.accountId}
                onChange={(accountId) => setIncomeCreateForm((current) => ({ ...current, accountId }))}
                onLoaded={(list) => {
                  setIncomeAccountsList(list);
                  setIncomeCreateForm((current) => ({
                    ...current,
                    accountId: current.accountId || defaultAccountForMethod(list, current.paymentMethod),
                  }));
                }}
              />
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {incomeCreateForm.paymentMethod === "check"
                    ? "תאריך פירעון *"
                    : "תאריך פירעון צפוי (אופציונלי)"}
                </div>
                <DateInput
                  value={incomeCreateForm.dueDate}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, dueDate: event.target.value }))
                  }
                />
                {incomeCreateForm.paymentMethod !== "check" ? (
                  <p className="text-[11px] text-muted-foreground">
                    לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                  </p>
                ) : null}
              </div>
            </div>

            {incomeCreateForm.paymentMethod === "check" ? (
              <CheckDetailsFields
                checkNumber={incomeCreateForm.checkNumber}
                onCheckNumberChange={(value) =>
                  setIncomeCreateForm((current) => ({ ...current, checkNumber: value }))
                }
                photoFiles={incomeCheckPhotoFiles}
                onPhotoFilesChange={setIncomeCheckPhotoFiles}
                disabled={isCreatingIncome}
              />
            ) : null}

            <div className="space-y-1">
              <div className="text-sm font-medium">אסמכתא</div>
              <Input
                value={incomeCreateForm.referenceNumber}
                onChange={(event) =>
                  setIncomeCreateForm((current) => ({ ...current, referenceNumber: event.target.value }))
                }
              />
            </div>

            <label className="flex items-center gap-2 rounded-xl border px-3 py-3 text-sm">
              <input
                type="checkbox"
                checked={incomeCreateForm.requiresSplit}
                onChange={(event) =>
                  setIncomeCreateForm((current) => ({ ...current, requiresSplit: event.target.checked }))
                }
              />
              <span>דורש פיצול</span>
            </label>

            <div className="space-y-1">
              <div className="text-sm font-medium">הערות</div>
              <div className="relative">
                <Textarea
                  value={incomeCreateForm.notes}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) =>
                    setIncomeCreateForm((current) => ({ ...current, notes: appendDictatedText(current.notes, text) }))
                  }
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </div>

            {incomeCreateForm.businessDomain === "general_business" ? (
              <TagPicker
                value={incomeCreateForm.tagIds}
                onChange={(ids) => setIncomeCreateForm((current) => ({ ...current, tagIds: ids }))}
              />
            ) : null}
              </>
            ) : null}

      </FormDialog>

      <ExpenseDialog
        open={Boolean(activeEditingExpense)}
        onOpenChange={(open) => {
          if (open) return;
          setEditingExpense(null);
          if (focusId) setFocusDismissed(focusId);
        }}
        editingExpense={activeEditingExpense ? {
          id: activeEditingExpense.expenseId,
          amount: activeEditingExpense.amount,
          category: activeEditingExpense.expenseCategory,
          description: activeEditingExpense.expenseDescriptionRaw,
          notes: activeEditingExpense.expenseNotes,
          expense_date: activeEditingExpense.recordedDate ?? activeEditingExpense.flowDate,
          business_domain: activeEditingExpense.businessDomain,
          payment_status: activeEditingExpense.paymentStatus,
          paid_amount: activeEditingExpense.expensePaidAmount ?? null,
          payment_method: activeEditingExpense.expensePaymentMethod ?? null,
          account_id: activeEditingExpense.expenseAccountId ?? null,
          project_id: activeEditingExpense.expenseProjectId,
          order_id: activeEditingExpense.expenseOrderId,
          property_id: activeEditingExpense.expensePropertyId,
        } : null}
        editingSourceLabel={activeEditingExpense?.sourceLabel ?? null}
        lockedProjectId={activeEditingExpense?.expenseProjectId}
        lockedOrderId={activeEditingExpense?.expenseOrderId}
        // NOT lockedPropertyId — unlike project/order, property_id is meant to
        // be freely re-editable from this general list (see /api/expenses/update
        // and the ExpenseDialog picker itself); locking it here would show the
        // read-only "association kept as-is" box instead of the picker for any
        // expense that already has a property, defeating that fix entirely
        // (2026-08-27, caught auditing for "more places with this issue").
        recurringProjects={recurringProjects}
        recurringOrders={recurringOrders}
        recurringProperties={recurringProperties}
        onSaved={() => {
          return refreshAndWait();
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingExpense)}
        onOpenChange={(open) => {
          if (!open) setDeletingExpense(null);
        }}
        destructive
        title="מחיקת חיוב"
        description="הפעולה תמחק את ההוצאה מהתזרים ומהקישור שלה למקור, אם קיים."
        confirmLabel="מחיקה"
        loading={isDeletingExpense}
        onConfirm={() => void confirmExpenseDelete()}
      >
          {deletingExpense ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border bg-muted/20 px-3 py-3 text-sm">
                <div className="font-medium">{deletingExpense.description}</div>
                <div className="mt-1 text-muted-foreground">{deletingExpense.sourceLabel}</div>
                <div dir="ltr" className="mt-2 font-semibold tabular-nums">
                  -{formatCurrency(deletingExpense.amount)}
                </div>
              </div>
            </div>
          ) : null}
      </ConfirmDialog>

      <FormDialog
        open={Boolean(markPaidExpense)}
        onOpenChange={(open) => {
          if (!open) setMarkPaidExpense(null);
        }}
        title="סימון כשולם"
        description="אישור שההוצאה אכן שולמה. היא תעבור לתזרים בפועל בתאריך התשלום."
        size="formMd"
        onSubmit={() => void confirmMarkPaid()}
        submitLabel="אישור תשלום"
        busyLabel="מסמן..."
        busy={isMarkingPaid}
      >
          {markPaidExpense ? (
            <div className="mt-4 space-y-3" dir="rtl">
              <div className="rounded-xl border bg-muted/20 px-3 py-3 text-sm">
                <div className="font-medium">{markPaidExpense.description}</div>
                <div className="mt-1 text-muted-foreground">{markPaidExpense.sourceLabel}</div>
                <div dir="ltr" className="mt-2 text-left font-semibold tabular-nums">
                  -{formatCurrency(markPaidExpense.amount)}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-sm font-medium">אמצעי תשלום</div>
                  <NativeSelect
                    value={markPaidMethod}
                    onChange={(event) => {
                      const m = event.target.value;
                      setMarkPaidMethod(m);
                      setMarkPaidAccountId((prev) => prev || defaultAccountForMethod(markPaidAccountsList, m));
                    }}
                  >
                    <option value="">בחר אמצעי</option>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">תאריך תשלום</div>
                  <DateInput value={markPaidDate} onChange={(event) => setMarkPaidDate(event.target.value)} />
                </div>
                <AccountSelect
                  required
                  value={markPaidAccountId}
                  onChange={setMarkPaidAccountId}
                  onLoaded={(list) => {
                    setMarkPaidAccountsList(list);
                    setMarkPaidAccountId((prev) => prev || defaultAccountForMethod(list, markPaidMethod));
                  }}
                />
              </div>

            </div>
          ) : null}
      </FormDialog>
            </div>
      </div>
        </>
      ) : null}
    </div>
  );
}

export type { InitialFilters as FinancialPageInitialFilters };



