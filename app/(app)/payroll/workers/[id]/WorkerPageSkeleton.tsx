import { UnderlineTabsSkeleton } from "@/components/layout/loading-skeletons";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarCheckIcon, CashIcon, CoinsIcon, PrintIcon } from "@/components/ui/icons";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Skeleton } from "@/components/ui/skeleton";
import { MiniStat } from "@/app/(app)/payroll/SalaryCenterUi";

// A worker's page before its data — SalaryCenterClient's worker-detail frame,
// from its own classes: the details chips with the page's buttons, the four
// balance figures, the month / year filters, the underline tabs (an admin's:
// כספים open) and the money card, its history the dots the page itself shows
// while the salary data loads. Shown while the page streams (loading.tsx, and
// payroll's own loading screen on the way here — PayrollLoadingBody) and while
// the client's code loads (page.tsx's dynamic() fallback).

const VALUE = <Skeleton className="inline-block h-4 w-20 align-middle" />;

const CHIPS = ["שם מלא", "אימייל", "טלפון", "תפקיד", "סטטוס", "סוג עובד"];

/** A labelled select (SalaryCenterUi's Field): the label's line, then the h-11 box. */
function FilterSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-1 text-right text-sm">
      <div className="font-medium">{label}</div>
      <Skeleton className="h-11 w-full rounded-xl" />
    </div>
  );
}

export default function WorkerPageSkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" aria-busy="true">
      <section className="text-right" dir="rtl">
        <div className="mt-2 space-y-5">
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  {CHIPS.map((label) => (
                    <div key={label} className="flex items-center gap-2 rounded-lg border bg-muted/10 px-3 py-1.5">
                      <span className="text-muted-foreground">{label}</span>
                      <Skeleton className="h-3.5 w-16" />
                    </div>
                  ))}
                </div>
                {/* הוסף משמרת, עדכון פרטי עובד, the delete icon. */}
                <div className="flex flex-wrap justify-end gap-2">
                  <Skeleton className="h-11 w-28 rounded-xl" />
                  <Skeleton className="h-11 w-36 rounded-xl" />
                  <Skeleton className="h-11 w-11 rounded-xl" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <MiniStat label="סה״כ נצבר" value={VALUE} />
                <MiniStat label="שולם כולל" value={VALUE} />
                <MiniStat label="יתרה כוללת" value={VALUE} />
                <MiniStat label="סטטוס" value={VALUE} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FilterSkeleton label="חודש" />
                <FilterSkeleton label="שנה" />
              </div>
            </CardContent>
          </Card>

          <div>
            <UnderlineTabsSkeleton
              className="sm:justify-center"
              labels={[
                <><CoinsIcon className="h-4 w-4" />כספים</>,
                <><CalendarCheckIcon className="h-4 w-4" />נוכחות</>,
                <><CashIcon className="h-4 w-4" />שכר</>,
                <><CoinsIcon className="h-4 w-4" />בונוסים וחופשות</>,
                <><PrintIcon className="h-4 w-4" />הדפסה</>,
              ]}
            />
            <div className="mt-4 space-y-5">
              <Card>
                <CardContent className="space-y-4 py-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-lg font-semibold">כספים</div>
                    <Skeleton className="h-11 w-28 rounded-xl" />
                  </div>
                  <div className="space-y-2">
                    <div className="font-medium">היסטוריית תשלומים</div>
                    <div className="flex justify-center py-4">
                      <LoadingDots />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
