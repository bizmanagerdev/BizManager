"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CloseIcon, FilterIcon, SearchIcon } from "@/components/ui/icons";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/ui/filter-chip";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import type { AuditFeedItem, PresenceRosterUser } from "@/lib/audit";
import type { ActivityToday } from "@/lib/activity/today";
import ActivityFeedList from "./ActivityFeedList";
import PeopleStrip, { usePresenceRows } from "./PeopleStrip";
import TodayPulse from "./TodayPulse";
import WorkerDayCard from "./WorkerDayCard";

// The activity page (owner, 2026-10-11: "make it more exciting … the admin
// looks around and wants to see what's going on in the system … she's got a
// full picture"): the day at a glance (היום בעסק), who's working now, and the
// feed of what happened, in sentences, day by day, live. Tap a number to see
// those actions, tap a person to see their day, or search for anything.

const ROLE_LABELS: Record<string, string> = {
  admin: "מנהל",
  office: "משרד",
  worker: "עובד",
};

const SEARCH_DEBOUNCE_MS = 400;

type Props = {
  items: AuditFeedItem[];
  hasMore: boolean;
  error: string | null;
  tableOptions: readonly { value: string; label: string }[];
  actionOptions: readonly { value: string; label: string }[];
  workerOptions: readonly { value: string; label: string }[];
  currentTable: string;
  currentAction: string;
  currentWorker: string;
  currentQuery: string;
  // The selected person's changed_by values (users.id + login id), so the live
  // feed and the older pages keep to them too.
  actorFilterValues: string[];
  roster: PresenceRosterUser[];
  today: ActivityToday;
  todayKey: string;
  /** Changes whenever the filters or the search do — the feed starts over. */
  feedKey: string;
};

