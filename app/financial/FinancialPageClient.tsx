"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Landmark, Search, TimerReset } from "lucide-react";
import RecurringExpensesManager, {
  type RecurringExpenseTemplateItem,
} from "@/app/financial/RecurringExpensesManager";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeDateLabel, formatShortDate } from "@/lib/date";
import { getBusinessDomainLabel } from "@/lib/expenses";
import type {
  FinancialEntry,
  FinancialEntryStage,
  FinancialPageData,
  FinancialSourceKind,
} from "@/lib/financial";
import { cn } from "@/lib/utils";

type InitialFilters = {
  tab: "overview" | "recurring";
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
  initialFilters: InitialFilters;
  customerId: string;
  customerName: string;
  customerPage: string;
  canManageRecurring: boolean;
  recurringTemplates: RecurringExpenseTemplateItem[];
  recurringProjects: Array<{ id: string; label: string }>;
  recurringOrders: Array<{ id: string; label: string }>;
  recurringProperties: Array<{ id: string; label: string }>;
  recurringMissingSchema: boolean;
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
      <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/95 px-4 py-2 shadow-sm backdrop-blur">
        {[0, 150, 300, 450].map((delayMs) => (
          <span
            key={delayMs}
            className="h-3 w-3 animate-pulse rounded-full bg-sky-500 shadow-sm shadow-sky-200"
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
  initialFilters,
  customerId,
  customerName,
  customerPage,
  canManageRecurring,
  recurringTemplates,
  recurringProjects,
  recurringOrders,
  recurringProperties,
  recurringMissingSchema,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"overview" | "recurring">(
    canManageRecurring ? initialFilters.tab : "overview"
  );
  const [query, setQuery] = useState(initialFilters.q);
  const [from, setFrom] = useState(initialFilters.from);
  const [to, setTo] = useState(initialFilters.to);
  const [domain, setDomain] = useState(initialFilters.domain);
  const [sourceId, setSourceId] = useState(initialFilters.sourceId);
  const [type, setType] = useState(initialFilters.type);
  const [stage, setStage] = useState(initialFilters.stage);
  const [isFilterPending, startFilterTransition] = useTransition();
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

  const navigateToEntry = (entry: FinancialEntry) => {
    if (!entry.sourceHref) return;
    emitNavigationStart();
    router.push(entry.sourceHref);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <section className="flex justify-start">
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

      <Tabs
        dir="rtl"
        value={tab}
        onValueChange={(value) => {
          const nextTab = value === "recurring" && canManageRecurring ? "recurring" : "overview";
          setTab(nextTab);
          replaceSearch((params) => {
            setOrDelete(params, "tab", nextTab === "recurring" ? nextTab : null);
          });
        }}
      >
        <TabsList
          dir="rtl"
          className={
            canManageRecurring
              ? "grid h-auto w-full grid-cols-2"
              : "grid h-auto w-full grid-cols-1"
          }
        >
          <TabsTrigger value="overview">תזרים</TabsTrigger>
          {canManageRecurring ? <TabsTrigger value="recurring">הוצאות קבועות</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" dir="rtl" className="space-y-4 text-right">
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
                    replaceFilters({ q: nextValue, ledgerPage: 1, upcomingPage: 1 });
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
                  replaceFilters({ from: nextValue, ledgerPage: 1, upcomingPage: 1 });
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
                  replaceFilters({ to: nextValue, ledgerPage: 1, upcomingPage: 1 });
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

      {isFilterPending ? (
        <div className="sticky top-3 z-20">
          <FilterLoadingDots />
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
          <CardContent className="space-y-3">
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
              pagedUpcomingEntries.map((entry) => (
                <article key={entry.id} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-row-reverse">
                    <div className="space-y-2 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Badge variant={typeVariant(entry.type)}>{typeLabel(entry.type)}</Badge>
                        <Badge variant={stageVariant(entry.stage)}>{stageLabel(entry.stage)}</Badge>
                        <Badge variant="outline">{entry.domainName}</Badge>
                      </div>
                      <div className="font-medium">{entry.description}</div>
                      <div className="text-sm text-muted-foreground">
                        {entry.sourceHref ? (
                          <Link href={entry.sourceHref} className="transition-colors hover:text-foreground">
                            <span dir="auto">{sourceTypeTitle(entry.sourceKind)}: {entry.sourceLabel}</span>
                          </Link>
                        ) : (
                          <span dir="auto">
                            {sourceTypeTitle(entry.sourceKind)}: {entry.sourceLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1 text-right sm:text-left">
                      <div dir="ltr" className={cn("text-lg font-semibold tabular-nums", typeAmountClass(entry.type))}>
                        {entry.type === "inflow" ? "+" : "-"}
                        {formatCurrency(entry.amount)}
                      </div>
                      <div className="flex items-center justify-end gap-1 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        <span dir="ltr" className="tabular-nums">{formatShortDate(entry.flowDate)}</span>
                        <span>•</span>
                        <span>{formatRelativeDateLabel(entry.flowDate)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {entry.paymentMethodLabel ? <span>אמצעי: {entry.paymentMethodLabel}</span> : null}
                    {entry.dueDate ? <span>פירעון: {formatShortDate(entry.dueDate)}</span> : null}
                    {entry.recordedDate && entry.recordedDate !== entry.flowDate ? (
                      <span>נרשם בתאריך: {formatShortDate(entry.recordedDate)}</span>
                    ) : null}
                    {entry.reference ? <span>אסמכתא: {entry.reference}</span> : null}
                  </div>
                </article>
              ))
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
                {pagedLedgerEntries.map((entry) => (
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
                      </div>
                      <div dir="ltr" className={cn("font-semibold tabular-nums", typeAmountClass(entry.type))}>
                        {entry.type === "inflow" ? "+" : "-"}
                        {formatCurrency(entry.amount)}
                      </div>
                    </div>
                  </article>
                ))}
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
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLedgerEntries.map((entry) => (
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
                        </td>
                        <td dir="ltr" className={cn("px-3 py-3 text-left font-semibold tabular-nums", typeAmountClass(entry.type))}>
                          {entry.type === "inflow" ? "+" : "-"}
                          {formatCurrency(entry.amount)}
                        </td>
                      </tr>
                    ))}
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

      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 p-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 sm:flex-row-reverse">
            <Landmark className="h-4 w-4" />
            <span>התצוגה מסדרת תשלומים לפי תאריך כניסה/יציאה אמיתי לתזרים, לא רק לפי תאריך הרישום.</span>
          </div>
          <div className="flex items-center gap-2 sm:flex-row-reverse">
            <CalendarDays className="h-4 w-4" />
            <span>צ&apos;קים עם `due_date` עתידי והוצאות עתידיות נחשבים לצפי עד שהמועד שלהם מגיע.</span>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        {canManageRecurring ? (
          <TabsContent value="recurring">
            <RecurringExpensesManager
              templates={recurringTemplates}
              projects={recurringProjects}
              orders={recurringOrders}
              properties={recurringProperties}
              missingSchema={recurringMissingSchema}
            />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

export type { InitialFilters as FinancialPageInitialFilters };
