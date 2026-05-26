"use client";

import DomainBarChart from "@/components/charts/DomainBarChart";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Landmark, Loader2, Pencil, Search, TimerReset, Trash2 } from "lucide-react";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { formatRelativeDateLabel, formatShortDate } from "@/lib/date";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import type {
  FinancialEntry,
  FinancialEntryStage,
  FinancialPageData,
  FinancialSourceKind,
} from "@/lib/financial";
import { cn } from "@/lib/utils";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { ObligationsTab } from "@/app/financial/ObligationsTab";
import type { ObligationsData } from "@/lib/financial/obligations";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
  obligationsData: ObligationsData;
  initialFilters: InitialFilters;
  customerId: string;
  customerName: string;
  customerPage: string;
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
  referenceNumber: string;
  notes: string;
  requiresSplit: boolean;
};

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function sourceKindLabel(kind: FinancialSourceKind | null) {
  if (kind === "project") return "פרויקט";
  if (kind === "property") return "נכס";
  if (kind === "order") return "הזמנה";
  return "מקור";
}

function stageLabel(stage: FinancialEntryStage) {
  if (stage === "scheduled") return "צפוי";
  if (stage === "pending") return "ממתין";
  return "בפועל";
}

function stageVariant(stage: FinancialEntryStage) {
  if (stage === "scheduled") return "outline" as const;
  if (stage === "pending") return "warning" as const;
  return "success" as const;
}

function typeLabel(type: FinancialEntry["type"]) {
  return type === "inflow" ? "כניסה" : "יציאה";
}

function typeVariant(type: FinancialEntry["type"]) {
  return type === "inflow" ? ("success" as const) : ("destructive" as const);
}

function typeAmountClass(type: FinancialEntry["type"]) {
  return type === "inflow" ? "text-success" : "text-destructive";
}

function buildCustomerReturnHref(customerId: string, customerName: string, customerPage: string) {
  const params = new URLSearchParams({ customer_id: customerId });
  if (customerName) params.set("customer_name", customerName);
  if (customerPage) params.set("page", customerPage);
  return `/customers?${params.toString()}`;
}

function sourceTypeTitle(kind: FinancialSourceKind) {
  if (kind === "project") return "פרויקט";
  if (kind === "property") return "נכס";
  if (kind === "order") return "הזמנה";
  return "כללי";
}

function isEditableExpenseEntry(entry: FinancialEntry): entry is EditableExpenseEntry {
  return entry.origin === "expense" && typeof entry.expenseId === "string" && entry.expenseId.length > 0;
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
    referenceNumber: "",
    notes: "",
    requiresSplit: false,
  };
}

function SummaryCard({
  title,
  value,
  description,
  accent,
}: {
  title: string;
  value: string;
  description: string;
  accent?: "success" | "destructive" | "default";
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5 text-right">
        <div className="text-sm text-muted-foreground">{title}</div>
        <div
          dir="ltr"
          className={cn(
            "mt-2 text-2xl font-semibold tabular-nums",
            accent === "success" && "text-success",
            accent === "destructive" && "text-destructive"
          )}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </CardContent>
    </Card>
  );
}

function SelectField({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="space-y-1.5 text-sm text-right">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-input bg-background px-3 text-right text-sm shadow-sm"
      >
        {children}
      </select>
    </label>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  itemLabel,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  itemLabel: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col gap-3 border-t pt-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="text-muted-foreground">
        עמוד {page} מתוך {totalPages} • {itemLabel}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          הקודם
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          הבא
        </Button>
      </div>
    </div>
  );
}

