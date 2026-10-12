"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import { cursorOf, getAuditFeed, groupAuditFeedItems, type AuditFeedItem } from "@/lib/audit";
import { searchActivity } from "@/lib/activity/search";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import ActivityFeed, { batchSystemGroups } from "./ActivityFeed";

// The feed's rows and how they move: older pages as the bottom comes into
// view, new actions within a minute (fetched, not pushed — see the effect
// below). A new action slides in at the top when
// the reader is there; further down, it waits behind a "N חדשות" button, so
// the list never jumps under someone's finger.

const NEAR_TOP_PX = 240;
const FRESH_MS = 3000;
/** How often an open feed asks for actions newer than its top row. */
const FEED_POLL_MS = 60_000;

/** Two lists as one, each row once, newest first. */
function merge(a: AuditFeedItem[], b: AuditFeedItem[]): AuditFeedItem[] {
  const byId = new Map<string, AuditFeedItem>();
  for (const item of [...a, ...b]) if (!byId.has(item.id)) byId.set(item.id, item);
  return Array.from(byId.values()).sort(newestFirst);
}

function newestFirst(a: AuditFeedItem, b: AuditFeedItem) {
  const at = a.createdAt ?? "";
  const bt = b.createdAt ?? "";
  if (at !== bt) return at < bt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export default function ActivityFeedList({
  initialItems,
  initialHasMore,
  error,
  table,
  action,
  actorFilterValues,
  query,
  usersOnly,
  todayKey,
  todayCount,
  onLiveChange,
  onArrivals,
  dimmed,
}: {
  initialItems: AuditFeedItem[];
  initialHasMore: boolean;
  error: string | null;
  table: string;
  action: string;
  actorFilterValues: string[];
  /** A search, when there is one — then the feed is its results, not the live log. */
  query: string;
  usersOnly: boolean;
  todayKey: string;
  todayCount: number;
  onLiveChange: (live: boolean) => void;
  /** New actions arrived — the page's numbers above are worth refreshing. */
  onArrivals: () => void;
  dimmed: boolean;
}) {
  const [items, setItems] = useState<AuditFeedItem[]>(initialItems);
  const [pending, setPending] = useState<AuditFeedItem[]>([]);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // The latest lists, for the callbacks the socket and the observer hold on to.
  const itemsRef = useRef(items);
  const pendingRef = useRef(pending);
  useEffect(() => {
    itemsRef.current = items;
    pendingRef.current = pending;
  }, [items, pending]);
  const actorKey = actorFilterValues.join(",");
  const searching = query.trim().length > 0;

  const flash = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFreshIds((prev) => new Set([...prev, ...ids]));
    setTimeout(() => {
      setFreshIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, FRESH_MS);
  }, []);

  // New rows: in at the top when the reader is there, else held for the button.
  const arrive = useCallback(
    (incoming: AuditFeedItem[]) => {
      const known = new Set([...itemsRef.current, ...pendingRef.current].map((i) => i.id));
      const fresh = incoming.filter((i) => !known.has(i.id));
      if (fresh.length === 0) return;
      const atTop = typeof window === "undefined" || window.scrollY < NEAR_TOP_PX;
      if (atTop) {
        setItems((prev) => merge(fresh, prev));
        flash(fresh.map((i) => i.id));
      } else {
        setPending((prev) => merge(fresh, prev));
      }
    },
    [flash]
  );

  const showPending = () => {
    const incoming = pendingRef.current;
    setPending([]);
    setItems((prev) => merge(incoming, prev));
    flash(incoming.map((i) => i.id));
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // The page's own refresh (every 15 s, and after new actions) brings a fresh
  // first page; whatever in it is new comes in like any other arrival.
  useEffect(() => {
    arrive(initialItems);
  }, [initialItems, arrive]);

  // Older rows as the bottom comes into view; reconnects after each load so a
  // tall screen keeps filling until there's no more.
  useEffect(() => {
    if (!hasMore || loadingMore || error) return;
    const el = sentinelRef.current;
    if (!el) return;
    const loadMore = async () => {
      setLoadingMore(true);
      setLoadMoreError(null);
      try {
        const supabase = createSupabaseBrowserClient();
        const before = cursorOf(itemsRef.current[itemsRef.current.length - 1]);
        const page = searching
          ? await searchActivity(supabase, query, { before, tableName: table || null, action: action || null, changedByValues: actorFilterValues })
          : await getAuditFeed(supabase, { before, tableName: table || null, action: action || null, changedByValues: actorFilterValues });
        if (page.error) {
          setLoadMoreError(page.error);
          return;
        }
        setItems((prev) => merge(prev, page.items));
        setHasMore(page.hasMore);
      } finally {
        setLoadingMore(false);
      }
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
    // actorKey stands for actorFilterValues (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, error, searching, query, table, action, actorKey]);

  // Live: the log's new rows, as they're written. Several land at once (an
  // order and its lines), so one short wait gathers them into one fetch of
  // everything newer than the newest row shown. The socket carries the
  // viewer's token, or the log's access rule drops the events before they come.
  useEffect(() => {
    if (searching || error) {
      onLiveChange(false);
      return;
    }
    // New actions are FETCHED once a minute while the page is on screen, and
    // the moment it comes back into view — not pushed. A live listener on
    // audit_logs had the database match every saved row (every save writes
    // one) against every open screen; with hours of entering expenses and
    // incomes one after another it froze the database (2026-10-12, 13:26–
    // 13:34; owner: "if activity caused this then revert the change").
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let inFlight = false;

    const fetchNewer = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const newest = [...pendingRef.current, ...itemsRef.current].sort(newestFirst)[0];
        const page = await getAuditFeed(supabase, {
          after: cursorOf(newest),
          tableName: table || null,
          action: action || null,
          changedByValues: actorFilterValues,
          limit: 200,
        });
        if (cancelled || page.error || page.items.length === 0) return;
        arrive(page.items);
        onArrivals();
      } finally {
        inFlight = false;
      }
    };

    onLiveChange(true);
    const poll = setInterval(() => void fetchNewer(), FEED_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchNewer();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, error, table, action, actorKey]);

  const nodes = useMemo(() => {
    const shown = usersOnly ? items.filter((i) => i.actorName !== "מערכת") : items;
    return batchSystemGroups(groupAuditFeedItems(shown));
  }, [items, usersOnly]);

  return (
    <div ref={topRef} className="relative scroll-mt-[calc(60px+var(--page-sticky-h,0px)+0.5rem)]">
      {pending.length > 0 ? (
        <div className="pointer-events-none sticky top-[calc(60px+var(--page-sticky-h,0px)+2.75rem)] z-20 flex h-0 justify-center">
          <button
            type="button"
            onClick={showPending}
            className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-secondary px-4 text-xs font-semibold text-secondary-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2"
          >
            <ArrowUpIcon className="h-3.5 w-3.5" />
            {pending.length === 1 ? "פעולה חדשה" : `${pending.length} פעולות חדשות`}
          </button>
        </div>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{`שגיאה בטעינת הפעילות: ${error}`}</CardContent>
        </Card>
      ) : nodes.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {searching ? `לא נמצאו פעולות עבור "${query.trim()}"` : "אין פעילות להצגה"}
          </CardContent>
        </Card>
      ) : (
        <ActivityFeed
          nodes={nodes}
          todayKey={todayKey}
          todayCount={searching || table || action || actorFilterValues.length || usersOnly ? null : todayCount}
          freshIds={freshIds}
          dimmed={dimmed}
        />
      )}

      {!error && hasMore ? <div ref={sentinelRef} className="h-1" /> : null}
      {loadMoreError ? (
        <p className="pt-2 text-center text-sm text-destructive">{`שגיאה בטעינת פעילות נוספת: ${loadMoreError}`}</p>
      ) : null}
      {!error && nodes.length > 0 ? (
        <p className="pt-3 text-center text-xs text-muted-foreground">
          {loadingMore ? "טוען עוד…" : hasMore ? "" : searching ? "אלה כל התוצאות" : "זו תחילת היומן"}
        </p>
      ) : null}
    </div>
  );
}
