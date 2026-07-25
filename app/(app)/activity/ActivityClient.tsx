"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  buildAuditFeedItem,
  getAuditFeedPaginated,
  groupAuditFeedItems,
  resolveAuditTitles,
  resolveUserDisplayNamesForValues,
  type AuditFeedItem,
  type AuditGroup,
  type AuditLogRow,
  type PresenceRosterUser,
} from "@/lib/audit";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import OnlineUsersCard from "./OnlineUsersCard";

function formatRelativeTime(isoString: string | null) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "עכשיו";
  if (diffMin < 60) return `לפני ${diffMin} דק'`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `לפני ${diffHrs} שע'`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
}

function formatFullDate(isoString: string | null) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("he-IL", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function actionColor(action: string) {
  const a = action.toLowerCase();
  // Morning.co integration events (morning_customer_linked, morning_*_failed, …)
  if (a.startsWith("morning")) return "bg-warning-soft text-warning-soft-foreground";
  switch (a) {
    case "create":
    case "insert":
    case "login":
      return "bg-success-soft text-success-soft-foreground"; // green — נוצר / התחבר
    case "update":
    case "status_changed":
      return "bg-info-soft text-info-soft-foreground"; // blue — עודכן
    case "priority_changed":
      return "bg-warning-soft text-warning-soft-foreground"; // amber
    case "delete":
      return "bg-destructive-soft text-destructive-soft-foreground"; // red — נמחק
    case "upload":
      return "bg-accent text-accent-foreground";
    case "logout":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// System/automated rows (actor "מערכת") are always grey, deliberately distinct
// from the blue "update" — a scheduled recheck isn't a person editing something.
function badgeColor(item: AuditFeedItem) {
  if (item.actorName === "מערכת") return "bg-muted text-muted-foreground";
  return actionColor(item.action);
}

// One feed row's body (badge · entity · actor · details · time). Wrapped in a
// link to the affected entity when the row has a viewable target.
function ActivityRow({ item }: { item: AuditFeedItem }) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <span
          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badgeColor(item)}`}
        >
          {item.actionLabel}
        </span>
        <div className="min-w-0">
          <div>
            <span className="text-sm font-medium">{item.entityLabel}</span>
            {item.title && (
              <span className="text-sm font-semibold text-foreground">{` · ${item.title}`}</span>
            )}
            <span className="text-muted-foreground text-sm"> · </span>
            <span className="text-sm text-muted-foreground">{item.actorName}</span>
            {item.actorRole && (
              <Badge variant="outline" className="mr-2 text-xs py-0">
                {item.actorRole}
              </Badge>
            )}
          </div>
          {item.details && (
            <div className="mt-0.5 truncate text-xs text-foreground/70">{item.details}</div>
          )}
        </div>
      </div>
      <time
        className="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
        title={formatFullDate(item.createdAt)}
      >
        {formatRelativeTime(item.createdAt)}
      </time>
    </div>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        className="-mx-1 block rounded-md px-1 transition-colors hover:bg-muted/50"
      >
        {body}
      </Link>
    );
  }
  return body;
}

// Compact side-effect row shown when a group is expanded.
function ActivityChildRow({ item }: { item: AuditFeedItem }) {
  const body = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${badgeColor(item)}`}
        >
          {item.actionLabel}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {item.entityLabel}
          {item.title ? ` · ${item.title}` : ""}
          {item.details ? ` · ${item.details}` : ""}
        </span>
      </div>
      <time className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(item.createdAt)}
      </time>
    </div>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="-mx-1 block rounded px-1 hover:bg-muted/50">
        {body}
      </Link>
    );
  }
  return body;
}

// A feed entry is either a normal (possibly grouped) action, or a batch of
// consecutive automated/system rows collapsed into a single expandable card.
type RenderNode =
  | { type: "group"; group: AuditGroup }
  | { type: "sysBatch"; id: string; rows: AuditFeedItem[]; latest: string | null };

// Collapse runs of consecutive system-actor rows (changed_by null → "מערכת", the
// reminder-sync churn) into one "N עדכוני מערכת" card, so hourly automated
// updates don't each get their own row. A lone system row is left as-is.
function batchSystemGroups(groups: AuditGroup[]): RenderNode[] {
  const out: RenderNode[] = [];
  let run: AuditGroup[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length >= 2) {
      const rows = run.map((g) => g.header);
      out.push({ type: "sysBatch", id: `sys:${rows[0].id}`, rows, latest: rows[0].createdAt });
    } else {
      out.push({ type: "group", group: run[0] });
    }
    run = [];
  };
  for (const g of groups) {
    const isSystem = g.header.actorName === "מערכת" && g.children.length === 0;
    if (isSystem) run.push(g);
    else {
      flush();
      out.push({ type: "group", group: g });
    }
  }
  flush();
  return out;
}

