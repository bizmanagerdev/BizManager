import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";

// The accounts page before its data, from BankClient's own classes: the
// account strip (w-36 tiles, the w-48 total at its end — the tiles stretch to
// its height, as on the page), then the open account's register — its sticky
// name/month header, this month's rows under its month header and the older
// months folded, the opening-balance footnote — and the paragraph under it.
// Shown while the page streams (loading.tsx) and while BankClient's code loads
// (the page's dynamic() fallback). The desktop quick-entry bar is fixed to the
// window, so it moves nothing when it arrives.

// A month's header (bg-muted, so its blanks are lighter): the chevron, the
// month, and at the far end where the account stood when it ended.
function MonthHeader() {
  return (
    <div className="flex w-full items-center gap-2 bg-muted px-3 py-2 text-xs">
      <Skeleton className="h-4 w-4 shrink-0 bg-background/70" />
      <TextLineSkeleton barClassName="w-10 bg-background/70" />
      <span className="ms-auto">
        <TextLineSkeleton barClassName="w-16 bg-background/70" />
      </span>
    </div>
  );
}

export default function BankSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-36 shrink-0">
            <div className="flex h-full w-full flex-col items-stretch gap-1.5 rounded-lg border bg-background p-3">
              <span className="flex w-full items-start justify-between gap-2 text-sm">
                <TextLineSkeleton barClassName="w-16" />
                <Skeleton className="h-3.5 w-8 rounded-full" />
              </span>
              <span className="flex flex-1 items-center justify-center text-2xl">
                <Skeleton className="h-6 w-20" />
              </span>
            </div>
          </div>
        ))}
        <div className="flex h-full w-48 shrink-0 flex-col items-stretch justify-center gap-1.5 rounded-lg border border-secondary/40 bg-secondary/5 p-3 text-right">
          <span className="text-sm font-medium text-secondary">סך נזילות</span>
          <TextLineSkeleton className="text-xl" barClassName="w-24" />
          <span className="flex flex-col gap-0.5 text-xs">
            <span className="text-success">
              חיובי <Skeleton className="inline-block h-[0.75em] w-14 align-middle" />
            </span>
            <span className="text-destructive">
              שלילי <Skeleton className="inline-block h-[0.75em] w-14 align-middle" />
            </span>
          </span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-hidden">
            <div className="space-y-1 border-b bg-muted px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TextLineSkeleton barClassName="w-28 bg-background/70" />
                <Skeleton className="h-9 w-28 rounded-lg bg-background/70" />
              </div>
            </div>
            <div className="divide-y divide-border/60">
              <MonthHeader />
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <TextLineSkeleton barClassName="w-36" />
                    <TextLineSkeleton className="text-xs" barClassName="w-24" />
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <TextLineSkeleton barClassName="w-14" />
                    <TextLineSkeleton className="text-xs" barClassName="w-12" />
                  </div>
                </div>
              ))}
              <MonthHeader />
              <MonthHeader />
              <MonthHeader />
            </div>
            <TextLineSkeleton className="border-t px-3 py-1.5 text-xs" barClassName="w-44" />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        היתרה מחושבת מיתרת הפתיחה ועוד התקבולים, הלוואות שהתקבלו והחזרים שנגבו, פחות ההוצאות,
        תשלומי השכר, הלוואות שניתנו והחזרי הלוואות ששויכו לחשבון. מוצגות רק תנועות שקרו בפועל —
        צ׳קים שטרם נפרעו והוצאות שטרם שולמו נמצאים בצפי תזרים. העברה בין חשבונות מופיעה
        בשני החשבונות — יציאה מאחד וכניסה לשני — ואינה נרשמת כהכנסה או כהוצאה.
      </p>
    </div>
  );
}
