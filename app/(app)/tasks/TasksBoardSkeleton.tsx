import { Skeleton } from "@/components/ui/skeleton";

// Mirrors TasksPageClient's board (BOARD_BLEED, the board's h-[…] and the
// lists' classes there), so the placeholder IS the board's shape (owner,
// 2026-10-09: the tasks page loaded "something that's not related" — tab pills
// and light cards on a white page): the navy full-bleed board, on a phone one
// 90vw list with the next one peeking, four lists side by side from lg; each
// list a header, cards and the "add a card" foot. Shown while the page streams
// (loading.tsx) and while the device version works the board out
// (LocalTasksBoard).
const BOARD_BLEED = 48;
const CARDS_PER_LIST = [4, 2, 3, 1];

export default function TasksBoardSkeleton() {
  return (
    <div className="dark-topbar-page flow-root -mb-24 -mt-4 overflow-clip [overflow-clip-margin:4rem] md:-mb-6 md:-mt-6 lg:-mb-8 lg:-mt-8">
      <div
        style={{ paddingBottom: BOARD_BLEED, marginBottom: -BOARD_BLEED }}
        className="relative -mx-3 flex h-[calc(100dvh-119px-3.25rem-env(safe-area-inset-bottom)+48px)] min-h-[20rem] flex-col overflow-hidden bg-primary md:-mx-6 md:h-[calc(100dvh-60px+48px)] lg:-mx-8"
      >
        <div className="flex min-h-0 flex-1 gap-2 overflow-hidden px-[5vw] py-2 lg:grid lg:grid-cols-4 lg:gap-3 lg:px-3">
          {CARDS_PER_LIST.map((cards, list) => (
            <div key={list} className="flex h-full min-h-0 w-[90vw] shrink-0 flex-col rounded-xl bg-muted lg:w-auto lg:shrink">
              <div className="flex shrink-0 items-center justify-between gap-2 rounded-t-xl border-b border-border/60 px-2.5 py-2">
                <Skeleton className="h-4 w-20 bg-background/70" />
                <Skeleton className="h-4 w-4 bg-background/70" />
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 px-1.5 py-1.5">
                {Array.from({ length: cards }).map((_, card) => (
                  <div key={card} className="rounded-lg bg-background p-2.5 shadow-sm">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="mt-2 h-3 w-1/3" />
                  </div>
                ))}
              </div>
              <div className="shrink-0 border-t border-border/60 px-3 py-2.5">
                <Skeleton className="h-4 w-24 bg-background/70" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