function FilterLoadingDots() {
  return (
    <div className="flex justify-center" aria-live="polite" aria-label="Loading filtered financial data">
      <div className="flex items-center gap-4">
        {[
          { delayMs: 0, className: "bg-primary shadow-primary/35" },
          { delayMs: 150, className: "bg-secondary shadow-secondary/35" },
          { delayMs: 300, className: "bg-primary shadow-primary/35" },
          { delayMs: 450, className: "bg-secondary shadow-secondary/35" },
        ].map(({ delayMs, className }) => (
          <span
            key={delayMs}
            className={cn("h-7 w-7 animate-pulse rounded-full shadow-xl", className)}
            style={{ animationDelay: `${delayMs}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
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
  obligationsData,
  initialFilters,
  customerId,
  customerName,
  customerPage,
  canManageExpenses,
  canViewCashflow,
  recurringProjects,
  recurringOrders,
  recurringProperties,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialFilters.q);
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [domain, setDomain] = useState(initialFilters.domain);
  const [sourceId, setSourceId] = useState(initialFilters.sourceId);
  const [type, setType] = useState(initialFilters.type);
  const [stage, setStage] = useState(initialFilters.stage);
  const [resolvedCanView, setResolvedCanView] = useState(canViewCashflow);
  const [activeView, setActiveView] = useState<"cashflow" | "obligations">(canViewCashflow ? "cashflow" : "obligations");
  const viewCorrectedRef = useRef(false);

  useIsomorphicLayoutEffect(() => {
    const cached = readCachedIsAdmin();
    const effective = cached !== null ? cached : canViewCashflow;
    setResolvedCanView(effective);
    if (!viewCorrectedRef.current) {
      viewCorrectedRef.current = true;
      if (effective && !canViewCashflow) {
        setActiveView("cashflow");
      }
    }
  }, [canViewCashflow]);
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const [loadingOverlayTop, setLoadingOverlayTop] = useState(0);
  const [loadingOverlayLeft, setLoadingOverlayLeft] = useState(0);
  const [loadingOverlayRight, setLoadingOverlayRight] = useState(0);
  const filtersCardRef = useRef<HTMLDivElement | null>(null);
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
    data.openLiabilitiesSummary.outflow;
  const domainGroups = data.domainGroups;
  const upcomingEntries = data.upcomingEntries;
  const ledgerEntries = data.ledgerEntries;
  const filteredEntries = { length: data.ledgerTotalCount };
  const pagedUpcomingEntries = upcomingEntries;
  const pagedLedgerEntries = ledgerEntries;
  const currentUpcomingPage = data.upcomingPage;
  const upcomingTotalPages = data.upcomingTotalPages;
  const currentLedgerPage = data.ledgerPage;
  const ledgerTotalPages = data.ledgerTotalPages;

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
  const setUpcomingPage = (page: number) => replaceFilters({ upcomingPage: page });
  const setLedgerPage = (page: number) => replaceFilters({ ledgerPage: page });
  const [editingExpense, setEditingExpense] = useState<EditableExpenseEntry | null>(null);
  const [deletingExpense, setDeletingExpense] = useState<EditableExpenseEntry | null>(null);
  const [isDeletingExpense, setIsDeletingExpense] = useState(false);
  const [expenseCreateOpen, setExpenseCreateOpen] = useState(false);
  const [incomeCreateOpen, setIncomeCreateOpen] = useState(false);
  const [incomeCreateForm, setIncomeCreateForm] = useState<IncomeCreateFormState>(
    () => loadDraft<IncomeCreateFormState>("income-create") ?? createIncomeFormState()
  );
  const [isCreatingIncome, setIsCreatingIncome] = useState(false);

  useEffect(() => {
    if (!isFilterPending) return undefined;

    const updateOverlayBounds = () => {
      const nextTop = filtersCardRef.current?.getBoundingClientRect().bottom ?? 0;
      const contentRect = contentAreaRef.current?.getBoundingClientRect() ?? null;
      setLoadingOverlayTop(Math.max(0, Math.round(nextTop + 12)));
      setLoadingOverlayLeft(contentRect ? Math.max(0, Math.round(contentRect.left)) : 0);
      setLoadingOverlayRight(
        contentRect ? Math.max(0, Math.round(window.innerWidth - contentRect.right)) : 0
      );
    };

    updateOverlayBounds();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", updateOverlayBounds);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", updateOverlayBounds);
    };
  }, [isFilterPending]);

  useEffect(() => {
    if (!isRefreshPending && refreshResolveRef.current) {
      const resolve = refreshResolveRef.current;
      refreshResolveRef.current = null;
      resolve();
    }
  }, [isRefreshPending]);

  function refreshAndWait() {
    return new Promise<void>((resolve) => {
      refreshResolveRef.current = resolve;
      startRefreshTransition(() => {
        router.refresh();
      });
    });
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

  const confirmExpenseDelete = async () => {
    if (!deletingExpense) return;

    setIsDeletingExpense(true);
    try {
      const res = await fetch("/api/expenses/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: deletingExpense.expenseId,
          project_id: deletingExpense.expenseProjectId,
          order_id: deletingExpense.expenseOrderId,
          property_id: deletingExpense.expensePropertyId,
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        toast.error("שגיאה במחיקת החיוב", { description: json?.error ?? "" });
        return;
      }

      toast.success("החיוב נמחק");
      setDeletingExpense(null);
      router.refresh();
    } catch (error) {
      toast.error("שגיאה במחיקת החיוב", {
        description: error instanceof Error ? error.message : "",
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
        due_date: incomeCreateForm.paymentMethod === "check" ? incomeCreateForm.dueDate : null,
        requires_split: incomeCreateForm.requiresSplit,
        payment_method: incomeCreateForm.paymentMethod,
        reference_number: incomeCreateForm.referenceNumber.trim() || null,
        notes: incomeCreateForm.notes.trim() || null,
      }, "הכנסה חדשה");

      if (result.queued) {
        toast.info("אין חיבור — ההכנסה תישמר ותישלח כשיחזור החיבור");
        setIncomeCreateOpen(false);
        clearDraft("income-create");
        setIncomeCreateForm(createIncomeFormState());
        return;
      }
      if (!result.ok) {
        toast.error("שגיאה ביצירת ההכנסה", { description: result.error });
        return;
      }

      toast.success("ההכנסה נוספה");
      setIncomeCreateOpen(false);
      clearDraft("income-create");
      setIncomeCreateForm(createIncomeFormState());
      router.refresh();
    } catch (error) {
      toast.error("שגיאה ביצירת ההכנסה", {
        description: error instanceof Error ? error.message : "",
      });
    } finally {
      setIsCreatingIncome(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <section className="flex items-center justify-between gap-3">
        <div className="hidden">
          <h1 className="text-2xl font-semibold">פיננסי</h1>
          {customerName ? <div className="text-lg font-medium">לקוח: {customerName}</div> : null}
          <p className="text-sm text-muted-foreground">
            תצוגת תזרים לפי תחום עסקי, כולל הכנסות והוצאות עתידיות כמו צ&apos;קים להפקדה והוצאות מתוזמנות.
          </p>
        </div>
        {customerId ? (
          <Button asChild variant="outline">
            <Link href={buildCustomerReturnHref(customerId, customerName, customerPage)}>חזרה ללקוח</Link>
          </Button>
        ) : null}
      </section>

      {/* View toggle — admin only */}
      {resolvedCanView ? (
        <div className="flex gap-1 rounded-xl border bg-secondary/40 p-1 w-fit">
          {(["cashflow", "obligations"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className={cn(
                "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                activeView === view
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {view === "cashflow" ? "תזרים" : "יתרות"}
            </button>
          ))}
        </div>
      ) : null}

      {activeView === "obligations" ? (
        <ObligationsTab data={obligationsData} canManageExpenses={canManageExpenses} />
      ) : null}

      {resolvedCanView && activeView === "cashflow" ? (
        <>
      {canManageExpenses ? (
        <div className="flex flex-wrap justify-start gap-2">
          <Button type="button" onClick={() => setExpenseCreateOpen(true)}>
            הוספת הוצאה
          </Button>
          <Button type="button" variant="outline" onClick={() => setIncomeCreateOpen(true)}>
            הוספת הכנסה
          </Button>
        </div>
      ) : null}

      <div dir="rtl" className="space-y-4 text-right">
      <div ref={filtersCardRef}>
      <Card>
        <CardHeader className="hidden">
          <CardTitle className="text-lg text-right">סינון וניווט</CardTitle>
          <CardDescription className="text-right">
            מסננים מקומיים לפי תאריך תזרים, תחום עסקי, מקור, סוג תנועה וחיפוש חופשי.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-6">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_repeat(6,minmax(0,1fr))]">
            <label className="space-y-1.5 text-sm text-right">
              <span className="font-medium">חיפוש</span>
              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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

            <label className="space-y-1.5 text-sm text-right">
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

            <label className="space-y-1.5 text-sm text-right">
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
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm sm:flex-row">
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
              <Badge variant="outline">{filteredEntries.length} תנועות</Badge>
              <Badge variant="outline">{sourceCount} מקורות</Badge>
              <Badge variant="outline">{upcomingCount} צפויות / ממתינות</Badge>
            </div>
            <Button type="button" variant="outline" onClick={resetFilters}>
              <TimerReset className="ml-2 h-4 w-4" />
              איפוס
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>

      <div ref={contentAreaRef} className="relative">
        {isFilterPending ? (
          <div
            className="fixed bottom-0 z-30 bg-background/60 backdrop-blur-[2px]"
            style={{
              top: loadingOverlayTop,
              left: loadingOverlayLeft,
              right: loadingOverlayRight,
            }}
          >
            <div className="flex h-full min-h-[16rem] items-start justify-center px-4 pt-12">
              <FilterLoadingDots />
            </div>
          </div>
        ) : null}

      <section dir="rtl" className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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
          title="חובות לקוחות פתוחים"
          value={formatCurrency(data.openReceivablesSummary.inflow)}
          description={`${data.openReceivablesSummary.count} יתרות מפרויקטים/הזמנות שהושלמו ועדיין לא שולמו`}
          accent="success"
        />
        <SummaryCard
          title="הכנסות מתוכננות"
          value={formatCurrency(data.plannedReceivablesSummary.inflow)}
          description={`${data.plannedReceivablesSummary.count} תקבולים צפויים מצ'קים, פרויקטים והזמנות שעדיין בתהליך`}
          accent="success"
        />
        <SummaryCard
          title="התחייבויות פתוחות"
          value={formatCurrency(data.openLiabilitiesSummary.outflow)}
          description={`${data.openLiabilitiesSummary.count} חובות שכבר נוצרו ועדיין לא שולמו`}
          accent="destructive"
        />
        <SummaryCard
          title="תשלומים מתוזמנים"
          value={formatCurrency(data.scheduledLiabilitiesSummary.outflow)}
          description={`${data.scheduledLiabilitiesSummary.count} תשלומים עתידיים שעדיין לא הגיע מועד התזרים שלהם`}
          accent="destructive"
        />
        <SummaryCard
          title="יתרה בפועל"
          value={formatCurrency(summaries.actual.net)}
          description="מאזן מזומנים שכבר נרשם בפועל"
          accent={summaries.actual.net >= 0 ? "success" : "destructive"}
        />
        <SummaryCard
          title="שווי נוכחי"
          value={formatCurrency(currentWorthNow)}
          description="יתרה בפועל + חובות לקוחות פתוחים - התחייבויות פתוחות"
          accent={currentWorthNow >= 0 ? "success" : "destructive"}
        />
        <SummaryCard
          title={initialFilters.to ? "תחזית עד תאריך" : "תחזית ל-30 יום"}
          value={formatCurrency(data.forecastSummary.net)}
          description={`כולל בפועל וצפי עד ${formatShortDate(data.forecastEndIso)}`}
          accent={data.forecastSummary.net >= 0 ? "success" : "destructive"}
        />
      </section>

      <section dir="rtl" className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-right">מבט תחומים עסקיים</CardTitle>
            <CardDescription className="text-right">
              חלוקה לפי דומיין עסקי, עם הפרדה בין תזרים בפועל לצפי עתידי.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {domainGroups.length > 0 && (
              <DomainBarChart
                data={domainGroups.map((g) => ({
                  name: g.domainName,
                  inflow: g.actual.inflow,
                  outflow: g.actual.outflow,
                }))}
                height={220}
              />
            )}
            {domainGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                אין תנועות להצגה עבור הסינון שנבחר.
              </div>
            ) : (
              domainGroups.map((group) => (
                <div key={group.domain ?? "general"} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 text-right">
                      <div className="font-medium">{group.domainName}</div>
                      <div className="text-xs text-muted-foreground">
                        {group.total.count} תנועות • נטו {formatCurrency(group.total.net)}
                      </div>
                    </div>
                    <Badge variant="outline">{group.domain ? getBusinessDomainLabel(group.domain) : "כללי"}</Badge>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/30 p-3 text-sm">
                      <div className="text-muted-foreground">בפועל</div>
                      <div className="mt-1 grid gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">כניסות</span>
                          <span dir="ltr" className="text-success tabular-nums">{formatCurrency(group.actual.inflow)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">יציאות</span>
                          <span dir="ltr" className="text-destructive tabular-nums">{formatCurrency(group.actual.outflow)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-muted/30 p-3 text-sm">
                      <div className="text-muted-foreground">צפוי / ממתין</div>
                      <div className="mt-1 grid gap-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">כניסות</span>
                          <span dir="ltr" className="text-success tabular-nums">{formatCurrency(group.future.inflow)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">יציאות</span>
                          <span dir="ltr" className="text-destructive tabular-nums">{formatCurrency(group.future.outflow)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-right">תזרים עתידי קרוב</CardTitle>
            <CardDescription className="text-right">
              כאן רואים מה עוד אמור להיכנס או לצאת, כולל צ&apos;קים עם תאריך פירעון והוצאות עתידיות.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                אין כרגע תנועות עתידיות או ממתינות בהתאם לסינון.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-right text-sm">
                  <thead className="text-right text-muted-foreground">
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
                            {formatRelativeDateLabel(entry.flowDate)}
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
                                {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקי" : "לא שולם"}
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
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openExpenseEditor(editableExpense);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">עריכת חיוב</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingExpense(editableExpense);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">מחיקת חיוב</span>
                                </Button>
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls
              page={currentUpcomingPage}
              totalPages={upcomingTotalPages}
              onPageChange={setUpcomingPage}
              itemLabel={`${upcomingEntries.length} תנועות עתידיות`}
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg text-right">יומן תזרים מלא</CardTitle>
          <CardDescription className="text-right">
            כל התנועות לאחר הסינון, לפי תאריך התזרים האמיתי שלהן.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              לא נמצאו תנועות עבור הסינון שנבחר.
            </div>
          ) : (
            <>
              <div dir="rtl" className="grid gap-3 md:hidden">
                {pagedLedgerEntries.map((entry) => {
                  const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                  return (
                  <article
                    key={entry.id}
                    className={cn(
                      "rounded-2xl border p-4 text-right",
                      entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                    )}
                    onClick={() => navigateToEntry(entry)}
                  >
                    <div className="flex items-start justify-between gap-3 sm:flex-row-reverse">
                      <div className="space-y-1">
                        <div dir="ltr" className="text-sm font-medium tabular-nums">{formatShortDate(entry.flowDate)}</div>
                        <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate)}</div>
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
                              {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקי" : "לא שולם"}
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
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              openExpenseEditor(editableExpense);
                            }}
                          >
                            <Pencil className="ml-1 h-4 w-4" />
                            עריכה
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              setDeletingExpense(editableExpense);
                            }}
                          >
                            <Trash2 className="ml-1 h-4 w-4" />
                            מחיקה
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-right text-sm">
                  <thead className="text-right text-muted-foreground">
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
                    {pagedLedgerEntries.map((entry) => {
                      const editableExpense = isEditableExpenseEntry(entry) ? entry : null;
                      return (
                      <tr
                        key={entry.id}
                        className={cn(
                          "border-b last:border-b-0",
                          entry.sourceHref ? "cursor-pointer transition-colors hover:bg-muted/30" : ""
                        )}
                        onClick={() => navigateToEntry(entry)}
                      >
                        <td className="px-3 py-3">
                          <div dir="ltr" className="tabular-nums">{formatShortDate(entry.flowDate)}</div>
                          <div className="text-xs text-muted-foreground">{formatRelativeDateLabel(entry.flowDate)}</div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        </td>
                        <td className="px-3 py-3">
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
                        <td className="px-3 py-3">
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
                                {(entry.paymentStatus ?? "not_paid") === "paid" ? "שולם" : (entry.paymentStatus ?? "not_paid") === "partial" ? "חלקי" : "לא שולם"}
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
                        <td dir="ltr" className={cn("px-3 py-3 text-left font-semibold tabular-nums", typeAmountClass(entry.type))}>
                          {entry.type === "inflow" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </td>
                        {canManageExpenses ? (
                          <td className="px-3 py-3">
                            {editableExpense ? (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openExpenseEditor(editableExpense);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  <span className="sr-only">עריכת חיוב</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeletingExpense(editableExpense);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span className="sr-only">מחיקת חיוב</span>
                                </Button>
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <PaginationControls
                page={currentLedgerPage}
                totalPages={ledgerTotalPages}
                onPageChange={setLedgerPage}
                itemLabel={`${filteredEntries.length} תנועות ביומן`}
              />
            </>
          )}
        </CardContent>
      </Card>

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

      <Dialog
        open={incomeCreateOpen}
        onOpenChange={(open) => {
          if (!open && !isCreatingIncome) {
            setIncomeCreateOpen(false);
            clearDraft("income-create");
            setIncomeCreateForm(createIncomeFormState());
            return;
          }
          if (open) setIncomeCreateOpen(true);
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>הוספת הכנסה</DialogTitle>
            <DialogDescription>יצירת תקבול חדש ישירות מעמוד הפיננסי.</DialogDescription>
          </DialogHeader>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createIncome();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום עסקי *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={incomeCreateForm.businessDomain}
                onChange={(event) =>
                  setIncomeCreateForm((current) => ({
                    ...current,
                    businessDomain: event.target.value as ExpenseBusinessDomain | "",
                    projectId: event.target.value === "logistics_projects" ? current.projectId : "",
                    orderId: event.target.value === "sales" ? current.orderId : "",
                    propertyId: event.target.value === "property_management" ? current.propertyId : "",
                  }))
                }
              >
                <option value="">בחרו תחום</option>
                {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {getBusinessDomainLabel(domain)}
                  </option>
                ))}
              </select>
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
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                </select>
              </div>
            ) : null}

            {incomeCreateForm.businessDomain === "property_management" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
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
                </select>
              </div>
            ) : null}

            {incomeCreateForm.businessDomain ? (
              <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">סכום *</div>
                <Input
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

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">אמצעי תשלום</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={incomeCreateForm.paymentMethod}
                  onChange={(event) =>
                    setIncomeCreateForm((current) => ({
                      ...current,
                      paymentMethod: event.target.value as IncomeCreateFormState["paymentMethod"],
                      dueDate: event.target.value === "check" ? current.dueDate : "",
                    }))
                  }
                >
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="cash">מזומן</option>
                  <option value="check">?&apos;?</option>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="other">אחר</option>
                </select>
              </div>
              {incomeCreateForm.paymentMethod === "check" ? (
                <div className="space-y-1">
                  <div className="text-sm font-medium">תאריך פירעון</div>
                  <DateInput
                    value={incomeCreateForm.dueDate}
                    onChange={(event) =>
                      setIncomeCreateForm((current) => ({ ...current, dueDate: event.target.value }))
                    }
                  />
                </div>
              ) : null}
            </div>

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
              <Textarea
                value={incomeCreateForm.notes}
                onChange={(event) =>
                  setIncomeCreateForm((current) => ({ ...current, notes: event.target.value }))
                }
              />
            </div>
              </>
            ) : null}

            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setIncomeCreateOpen(false);
                  clearDraft("income-create");
                  setIncomeCreateForm(createIncomeFormState());
                }}
                disabled={isCreatingIncome}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={isCreatingIncome}>
                {isCreatingIncome ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    שומר...
                  </>
                ) : (
                  "שמירה"
                )}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>

      <ExpenseDialog
        open={Boolean(editingExpense)}
        onOpenChange={(open) => {
          if (!open) setEditingExpense(null);
        }}
        editingExpense={editingExpense ? {
          id: editingExpense.expenseId,
          amount: editingExpense.amount,
          category: editingExpense.expenseCategory,
          description: editingExpense.expenseDescriptionRaw,
          notes: editingExpense.expenseNotes,
          expense_date: editingExpense.flowDate,
          business_domain: editingExpense.businessDomain,
          payment_status: editingExpense.paymentStatus,
          paid_amount: editingExpense.expensePaidAmount ?? null,
          payment_method: editingExpense.expensePaymentMethod ?? null,
          project_id: editingExpense.expenseProjectId,
          order_id: editingExpense.expenseOrderId,
          property_id: editingExpense.expensePropertyId,
        } : null}
        editingSourceLabel={editingExpense?.sourceLabel ?? null}
        lockedProjectId={editingExpense?.expenseProjectId}
        lockedOrderId={editingExpense?.expenseOrderId}
        lockedPropertyId={editingExpense?.expensePropertyId}
        onSaved={() => {
          return refreshAndWait();
        }}
      />

      <Dialog
        open={Boolean(deletingExpense)}
        onOpenChange={(open) => {
          if (!open && !isDeletingExpense) setDeletingExpense(null);
        }}
      >
        <AdaptiveDialog size="formMd">
          <DialogHeader>
            <DialogTitle>מחיקת חיוב</DialogTitle>
            <DialogDescription>הפעולה תמחק את ההוצאה מהתזרים ומהקישור שלה למקור, אם קיים.</DialogDescription>
          </DialogHeader>

          {deletingExpense ? (
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border bg-muted/20 px-3 py-3 text-sm">
                <div className="font-medium">{deletingExpense.description}</div>
                <div className="mt-1 text-muted-foreground">{deletingExpense.sourceLabel}</div>
                <div dir="ltr" className="mt-2 font-semibold tabular-nums">
                  -{formatCurrency(deletingExpense.amount)}
                </div>
              </div>

              <DialogFooter className="mt-6">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDeletingExpense(null)}
                  disabled={isDeletingExpense}
                >
                  ביטול
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void confirmExpenseDelete()}
                  disabled={isDeletingExpense}
                >
                  {isDeletingExpense ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      מוחק...
                    </>
                  ) : (
                    "מחיקה"
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </AdaptiveDialog>
      </Dialog>
      </div>
      </div>
        </>
      ) : null}
    </div>
  );
}

export type { InitialFilters as FinancialPageInitialFilters };



