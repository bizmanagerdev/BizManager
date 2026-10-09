import { TextLineSkeleton } from "@/components/layout/loading-skeletons";
import { buttonVariants } from "@/components/ui/button";
import { ChevronDownIcon, FilterIcon, GridIcon, ListIcon, TagIcon, UploadIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The documents archive before its data, from DocumentsArchiveClient's own
// pieces and container query (@[40em]): the sticky search row (the heading,
// "ניהול קטגוריות" and "העלאת קבצים" when wide; "סינון" and the view switch
// on a phone), the facet / grouping / sort row and the count, then the groups'
// trays of document cards (two across on a phone, 11rem cards when wide) — in
// the default card view, grouped by שיוך, newest first. Shown while the page
// streams (loading.tsx) and while the client's code loads (the dynamic()
// fallback).

// A facet / grouping / sort trigger (outline sm, h-10) with its words.
function MenuTrigger({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        buttonVariants({ size: "sm", variant: "outline" }),
        "h-10 shrink-0 justify-between gap-2",
        muted ? "text-muted-foreground" : "font-medium"
      )}
    >
      <span>{label}</span>
      <ChevronDownIcon className="h-4 w-4 shrink-0" />
    </span>
  );
}

// One document card (DocumentTile): the thumbnail, the title, the date line.
function TileSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-lg border border-[rgb(var(--secondary-9))] bg-background", className)}>
      <Skeleton className="h-24 rounded-none @[40em]:h-33" />
      <div className="flex flex-1 flex-col gap-0.5 p-2">
        <TextLineSkeleton className="text-sm font-medium leading-tight" barClassName="w-4/5" />
        <div className="mt-auto flex items-center gap-1 pt-1 text-xs">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="ms-auto h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// A group's tray: its name and count, two rows of cards — 2×2 on a phone,
// up to 8 when the cards are 11rem.
function TraySkeleton() {
  return (
    <section className="mt-4 rounded-xl bg-[rgb(var(--tray))] p-3 first:mt-0">
      <div className="relative">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <TextLineSkeleton className="text-[0.8rem] font-medium leading-snug @[40em]:text-base" barClassName="w-28" />
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="space-y-3 pt-1">
          <div className="grid gap-2 [grid-template-columns:repeat(2,minmax(0,1fr))] @[40em]:[grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
            {Array.from({ length: 8 }).map((_, i) => (
              <TileSkeleton key={i} className={i >= 4 ? "hidden @[40em]:flex" : undefined} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function DocumentsSkeleton() {
  return (
    <div className="@container relative space-y-2 pb-28 md:-mt-2 md:pb-0 lg:-mt-4" aria-busy="true">
      {/* Row 1 — heading, search, and the actions. */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-3 gap-y-2 bg-background/95 px-1 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <h1 className="hidden text-lg font-semibold @[40em]:block">מסמכים</h1>
        <div className="relative min-w-[10rem] max-w-[32rem] flex-1 basis-40">
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 @[40em]:hidden">
          <span className={cn(buttonVariants({ variant: "outline" }), "h-10 gap-1.5")}>
            <FilterIcon className="h-4 w-4" />
            סינון
          </span>
          <span className={cn(buttonVariants({ size: "icon" }), "h-10 w-10")}>
            <ListIcon className="h-4 w-4" />
          </span>
        </div>
        <div className="ms-auto hidden items-center gap-3 @[40em]:flex">
          <span className={cn(buttonVariants({ variant: "outline" }), "h-10")}>
            <TagIcon className="h-4 w-4" />
            ניהול קטגוריות
          </span>
          <span className={cn(buttonVariants(), "h-10")}>
            <UploadIcon className="h-4 w-4" />
            העלאת קבצים
          </span>
        </div>
      </div>

      {/* Row 2 — the facets, grouping, sort and view (when wide), and the count. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-1">
        <div className="order-2 ms-auto hidden flex-wrap items-center gap-1.5 @[40em]:flex">
          <MenuTrigger label="שיוך" />
          <MenuTrigger label="תוקף" />
          <MenuTrigger label="סוג" />
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
          <MenuTrigger label="קיבוץ: לפי שיוך" muted />
          <MenuTrigger label="מיון: החדשים" muted />
          <span className={cn(buttonVariants({ size: "icon" }), "h-10 w-10")}>
            <GridIcon className="h-4 w-4" />
          </span>
          <span className={cn(buttonVariants({ size: "icon", variant: "outline" }), "h-10 w-10")}>
            <ListIcon className="h-4 w-4" />
          </span>
        </div>
        <div className="order-1 flex flex-wrap items-center gap-2 text-xs">
          <TextLineSkeleton barClassName="w-20" />
        </div>
      </div>

      {/* The page's column-measuring grid — no height, but a step of the stack. */}
      <div aria-hidden className="grid h-0" />

      <TraySkeleton />
      <TraySkeleton />
    </div>
  );
}