type Props = {
  items: AuditFeedItem[];
  totalCount: number;
  page: number;
  totalPages: number;
  error: string | null;
  tableOptions: readonly { value: string; label: string }[];
  actionOptions: readonly { value: string; label: string }[];
  workerOptions: readonly { value: string; label: string }[];
  currentTable: string;
  currentAction: string;
  currentWorker: string;
  // The selected worker's changed_by values (users.id + auth_user_id), so the
  // live feed and infinite scroll can honor the worker filter too.
  actorFilterValues: string[];
  roster: PresenceRosterUser[];
};

export default function ActivityClient({
  items,
  totalCount,
  error,
  tableOptions,
  actionOptions,
  workerOptions,
  currentTable,
  currentAction,
  currentWorker,
  actorFilterValues,
  roster,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // Stable dependency for the filter effects (arrays are new references each render).
  const actorFilterKey = actorFilterValues.join(",");

  // Server-loaded rows accumulated so far. Seeded with the first page rendered
  // on the server, then grown as the bottom sentinel scrolls into view — no
  // "next page" button. The parent remounts this component (via `key`) when the
  // filter changes, so this state resets cleanly back to page one.
  const [serverItems, setServerItems] = useState<AuditFeedItem[]>(items);
  const [nextPage, setNextPage] = useState(2);
  const [hasMore, setHasMore] = useState(items.length < totalCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Live feed: rows that arrived via realtime since this view mounted (newest
  // first).
  const [extraItems, setExtraItems] = useState<AuditFeedItem[]>([]);

  // Which grouped cards have their side-effect rows expanded.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // "רק פעולות משתמשים" — hide automated/system-actor rows (changed_by null).
  const [usersOnly, setUsersOnly] = useState(false);

  // Fold any newly-arrived first-page rows (from the 15s safety refresh below)
  // into the accumulated list, keeping newest-first order and never duplicating.
  useEffect(() => {
    setServerItems((prev) => {
      const seen = new Set(prev.map((i) => i.id));
      const fresh = items.filter((i) => !seen.has(i.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, [items]);

  // Fetch the next page from the database when the bottom comes into view, and
  // reconnect after each load so a tall screen keeps filling until it's done.
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const loadMore = async () => {
      setLoadingMore(true);
      setLoadMoreError(null);
      try {
        const supabase = createSupabaseBrowserClient();
        const result = await getAuditFeedPaginated(supabase, {
          page: nextPage,
          tableName: currentTable || null,
          action: currentAction || null,
          changedByValues: actorFilterValues.length ? actorFilterValues : null,
        });
        if (result.error) {
          setLoadMoreError(result.error);
          return;
        }
        setServerItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const fresh = result.items.filter((i) => !seen.has(i.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        setNextPage(result.page + 1);
        setHasMore(result.page < result.totalPages);
      } finally {
        setLoadingMore(false);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
    // actorFilterKey is the stable serialization of actorFilterValues — depend
    // on it (not the array reference) so this only re-runs when contents change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, nextPage, currentTable, currentAction, actorFilterKey]);

  // Realtime: prepend new rows instantly. The realtime socket must carry the
  // user's auth token — otherwise RLS on audit_logs silently drops the events
  // before they reach us.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) supabase.realtime.setAuth(token);
      if (cancelled) return;

      channel = supabase
        .channel("activity-feed")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "audit_logs" },
          async (payload) => {
            const row = payload.new as AuditLogRow;
            if (!row?.id) return;
            // Login/logout show in the bar — keep them out of the live feed unless
            // explicitly filtered to auth.
            if (row.table_name === "auth" && currentTable !== "auth") return;
            // Respect the active filters.
            if (currentTable && row.table_name !== currentTable) return;
            if (currentAction && row.action !== currentAction) return;
            if (
              actorFilterValues.length &&
              !(row.changed_by && actorFilterValues.includes(row.changed_by))
            )
              return;

            let actorName: string | null = null;
            if (row.changed_by) {
              const names = await resolveUserDisplayNamesForValues(supabase, [row.changed_by]);
              actorName = names[row.changed_by] ?? null;
            }
            const titles = await resolveAuditTitles(supabase, [row]);
            const item = buildAuditFeedItem(row, actorName, titles.get(row.id) ?? null);

            setExtraItems((prev) => {
              if (prev.some((existing) => existing.id === item.id)) return prev;
              return [item, ...prev];
            });
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
    // actorFilterKey is the stable serialization of actorFilterValues — depend
    // on it (not the array reference) so this only re-runs when contents change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTable, currentAction, actorFilterKey]);

  // Safety net: refresh the server data on an interval so the feed stays current
  // even if realtime is ever blocked — no manual refresh required.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
  }, [router]);

  // Merge realtime rows ahead of the accumulated server rows, dropping any the
  // server already included (avoids a flash of duplicates).
  const existingIds = new Set(serverItems.map((i) => i.id));
  const mergedItems = [...extraItems.filter((i) => !existingIds.has(i.id)), ...serverItems];
  const liveCount = mergedItems.length - serverItems.length;

  // Feed hygiene: login/logout now live in the "מחוברים כעת" bar, so keep them
  // out of the feed (unless explicitly filtered to auth). System-actor rows
  // (changed_by null → "מערכת") stay in the feed but get batched below; the
  // "רק פעולות משתמשים" toggle drops them entirely.
  const displayItems = mergedItems.filter((i) => {
    if (i.tableName === "auth" && currentTable !== "auth") return false;
    if (usersOnly && i.actorName === "מערכת") return false;
    return true;
  });

  // Collapse side-effect rows (order items, stock movements, …) under the action
  // that caused them.
  const groups = groupAuditFeedItems(displayItems);
  const renderNodes = batchSystemGroups(groups);
  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateParams(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <OnlineUsersCard roster={roster} />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={currentTable}
            onChange={(e) => updateParams({ table: e.target.value })}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {tableOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={currentAction}
            onChange={(e) => updateParams({ action: e.target.value })}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={currentWorker}
            onChange={(e) => updateParams({ worker: e.target.value })}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {workerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm">
            <input
              type="checkbox"
              checked={usersOnly}
              onChange={(e) => setUsersOnly(e.target.checked)}
              className="h-4 w-4 accent-secondary"
            />
            רק פעולות משתמשים
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success-soft-foreground" />
            </span>
            עדכון חי
          </span>
          {liveCount > 0 && (
            <Badge variant="secondary" className="text-xs">{`${liveCount} חדש`}</Badge>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4 text-sm text-destructive">{`שגיאה בטעינת הפעילות: ${error}`}</CardContent>
        </Card>
      )}

      {!error && displayItems.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            אין פעילות להצגה
          </CardContent>
        </Card>
      )}

      {!error && displayItems.length > 0 && (
        <div className="space-y-2">
          {renderNodes.map((node) => {
            // A batch of automated system rows → one collapsed, expandable card.
            if (node.type === "sysBatch") {
              const isExpanded = expanded.has(node.id);
              return (
                <Card key={node.id} className={isPending ? "opacity-60 transition-opacity" : ""}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                          מערכת
                        </span>
                        <div className="min-w-0 text-sm font-medium">
                          {`${node.rows.length} עדכוני מערכת`}
                        </div>
                      </div>
                      <time
                        className="shrink-0 text-xs text-muted-foreground whitespace-nowrap"
                        title={formatFullDate(node.latest)}
                      >
                        {formatRelativeTime(node.latest)}
                      </time>
                    </div>
                    <div className="mt-2 border-t pt-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(node.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                        {isExpanded ? "הסתר" : `הצג ${node.rows.length} עדכונים`}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 space-y-1.5 pr-2">
                          {node.rows.map((r) => (
                            <ActivityChildRow key={r.id} item={r} />
                          ))}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const { header, children } = node.group;
            const isExpanded = expanded.has(header.id);
            return (
              <Card key={header.id} className={isPending ? "opacity-60 transition-opacity" : ""}>
                <CardContent className="py-3 px-4">
                  <ActivityRow item={header} />
                  {children.length > 0 && (
                    <div className="mt-2 border-t pt-2">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(header.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        />
                        {isExpanded ? "הסתר שינויים" : `ועוד ${children.length} שינויים נלווים`}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 space-y-1.5 pr-2">
                          {children.map((child) => (
                            <ActivityChildRow key={child.id} item={child} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!error && hasMore ? <div ref={sentinelRef} className="h-1" /> : null}

      {loadMoreError && (
        <p className="pt-1 text-center text-sm text-destructive">{`שגיאה בטעינת פעילות נוספת: ${loadMoreError}`}</p>
      )}

      {!error && displayItems.length > 0 && (
        <div className="pt-2 text-center text-xs text-muted-foreground">
          {loadingMore ? "טוען…" : `מציג ${serverItems.length} מתוך ${totalCount} פעולות`}
        </div>
      )}
    </div>
  );
}
