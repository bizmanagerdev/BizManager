import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BalanceIcon,
  CalculatorIcon,
  ChartIcon,
  ClockIcon,
  CoinsIcon,
  FilterIcon,
  HistoryIcon,
  LedgerIcon,
  ScheduleIcon,
  TrendChartIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { TextLineSkeleton, UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { ButtonSkeleton } from "./ButtonSkeleton";

// The cash-flow pages before their data, from FinancialPageClient's own
// classes. The flow view (/financial): the tab bar (היסטוריה open, as the page
// opens) with the add buttons, the month and the filter button beside it, then
// the history card — its search, cards on a phone and the table from md, held
// at the table's 70vh. The reports view (/financial/reports):
// the global filter band, the seven report tabs and the overview (סקירה)
// tab's two cards. Shown while the page streams (loading.tsx) and while the
// page's code loads (CashFlowPageContent's dynamic() fallbacks).

const HISTORY_COLUMNS = ["תאריך תזרים", "סטטוס", "סוג", "תחום / מקור", "פירוט", "סכום", "פעולות"];

const FLOW_TABS = [
  <>
    <HistoryIcon className="h-4 w-4 shrink-0" />
    היסטוריה
  </>,
  <>
    <LedgerIcon className="h-4 w-4 shrink-0" />
    יומן מלא
  </>,
  <>
    <ClockIcon className="h-4 w-4 shrink-0" />
    תזרים עתידי
  </>,
];

const REPORT_TABS = [
  <>
    <CalculatorIcon className="h-4 w-4 shrink-0" />
    סקירה
  </>,
  <>
    <ChartIcon className="h-4 w-4 shrink-0" />
    לפי תחום
  </>,
  <>
    <TrendChartIcon className="h-4 w-4 shrink-0" />
    חודשי
  </>,
  <>
    <CoinsIcon className="h-4 w-4 shrink-0" />
    מכירות
  </>,
  <>
    <BalanceIcon className="h-4 w-4 shrink-0" />
    מאזן
  </>,
  <>
    <ScheduleIcon className="h-4 w-4 shrink-0" />
    תחזית
  </>,
  <>
    <UsersIcon className="h-4 w-4 shrink-0" />
    לקוחות
  </>,
];

/** The flow view (/financial): tabs + actions, then the history card. */
export function CashFlowSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <UnderlineTabsSkeleton labels={FLOW_TABS} counts={[false, false, true]} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ButtonSkeleton label="הוספת הכנסה" />
          <ButtonSkeleton label="הוספת הוצאה" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-36 rounded-lg" />
            <ButtonSkeleton label="סינון מתקדם" icon />
          </div>
        </div>
      </div>

      {/* TabsContent's own mt-4 (it meets the row's gap, as on the page). */}
      <div className="mt-4">
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
                <Skeleton className="h-9 w-full rounded-xl" />
              </div>
            </div>
            <div className="grid gap-3 md:hidden">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border p-4 text-right">
                  <div className="flex items-start justify-between gap-3 sm:flex-row-reverse">
                    <div className="space-y-1">
                      <TextLineSkeleton className="text-sm" barClassName="w-16" />
                      <TextLineSkeleton className="text-xs" barClassName="w-12" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Skeleton className="h-6 w-14 rounded-full" />
                      <Skeleton className="h-6 w-12 rounded-full" />
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <TextLineSkeleton barClassName="w-44" />
                    <TextLineSkeleton barClassName="w-24" />
                    <TextLineSkeleton barClassName="w-32" />
                    <TextLineSkeleton barClassName="w-20" />
                  </div>
                </div>
              ))}
            </div>
            {/* The table scrolls inside 70vh; a ledger fills it. */}
            <div className="hidden max-h-[70vh] overflow-hidden md:block">
              <table className="w-full text-right text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-right text-muted-foreground">
                  <tr className="border-b">
                    {HISTORY_COLUMNS.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 14 }).map((_, row) => (
                    <tr key={row} className="h-[3.25rem] border-b last:border-b-0">
                      {HISTORY_COLUMNS.map((column, cell) => (
                        <td key={column} className="px-3 py-2 align-top">
                          <Skeleton className={cell === 4 ? "h-4 w-4/5" : "h-4 w-3/5"} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TextLineSkeleton className="pt-3 text-center text-xs" barClassName="w-40" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// One line of the waterfall: a domain and its figure.
function WaterfallLine({ label = "w-28" }: { label?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <TextLineSkeleton barClassName={label} />
      <TextLineSkeleton barClassName="w-16" />
    </div>
  );
}

function RunningRow({ label }: { label: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3 border-t border-dashed py-2">
      <span className="text-sm font-semibold">{label}</span>
      <TextLineSkeleton className="text-base" barClassName="w-20" />
    </div>
  );
}

/** The reports view (/financial/reports): filter band, report tabs, the overview tab. */
export function ReportsSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="border-y border-border/60">
        <div className="flex flex-wrap items-center gap-2 bg-muted/50 px-3 py-2.5">
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
            <FilterIcon className="h-4 w-4 text-muted-foreground" />
            מסננים גלובליים
          </span>
          <span className="mx-1 hidden h-5 w-px self-center bg-border sm:block" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-36 rounded-lg" />
            {/* The basis switch opens on הרווחתי; כולל פתוחים only exists on the cash basis. */}
            <div className="flex h-9 overflow-hidden rounded-lg border text-sm">
              <span className="flex items-center bg-background px-3">נכנס בפועל</span>
              <span className="flex items-center bg-primary px-3 text-primary-foreground">הרווחתי</span>
            </div>
            {["כולל בית וצדקה", "כולל ניהול נכסים"].map((label) => (
              <span key={label} className="flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm">
                <span className="h-4 w-4 rounded-sm border border-input" />
                <span>{label}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-primary/[0.06] px-3 py-1.5 text-xs">
          <span className="text-muted-foreground">מציג:</span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <Skeleton className="my-0.5 h-3 w-20" />
          </span>
          <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">שיטה: הרווחתי</span>
          <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 font-medium">
            סופרים מ<Skeleton className="my-0.5 h-3 w-14" />
          </span>
        </div>
      </div>
      <div className="min-w-0 pt-2">
        <UnderlineTabsSkeleton labels={REPORT_TABS} />
      </div>

      {/* The overview tab (BottomLinePanel), under TabsContent's mt-4. */}
      <div className="mt-4 space-y-4">
        <p className="text-xs text-muted-foreground">לפי מה שהרווחתי בתקופה — גם אם עדיין לא נגבה</p>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-right">מה שנשאר בסוף (לפי מה שהרווחתי)</CardDescription>
            <CardTitle className="text-right text-3xl font-bold">
              <Skeleton className="inline-block h-[0.8em] w-40 align-middle" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TextLineSkeleton className="text-xs" barClassName="w-72 max-w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-right">שלב אחר שלב — כמה נשאר בכל שלב</CardTitle>
            <CardDescription className="text-right">לחצו על שורה כדי לראות בדיוק על מה — מה נכנס ומה יצא.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            <div className="pb-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">מה שהרווחתי מכל העסקים</div>
              <WaterfallLine />
              <WaterfallLine label="w-24" />
              <WaterfallLine label="w-32" />
              <WaterfallLine label="w-20" />
              <RunningRow label="סה״כ שהרווחתי" />
            </div>
            <div className="py-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">פחות תקורה כללית (שוטף)</div>
              <WaterfallLine label="w-24" />
              <WaterfallLine label="w-20" />
              <RunningRow label="נשאר אחרי שוטף" />
            </div>
            <div className="mt-1 flex items-center justify-between gap-3 border-t-2 pt-3">
              <span className="text-base font-bold">מה שנשאר בסוף</span>
              <TextLineSkeleton className="text-xl" barClassName="w-24" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
