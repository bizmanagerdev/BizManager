"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDownIcon, FilterIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { PageHeaderToolbar } from "@/components/layout/PageHeaderToolbar";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import {
  buildAuditFeedItem,
  enrichDocumentLinks,
  getAuditFeedPaginated,
  groupAuditFeedItems,
  resolveAuditTitles,
  resolveUserColorsForValues,
  resolveUserDisplayNamesForValues,
  type AuditFeedItem,
  type AuditGroup,
  type AuditLogRow,
  type PresenceRosterUser,
} from "@/lib/audit";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import OnlineUsersCard from "./OnlineUsersCard";

// The row stamp — always the whole date: day, month, year and the hour, on every
// row including today's. Abbreviating (clock-only for today, no year for this
// year) reads as a cut-off date on a phone, where there's no table header or
// hover tooltip to say which day you're looking at. Never relative ("לפני X") —
// the user wants the actual hour. Zero-padded so the column lines up under
// tabular-nums, and rendered inside dir="ltr" by every caller so RTL bidi doesn't
// reorder the date and the clock into "21:54 09.08.26".
function formatActivityTime(isoString: string | null) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${String(date.getFullYear()).slice(-2)}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
    case "reminders_synced":
      return "bg-info-soft text-info-soft-foreground"; // blue — עודכן
    case "priority_changed":
    case "logout":
      return "bg-warning-soft text-warning-soft-foreground"; // amber — עדיפות / יצא
    case "delete":
      return "bg-destructive-soft text-destructive-soft-foreground"; // red — נמחק
    case "upload":
      return "bg-accent text-accent-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

// The action badge is colored by the ACTION only (blue update, green create, …) —
// even for automated "מערכת" rows, so a system update matches every other update.
// What marks a row as automated is the grey "מערכת" chip in the user column, not
// the action badge or the row's accent stripe.
function badgeColor(item: AuditFeedItem) {
  return actionColor(item.action);
}

// The CSS-var color (an "R G B" triplet) for a row's action, used as the accent
// stripe on the table row's start edge so create / update / delete are scannable
// at a glance without reading the badge. Mirrors actionColor's mapping.
function accentColorVar(item: AuditFeedItem): string {
  const a = item.action.toLowerCase();
  if (a.startsWith("morning")) return "var(--warning-soft-foreground)";
  switch (a) {
    case "create":
    case "insert":
    case "login":
      return "var(--success-soft-foreground)";
    case "update":
    case "status_changed":
    case "reminders_synced":
      return "var(--info-soft-foreground)";
    case "priority_changed":
    case "logout":
      return "var(--warning-soft-foreground)";
    case "delete":
      return "var(--destructive-soft-foreground)";
    default:
      return "var(--muted-foreground)";
  }
}

// The actor of a row: their colored-initials avatar (using the color they chose,
// with a stable name-hash fallback so the same person is the same color on every
// surface), name, and role. System rows ("מערכת") get a neutral chip, no avatar —
// an automated recheck isn't a person.
function ActorCell({ item }: { item: AuditFeedItem }) {
  if (item.actorName === "מערכת") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
          מ
        </span>
        <span>מערכת</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <InitialsAvatar
        name={item.actorName}
        color={item.actorColor}
        colorKey={item.actorName}
        size="sm"
        className="h-6 w-6 text-[10px]"
      />
      <span className="font-medium text-foreground">{item.actorName}</span>
    </span>
  );
}

