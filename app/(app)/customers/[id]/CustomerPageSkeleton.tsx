import type { ReactNode } from "react";
import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import {
  BuildingIcon,
  ChatIcon,
  ChevronLeftIcon,
  DocumentIcon,
  HistoryIcon,
  MailIcon,
  NoteIcon,
  OrderIcon,
  PaymentIcon,
  PhoneCallIcon,
  PhoneIcon,
  ProjectIcon,
  StoreIcon,
  TaskIcon,
  UserIcon,
  WazeIcon,
} from "@/components/ui/icons";
import { SectionCard } from "@/components/ui/section-card";
import { Skeleton } from "@/components/ui/skeleton";

// A customer's page before its data: the page's own frame (customers/[id]/
// page.tsx) — the breadcrumb with the name, the summary line, then the
// activity column (orders, projects, rented properties, tasks, calls, payment
// promises, payments, history) and beside it — under it on a phone — the
// reference column (the customer's details, contacts, branches, documents,
// notes, Morning). Its sections are the page's own (SectionCard and the slim
// "nothing yet" row) with their names; blanks where the figures will be. The
// debt bar and the balance card only exist for some customers, so they aren't
// guessed at. The plain loading screen, and the customers list's on the way
// in from outside /customers (CustomersLoadingBody).

/** The page's slim row for a section with nothing in it yet (EmptySectionRow). */
function SlimRow({ icon, title, action = false }: { icon: ReactNode; title: string; action?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/50 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-semibold">{title}</span>
        <Skeleton className="h-3 w-28" />
      </div>
      {action ? <Skeleton className="h-8 w-16 shrink-0 rounded-xl" /> : null}
    </div>
  );
}

/** A section's count pill and "+" button (CountPill + the add button). */
function Aside({ button = "w-[5.5rem]" }: { button?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Skeleton className="h-[1.625rem] w-16 rounded-full" />
      <Skeleton className={`h-9 rounded-xl ${button}`} />
    </div>
  );
}

/** A list row (date / name + status badge, the reference line; the amount and what's left). */
function ListRows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-border/60">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-[1.625rem] w-16 rounded-full" />
            </div>
            <TextLineSkeleton className="mt-0.5 text-xs" barClassName="w-32" />
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <TextLineSkeleton barClassName="w-16" />
            <TextLineSkeleton className="text-xs" barClassName="w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

const CONTACT_ICONS = [PhoneIcon, ChatIcon, MailIcon, WazeIcon];

export default function CustomerPageSkeleton({ routeLoading = false }: { routeLoading?: boolean }) {
  return (
    <div className="space-y-3" data-route-loading={routeLoading ? "true" : undefined} aria-busy="true">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="ניווט">
            <span>לקוחות</span>
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            <TextLineSkeleton className="text-lg font-bold" barClassName="w-40" />
          </nav>
          <TextLineSkeleton className="text-xs" barClassName="w-64 max-w-full" />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-3 lg:items-start" aria-hidden>
        {/* The activity column melts into the phone's one stack, as on the page. */}
        <div className="contents lg:block lg:col-span-2 lg:space-y-3">
          <SectionCard icon={<OrderIcon className="h-4 w-4" />} title="הזמנות" aside={<Aside />}>
            <ListRows count={3} />
          </SectionCard>
          <SectionCard icon={<ProjectIcon className="h-4 w-4" />} title="פרויקטים" aside={<Aside button="w-20" />}>
            <ListRows count={1} />
          </SectionCard>
          <SlimRow icon={<BuildingIcon className="h-4 w-4" />} title="נכסים בשכירות" />
          <SlimRow icon={<TaskIcon className="h-4 w-4 shrink-0" />} title="משימות" action />
          <SectionCard icon={<PhoneCallIcon className="h-4 w-4" />} title="שיחות ותזכורות">
            <div className="space-y-2">
              <Skeleton className="h-11 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          </SectionCard>
          <SectionCard icon={<PaymentIcon className="h-4 w-4" />} title="הבטחות תשלום">
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto]">
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl" />
                <Skeleton className="h-11 rounded-xl sm:w-20" />
              </div>
              <TextLineSkeleton className="text-sm" barClassName="w-44" />
            </div>
          </SectionCard>
          <SectionCard
            icon={<PaymentIcon className="h-4 w-4" />}
            title="תשלומים אחרונים"
            aside={<Skeleton className="h-[1.625rem] w-20 rounded-full" />}
          >
            <ListRows count={2} />
          </SectionCard>
          <SectionCard className="order-last lg:order-none" icon={<HistoryIcon className="h-4 w-4" />} title="היסטוריית פעילות">
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="space-y-3">
          <div className="space-y-2 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <UserIcon className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">פרטי לקוח</h2>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
            </div>
            <TextLineSkeleton className="text-sm font-semibold" barClassName="w-36" />
            <div className="space-y-1.5 text-xs">
              {CONTACT_ICONS.map((Icon, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <TextLineSkeleton barClassName={i === 3 ? "w-40" : "w-24"} />
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 rounded-xl border border-border/70 bg-background/70 p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">הוראות הגעה</span>
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
              <TextLineSkeleton barClassName="w-32" />
            </div>
          </div>
          <SlimRow icon={<UserIcon className="h-4 w-4" />} title="אנשי קשר" action />
          <SlimRow icon={<StoreIcon className="h-4 w-4" />} title="סניפים" action />
          <SlimRow icon={<DocumentIcon className="h-4 w-4" />} title="מסמכים" action />
          <SectionCard icon={<NoteIcon className="h-4 w-4" />} title="הערות">
            <div className="flex items-start justify-between gap-2">
              <TextLineSkeleton className="text-sm" barClassName="w-32" />
              <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            </div>
          </SectionCard>
          <div className="space-y-3 rounded-md border bg-background p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">Morning</div>
              <Skeleton className="h-[1.625rem] w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-[4.625rem] animate-pulse rounded-2xl border border-border/70 bg-muted/40" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