export default function ActivityClient({
  items,
  hasMore,
  error,
  tableOptions,
  actionOptions,
  workerOptions,
  currentTable,
  currentAction,
  currentWorker,
  currentQuery,
  actorFilterValues,
  roster,
  today,
  todayKey,
  feedKey,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const presenceRows = usePresenceRows(roster);

  const [query, setQuery] = useState(currentQuery);
  const [usersOnly, setUsersOnly] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [live, setLive] = useState(false);

  useSetPageTitle("פעילות", `${today.actions.toLocaleString("he-IL")} פעולות היום`);

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      next.delete("page");
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams]
  );

  // Search as you type, once the typing pauses.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === currentQuery) return;
    const id = setTimeout(() => updateParams({ q: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, currentQuery, updateParams]);

  // The numbers and the people stay current: every 15 s (a safety net if the
  // live socket is ever blocked), and soon after new actions arrive.
  useEffect(() => {
    const id = setInterval(() => startTransition(() => router.refresh()), 15_000);
    return () => clearInterval(id);
  }, [router]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onArrivals = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      startTransition(() => router.refresh());
    }, 2500);
  }, [router]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  function resetFilters() {
    setUsersOnly(false);
    setQuery("");
    updateParams({ table: "", action: "", worker: "", q: "" });
  }

  const activeFilterCount =
    [currentTable, currentAction, currentWorker].filter(Boolean).length + (usersOnly ? 1 : 0);

  const selectedPerson = currentWorker ? presenceRows.find((r) => r.id === currentWorker) ?? null : null;
  const selectedDay = currentWorker ? today.people.find((p) => p.userId === currentWorker) ?? null : null;
  const selectedFallbackName = workerOptions.find((o) => o.value === currentWorker)?.label ?? "";

  // The phone's strip is narrow: a short placeholder, as on the other pages.
  const searchField = (className: string, placeholder: string) => (
    <div className={`relative min-w-0 ${className}`}>
      <SearchIcon className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label="חיפוש בפעילות"
        className="h-10 w-full rounded-xl ps-9 pe-9"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label="ניקוי החיפוש"
          className="absolute end-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );

  // One dropdown per filter: compact in the wide row, full width in the phone panel.
  const select = (
    label: string,
    value: string,
    options: readonly { value: string; label: string }[],
    onChange: (value: string) => void,
    dense: boolean
  ) => (
    <NativeSelect
      dense={dense}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={dense ? "max-w-[10rem] text-xs" : "mt-1"}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </NativeSelect>
  );
  const tableSelect = (dense: boolean) => select("סוג", currentTable, tableOptions, (table) => updateParams({ table }), dense);
  const actionSelect = (dense: boolean) => select("פעולה", currentAction, actionOptions, (action) => updateParams({ action }), dense);
  const workerSelect = (dense: boolean) => select("משתמש", currentWorker, workerOptions, (worker) => updateParams({ worker }), dense);

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Phone: the search and the filter button in the dark header strip. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          {searchField("flex-1", "חיפוש...")}
          <Button
            type="button"
            aria-label={mobileFiltersOpen ? "הסתרת סינון" : "סינון"}
            aria-expanded={mobileFiltersOpen}
            aria-controls="activity-mobile-filters"
            className="relative h-10 w-10 shrink-0 rounded-xl p-0"
            onClick={() => setMobileFiltersOpen((open) => !open)}
          >
            <FilterIcon className="h-4 w-4" />
            {activeFilterCount > 0 ? (
              <span className="absolute -top-1 -start-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-[0.588rem] font-semibold text-secondary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </div>
      </PageHeaderToolbar>

      {/* Phone filters, under the header when opened. */}
      <div
        id="activity-mobile-filters"
        className={`${mobileFiltersOpen ? "grid" : "hidden"} gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:hidden`}
      >
        <label className="min-w-0 text-sm text-muted-foreground">
          סוג
          {tableSelect(false)}
        </label>
        <label className="min-w-0 text-sm text-muted-foreground">
          פעולה
          {actionSelect(false)}
        </label>
        <label className="min-w-0 text-sm text-muted-foreground">
          משתמש
          {workerSelect(false)}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            checked={usersOnly}
            onChange={(e) => setUsersOnly(e.target.checked)}
            className="h-4 w-4 accent-secondary"
          />
          בלי העדכונים האוטומטיים
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" className="h-11" onClick={resetFilters}>
            איפוס
          </Button>
          <Button type="button" className="h-11" onClick={() => setMobileFiltersOpen(false)}>
            הצגת התוצאות
          </Button>
        </div>
      </div>

      <TodayPulse
        today={today}
        live={live}
        activeTable={currentTable}
        onPickTable={(table) => updateParams({ table })}
      />

      <PeopleStrip
        rows={presenceRows}
        people={today.people}
        selected={currentWorker}
        onSelect={(worker) => updateParams({ worker })}
      />

      {currentWorker ? (
        <WorkerDayCard
          person={
            selectedPerson ?? {
              id: currentWorker,
              name: selectedFallbackName || "משתמש",
              role: null,
              avatarColor: null,
              lastSeenAt: null,
              activeNow: false,
              sessionStart: null,
            }
          }
          day={selectedDay}
          roleLabel={selectedPerson?.role ? ROLE_LABELS[selectedPerson.role] ?? selectedPerson.role : null}
          onClose={() => updateParams({ worker: "" })}
        />
      ) : null}

      {/* Wide screens: the search and the filters in one row above the feed. */}
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {searchField("w-full max-w-xs", "חיפוש: שם, סכום, צ׳ק…")}
        {tableSelect(true)}
        {actionSelect(true)}
        {workerSelect(true)}
        <FilterChip active={usersOnly} label="בלי העדכונים האוטומטיים" onClick={() => setUsersOnly((v) => !v)} />
        {activeFilterCount > 0 || currentQuery ? (
          <button type="button" onClick={resetFilters} className="text-xs text-secondary hover:underline">
            איפוס הכול
          </button>
        ) : null}
      </div>

      {currentQuery ? (
        <p className="text-sm text-muted-foreground">
          {"תוצאות החיפוש "}
          <bdi className="font-semibold text-foreground">{`"${currentQuery}"`}</bdi>
        </p>
      ) : null}

      <ActivityFeedList
        key={feedKey}
        initialItems={items}
        initialHasMore={hasMore}
        error={error}
        table={currentTable}
        action={currentAction}
        actorFilterValues={actorFilterValues}
        query={currentQuery}
        usersOnly={usersOnly}
        todayKey={todayKey}
        todayCount={today.actions}
        onLiveChange={setLive}
        onArrivals={onArrivals}
        dimmed={isPending}
      />
    </div>
  );
}
