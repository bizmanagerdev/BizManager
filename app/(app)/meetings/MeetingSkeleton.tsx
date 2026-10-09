import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { buttonVariants } from "@/components/ui/button";
import {
  AddIcon,
  AllDoneIcon,
  ArrowRightIcon,
  ChecklistIcon,
  HistoryIcon,
  NoteIcon,
  SettingsIcon,
} from "@/components/ui/icons";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { cn } from "@/lib/utils";

// The weekly meeting before its data, from MeetingClient's own pieces: the
// heading line (its tally pill, "היסטוריה", "עריכת הסעיפים"), the week's
// numbers by name (two across on a phone, seven from xl), the prep and agenda
// sections with their item cards, and the summary section with its fields.
// `readOnly` is a past meeting (/meetings/[id]): no editing buttons, as the
// page shows it. Also the history list (MeetingsHistorySkeleton) and a past
// meeting's page (MeetingRecordSkeleton). For the meetings' loading screens.

const OUTLINE_SM = buttonVariants({ size: "sm", variant: "outline" });

// lib/meetings/stats.ts's metrics, in their order.
const METRICS = [
  "פרויקטים שנסגרו",
  "פרויקטים חדשים",
  "הזמנות שנסגרו",
  "נגבה השבוע",
  "צ׳קים שהופקדו",
  "משימות שהושלמו",
  "משימות באיחור",
];

// A meeting item (MeetingItemRow): the check box, the title, its buttons.
function ItemSkeleton({ index, prep = false, readOnly }: { index: boolean; prep?: boolean; readOnly: boolean }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {index ? <Skeleton className="h-5 w-5 shrink-0 self-center rounded-md" /> : null}
            <TextLineSkeleton className="text-sm font-semibold" barClassName="w-48" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {readOnly ? null : (
              <>
                <span className={OUTLINE_SM}>
                  <AddIcon />
                  משימה
                </span>
                <span className={OUTLINE_SM}>
                  <NoteIcon />
                  הערה
                </span>
              </>
            )}
            {prep ? (
              <div className="flex min-w-[11rem] items-center gap-1.5">
                <span className="shrink-0 text-xs text-muted-foreground">אחראי</span>
                <Skeleton className="h-9 flex-1 rounded-xl" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MeetingSkeleton({ readOnly = false }: { readOnly?: boolean }) {
  return (
    <div className="space-y-4" dir="rtl" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold">ישיבה שבועית</h1>
          <TextLineSkeleton className="text-xs" barClassName="w-56" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              getStatusColorClasses("info")
            )}
          >
            <ChecklistIcon className="h-4 w-4" />
            <Skeleton className="inline-block h-[0.75em] w-8 align-middle" />
          </span>
          <span className={OUTLINE_SM}>
            <HistoryIcon />
            היסטוריה
          </span>
          {readOnly ? null : (
            <span className={OUTLINE_SM}>
              <SettingsIcon />
              עריכת הסעיפים
            </span>
          )}
        </div>
      </div>

      {/* WeekNumbers */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">מספרי השבוע</h2>
          <TextLineSkeleton className="text-xs" barClassName="w-40" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {METRICS.map((label) => (
            <div key={label} className="rounded-2xl border border-border/70 bg-card/80 p-3 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground">{label}</div>
              <div className="mt-1 flex h-5 items-center">
                <Skeleton className="h-4 w-16" />
              </div>
              {/* The collection's card carries a caption (its target) under the figure. */}
              {label === "נגבה השבוע" ? (
                <TextLineSkeleton className="mt-1 text-[0.6875rem] leading-snug" barClassName="w-20" />
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <SectionCard
        icon={<ChecklistIcon className="h-4 w-4" />}
        title="הכנה לישיבה"
        aside={<Skeleton className="h-[1.625rem] w-32 rounded-full" />}
      >
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <ItemSkeleton key={i} index={false} prep readOnly={readOnly} />
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<ChecklistIcon className="h-4 w-4" />} title="סדר היום">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <ItemSkeleton key={i} index readOnly={readOnly} />
          ))}
          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border/70 p-3">
              <Skeleton className="h-9 min-w-[14rem] flex-1 rounded-xl" />
              <span className={buttonVariants({ size: "sm" })}>
                <AddIcon />
                הוספה
              </span>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard icon={<AllDoneIcon className="h-4 w-4" />} title="סיכום ההחלטות">
        <div className="grid gap-3 sm:grid-cols-2">
          {["יעד הגבייה לשבוע הבא", "תאריך הישיבה הבאה"].map((label) => (
            <div key={label} className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[110px] w-full rounded-xl" />
        {readOnly ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={buttonVariants()}>שמירת הסיכום</span>
            <span className={buttonVariants({ variant: "success" })}>
              <AllDoneIcon />
              סגירת הישיבה
            </span>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** A past meeting's page (/meetings/[id]): the way back, then the meeting, read-only. */
export function MeetingRecordSkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl">
      <span className={OUTLINE_SM}>
        <ArrowRightIcon />
        חזרה להיסטוריה
      </span>
      <MeetingSkeleton readOnly />
    </div>
  );
}

/** The meetings history (/meetings/history): its heading and the list of meetings. */
export function MeetingsHistorySkeleton() {
  return (
    <div className="space-y-4 text-right" dir="rtl" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">היסטוריית ישיבות</h1>
          <p className="text-xs text-muted-foreground">ישיבות שנרשמו במערכת, מהחדשה לישנה.</p>
        </div>
        <span className={OUTLINE_SM}>
          <ArrowRightIcon />
          לישיבה הנוכחית
        </span>
      </div>

      <SectionCard icon={<HistoryIcon className="h-4 w-4" />} title="ישיבות">
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card/60 px-3 py-3">
                <span className="min-w-0 flex-1">
                  <TextLineSkeleton className="text-sm font-semibold" barClassName="w-36" />
                  <TextLineSkeleton className="text-xs" barClassName="w-48" />
                </span>
                <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