// The old→new field changes as two aligned stacks (used for the table's before /
// after columns). `side` picks which value to show; the "before" side carries the
// field label so the row reads "סטטוס: פתוח" → "הושלם" across the two columns.
function ChangeStack({ item, side }: { item: AuditFeedItem; side: "before" | "after" }) {
  if (item.changes.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 leading-tight">
      {item.changes.map((c, i) => (
        // No whitespace-nowrap here: a free-text field (e.g. הערות) can be far
        // longer than this fixed-width column, and nowrap let it spill out over
        // the neighboring cells instead of wrapping inside its own column.
        <span key={i} className="break-words">
          <span className="whitespace-nowrap text-muted-foreground">{`${c.label}: `}</span>
          {side === "before" ? (
            <span className="text-foreground/80">{c.before}</span>
          ) : (
            <span className="font-medium text-foreground">{c.after}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Renders a details string so it wraps at spaces only — each token (a date like
// "2026-09-09", a "₪680" amount, the "→" arrow) stays whole and never splits
// across two rows. The line still wraps between tokens when it's too long —
// the card has no fixed height, so wrapping just makes it a line taller; the
// card growing to fit is the point, not a compromise.
// The trailing space used to be rendered INSIDE the nowrap span together with
// the token, which made the space itself non-breaking too — with no break
// opportunity left ANYWHERE (nowrap suppresses it at the space, and there's no
// space between two adjacent spans), the whole line became one solid
// unbreakable run and just ran off the card's edge instead of wrapping between
// words. Fixed by moving the space OUTSIDE the span, as a plain sibling text
// node the (non-nowrap) container is free to break at, same as normal text.
// EXCEPTION: a token longer than a card is ever going to be (a UUID-based file
// name, a long code with no spaces) has no space to break at in the first
// place — past a length threshold it falls back to break-words so it wraps
// inside itself as a last resort instead of overflowing.
const NOWRAP_TOKEN_MAX = 28;
function DetailsText({ text, className }: { text: string; className: string }) {
  const tokens = text.split(" ");
  return (
    <div className={className}>
      {tokens.map((tok, i) => (
        <Fragment key={i}>
          <span className={tok.length > NOWRAP_TOKEN_MAX ? "break-words" : "whitespace-nowrap"}>{tok}</span>
          {i < tokens.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </div>
  );
}

// One feed row's body, stacked for a clean read on a phone: a meta line (action
// badge on the right, time on the left), then entity · title, actor + role, and
// the full details — nothing truncated, everything wraps. Each mixed Hebrew /
// Latin / number segment is its own element so RTL bidi doesn't scramble them.
function ActivityRow({ item }: { item: AuditFeedItem }) {
  const body = (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badgeColor(item)}`}
        >
          {item.actionLabel}
        </span>
        <time
          dir="ltr"
          className="shrink-0 text-xs text-muted-foreground whitespace-nowrap tabular-nums"
          title={formatFullDate(item.createdAt)}
        >
          {formatActivityTime(item.createdAt)}
        </time>
      </div>

      <div className="text-sm leading-tight break-words">
        <span className="font-medium text-foreground">{item.entityLabel}</span>
        {item.title && (
          <>
            <span className="text-muted-foreground"> · </span>
            <span className="font-semibold text-foreground">{item.title}</span>
          </>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        <ActorCell item={item} />
      </div>

      {item.details && (
        <DetailsText text={item.details} className="text-xs leading-tight text-foreground/70" />
      )}
    </div>
  );
  if (item.href) {
    return (
      <Link
        href={item.href}
        className="-mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-secondary/15 hover:ring-1 hover:ring-secondary/30"
      >
        {body}
      </Link>
    );
  }
  return body;
}

// Compact side-effect row shown when a group is expanded. Wraps rather than
// truncates so the full change stays readable on a narrow screen.
function ActivityChildRow({ item }: { item: AuditFeedItem }) {
  const body = (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor(item)}`}
        >
          {item.actionLabel}
        </span>
        <DetailsText
          text={`${item.entityLabel}${item.title ? ` · ${item.title}` : ""}${item.details ? ` · ${item.details}` : ""}`}
          className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground"
        />
      </div>
      <time dir="ltr" className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap tabular-nums">
        {formatActivityTime(item.createdAt)}
      </time>
    </div>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="-mx-1 block rounded px-1 py-0.5 transition-colors hover:bg-secondary/15">
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

// Desktop table: one expanded side-effect / system row. Spans the middle columns
// so the change text has room; indented from the start edge to sit under its parent.
function ActivityTableChildRow({ item }: { item: AuditFeedItem }) {
  const text = `${item.entityLabel}${item.title ? ` · ${item.title}` : ""}${item.details ? ` · ${item.details}` : ""}`;
  const inner = <span className="break-words leading-tight text-muted-foreground">{text}</span>;
  return (
    <tr className="border-b border-border/30 bg-secondary/5 text-xs last:border-0">
      <td
        className="px-3 py-1 pe-6 align-top"
        style={{ boxShadow: `inset -2px 0 0 0 rgb(${accentColorVar(item)})` }}
      >
        <span
          className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor(item)}`}
        >
          {item.actionLabel}
        </span>
      </td>
      <td className="px-3 py-1 align-top" colSpan={5}>
        {item.href ? (
          <Link href={item.href} className="hover:underline">{inner}</Link>
        ) : (
          inner
        )}
      </td>
      <td dir="ltr" className="whitespace-nowrap px-3 py-1 text-right align-top text-[10px] tabular-nums text-muted-foreground">
        {formatActivityTime(item.createdAt)}
      </td>
    </tr>
  );
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
  // Count of actions recorded today — the mobile header's subtitle.
  todayCount: number;
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
  todayCount,
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

  // Mobile: the filters live in the dark header behind a toggle (no room for a
  // row of dropdowns on a phone). Desktop keeps the inline toolbar.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
            // Respect the active filters.
            if (currentTable && row.table_name !== currentTable) return;
            if (currentAction && row.action !== currentAction) return;
            if (
              actorFilterValues.length &&
              !(row.changed_by && actorFilterValues.includes(row.changed_by))
            )
              return;

            let actorName: string | null = null;
            let actorColor: string | null = null;
            if (row.changed_by) {
              const [names, colors] = await Promise.all([
                resolveUserDisplayNamesForValues(supabase, [row.changed_by]),
                resolveUserColorsForValues(supabase, [row.changed_by]),
              ]);
              actorName = names[row.changed_by] ?? null;
              actorColor = colors[row.changed_by] ?? null;
            }
            const titles = await resolveAuditTitles(supabase, [row]);
            const item = buildAuditFeedItem(row, actorName, titles.get(row.id) ?? null, actorColor);
            if (item.tableName === "documents") await enrichDocumentLinks(supabase, [item]);

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

  // Feed hygiene: login/logout ("נכנס" / "יצא", each carrying how long the person
  // was active) are part of the feed — the bar above only says who's online right
  // now, not who worked when. System-actor rows (changed_by null → "מערכת") stay
  // too but get batched below; "רק פעולות משתמשים" drops them entirely.
  const displayItems = mergedItems.filter((i) => {
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

  function resetActivityFilters() {
    setUsersOnly(false);
    updateParams({ table: "", action: "", worker: "" });
  }

  // How many filters are narrowing the feed — shown as a count on the mobile
  // header's "סינון" button so it's clear a filter is active without opening it.
  const activeFilterCount =
    [currentTable, currentAction, currentWorker].filter(Boolean).length + (usersOnly ? 1 : 0);

  // Name the page in the mobile top bar (no sidebar there to say where you are),
  // with the total action count as the subtitle.
  useSetPageTitle("פעילות", `${todayCount.toLocaleString("he-IL")} פעולות היום`);

  return (
    <div className="space-y-4 text-right" dir="rtl">
      {/* Mobile: the live indicator + a "סינון" toggle live in the dark header,
          so the header is one block (what page you're on, then its controls).
          The dropdowns themselves open in the panel just below. */}
      <PageHeaderToolbar>
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success-soft-foreground/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success-soft-foreground" />
            </span>
            עדכון חי
            {liveCount > 0 && (
              <Badge variant="secondary" className="ms-1 text-[10px]">{`${liveCount} חדש`}</Badge>
            )}
          </span>
          <Button
            type="button"
            aria-label={mobileFiltersOpen ? "הסתרת סינון" : "סינון"}
            aria-expanded={mobileFiltersOpen}
            aria-controls="activity-mobile-filters"
            className={
              mobileFiltersOpen
                ? "h-10 shrink-0 gap-1.5 rounded-xl px-3"
                : "h-10 shrink-0 gap-1.5 rounded-xl px-3 "
            }
            onClick={() => setMobileFiltersOpen((current) => !current)}
          >
            <FilterIcon className="h-4 w-4" />
            <span className="text-xs">סינון</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-semibold text-secondary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </PageHeaderToolbar>

      {/* Mobile filters panel — on the light surface, toggled from the header. */}
      <div
        id="activity-mobile-filters"
        className={`${mobileFiltersOpen ? "grid" : "hidden"} gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm md:hidden`}
      >
        <div className="min-w-0">
          <label className="text-sm text-muted-foreground">סוג</label>
          <NativeSelect
            value={currentTable}
            onChange={(e) => updateParams({ table: e.target.value })}
            disabled={isPending} className="mt-1"
          >
            {tableOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0">
          <label className="text-sm text-muted-foreground">פעולה</label>
          <NativeSelect
            value={currentAction}
            onChange={(e) => updateParams({ action: e.target.value })}
            disabled={isPending} className="mt-1"
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="min-w-0">
          <label className="text-sm text-muted-foreground">משתמש</label>
          <NativeSelect
            value={currentWorker}
            onChange={(e) => updateParams({ worker: e.target.value })}
            disabled={isPending} className="mt-1"
          >
            {workerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            checked={usersOnly}
            onChange={(e) => setUsersOnly(e.target.checked)}
            className="h-4 w-4 accent-secondary"
          />
          רק פעולות משתמשים
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" className="h-11" onClick={resetActivityFilters}>
            איפוס סינון
          </Button>
          <Button type="button" className="h-11" onClick={() => setMobileFiltersOpen(false)}>
            הצגת התוצאות
          </Button>
        </div>
      </div>

      <OnlineUsersCard roster={roster} />

      {/* Desktop toolbar — inline dropdowns; the sidebar already says where you are. */}
      <div className="hidden md:flex md:items-center md:justify-between md:gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect dense
            value={currentTable}
            onChange={(e) => updateParams({ table: e.target.value })}
            disabled={isPending} className="max-w-[9rem] text-xs"
          >
            {tableOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
          <NativeSelect dense
            value={currentAction}
            onChange={(e) => updateParams({ action: e.target.value })}
            disabled={isPending} className="max-w-[9rem] text-xs"
          >
            {actionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
          <NativeSelect dense
            value={currentWorker}
            onChange={(e) => updateParams({ worker: e.target.value })}
            disabled={isPending} className="max-w-[9rem] text-xs"
          >
            {workerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </NativeSelect>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs shadow-sm">
            <input
              type="checkbox"
              checked={usersOnly}
              onChange={(e) => setUsersOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-secondary"
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

      {/* Desktop: a compact table — same data as the cards, far less vertical space. */}
      {!error && displayItems.length > 0 && (
        <div
          className={`hidden rounded-b-lg border border-border/60 bg-card shadow-sm md:block ${
            isPending ? "opacity-60 transition-opacity" : ""
          }`}
        >
          {/* table-fixed: column widths come from this colgroup alone, computed
              once — not from every currently-rendered row's content. Without it
              the browser re-measures all cells on every re-render (new rows
              arriving via infinite scroll, the 15s refresh, realtime inserts),
              so columns — and the whole table — visibly resize/shift each time. */}
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[6rem]" />
              <col className="w-[13rem]" />
              <col className="w-[11rem]" />
              <col />
              <col className="w-[9rem]" />
              <col className="w-[9rem]" />
              {/* Wide enough for the full "09.08.26 21:54" stamp at text-xs. */}
              <col className="w-[8.5rem]" />
            </colgroup>
            {/* Sticky under the 60px top bar (z-20 keeps it below the bar's z-30).
                The wrapper can't clip with overflow-hidden or the header wouldn't
                stick, so the header stays square (the card only rounds at the
                bottom) instead of trying to match a corner it can't clip to. */}
            <thead className="sticky top-[60px] z-20">
              <tr className="border-b-2 border-border bg-[rgb(var(--secondary-10))] text-sm font-semibold text-foreground shadow-sm">
                <th className="px-3 py-3.5 text-right">פעולה</th>
                <th className="px-3 py-3.5 text-right">רשומה</th>
                <th className="px-3 py-3.5 text-right">משתמש</th>
                <th className="px-3 py-3.5 text-right">פרטים</th>
                <th className="px-3 py-3.5 text-right">לפני</th>
                <th className="px-3 py-3.5 text-right">אחרי</th>
                <th className="whitespace-nowrap px-3 py-3.5 text-right">זמן</th>
              </tr>
            </thead>
            <tbody>
              {renderNodes.map((node) => {
                if (node.type === "sysBatch") {
                  const isExpanded = expanded.has(node.id);
                  return (
                    <Fragment key={node.id}>
                      <tr className="border-b border-border/40 last:border-0">
                        <td
                          className="px-3 py-1.5 align-middle"
                          style={{ boxShadow: `inset -3px 0 0 0 rgb(${accentColorVar(node.rows[0])})` }}
                        >
                          <span className="inline-block rounded bg-info-soft px-2 py-0.5 text-xs font-medium text-info-soft-foreground">
                            עודכן
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(node.id)}
                            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-secondary"
                          >
                            <ChevronDownIcon
                              className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                            />
                            {`${node.rows.length} עדכוני מערכת`}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-middle">
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
                              מ
                            </span>
                            <span>מערכת</span>
                          </span>
                        </td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2" />
                        <td
                          dir="ltr"
                          className="whitespace-nowrap px-3 py-2 text-right align-middle text-xs tabular-nums text-muted-foreground"
                          title={formatFullDate(node.latest)}
                        >
                          {formatActivityTime(node.latest)}
                        </td>
                      </tr>
                      {isExpanded &&
                        node.rows.map((r) => <ActivityTableChildRow key={r.id} item={r} />)}
                    </Fragment>
                  );
                }

                const { header, children } = node.group;
                const isExpanded = expanded.has(header.id);
                const clickable = !!header.href;
                return (
                  <Fragment key={header.id}>
                    {/* Only a row that actually leads somewhere reacts to the
                        pointer. A row with no destination (a login/logout, say)
                        stays flat — a hover tint on it reads as "clickable" and
                        then nothing happens. */}
                    <tr
                      className={`border-b border-border/40 last:border-0 ${
                        clickable ? "cursor-pointer hover:bg-secondary/15" : ""
                      }`}
                      onClick={clickable ? () => router.push(header.href!) : undefined}
                    >
                      <td
                        className="px-3 py-2 align-middle"
                        style={{ boxShadow: `inset -3px 0 0 0 rgb(${accentColorVar(header)})` }}
                      >
                        <span
                          className={`inline-block shrink-0 rounded px-2 py-0.5 text-xs font-medium ${badgeColor(header)}`}
                        >
                          {header.actionLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="break-words leading-tight">
                          <span className="font-medium text-foreground">{header.entityLabel}</span>
                          {header.title && (
                            <>
                              <span className="text-muted-foreground"> · </span>
                              <span className="font-semibold text-foreground">{header.title}</span>
                            </>
                          )}
                          {children.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded(header.id);
                              }}
                              className="ms-2 inline-flex items-center gap-0.5 align-middle text-xs text-muted-foreground hover:text-foreground"
                            >
                              <ChevronDownIcon
                                className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                              {isExpanded ? "הסתר" : `+${children.length}`}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-middle text-xs text-muted-foreground">
                        <ActorCell item={header} />
                      </td>
                      <td className="max-w-[18rem] px-3 py-2 align-middle text-xs text-foreground/70">
                        {header.baseDetails ? (
                          <DetailsText text={header.baseDetails} className="leading-tight" />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-middle text-xs">
                        <ChangeStack item={header} side="before" />
                      </td>
                      <td className="px-3 py-2 align-middle text-xs">
                        <ChangeStack item={header} side="after" />
                      </td>
                      <td
                        dir="ltr"
                        className="whitespace-nowrap px-3 py-2 text-right align-middle text-xs tabular-nums text-muted-foreground"
                        title={formatFullDate(header.createdAt)}
                      >
                        {formatActivityTime(header.createdAt)}
                      </td>
                    </tr>
                    {isExpanded &&
                      children.map((child) => (
                        <ActivityTableChildRow key={child.id} item={child} />
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile: cards. */}
      {!error && displayItems.length > 0 && (
        <div className="space-y-1.5 md:hidden">
          {renderNodes.map((node) => {
            // A batch of automated system rows → one collapsed, expandable card.
            if (node.type === "sysBatch") {
              const isExpanded = expanded.has(node.id);
              return (
                <Card key={node.id} className={isPending ? "opacity-60 transition-opacity" : ""}>
                  <CardContent className="py-2 px-4">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="shrink-0 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                          מערכת
                        </span>
                        <time
                          className="shrink-0 text-xs text-muted-foreground whitespace-nowrap tabular-nums"
                          title={formatFullDate(node.latest)}
                        >
                          {formatActivityTime(node.latest)}
                        </time>
                      </div>
                      <div className="text-sm font-medium leading-tight">
                        {`${node.rows.length} עדכוני מערכת`}
                      </div>
                    </div>
                    <div className="mt-1.5 border-t pt-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(node.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDownIcon
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
                <CardContent className="py-2 px-4">
                  <ActivityRow item={header} />
                  {children.length > 0 && (
                    <div className="mt-1.5 border-t pt-1.5">
                      <button
                        type="button"
                        onClick={() => toggleExpanded(header.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDownIcon
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
