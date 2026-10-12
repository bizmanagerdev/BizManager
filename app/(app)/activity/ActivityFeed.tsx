"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { ArrowLeftIcon, ChevronDownIcon } from "@/components/ui/icons";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import type { AuditChange, AuditFeedItem, AuditGroup } from "@/lib/audit";
import { activityKind } from "@/lib/activity/kinds";
import { dayHeading, israelClock, israelDayKeyOf } from "@/lib/activity/days";
import { isOrderPlumbing, orderLineDiff, type OrderLineChange } from "@/lib/activity/order-lines";
import { activitySentence, detailLine, isDelete, isUpdate, sentenceTellsStatus, type SentencePart } from "@/lib/activity/sentence";
import { ISRAEL_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { KindIcon } from "./activity-visuals";

// The feed: each action as one sentence with who did it and when, day by
// day — a table per day on a wide screen, a list on a phone, each under its
// day's heading that stays on screen while the day scrolls by. An action's
// side-rows (an order's lines, the payment that came with it) fold under it.

const SYSTEM_ACTOR = "מערכת";

// A feed entry is either an action (with whatever folded under it), or a run
// of the system's own automatic updates collapsed into one line.
export type RenderNode =
  | { type: "group"; group: AuditGroup }
  | { type: "sysBatch"; id: string; rows: AuditFeedItem[]; latest: string | null };

// Runs of two or more back-to-back system rows (the reminders refresh, say)
// become one "N עדכוני מערכת" line, so the hourly automation doesn't fill the
// feed. A lone system row stays as it is.
export function batchSystemGroups(groups: AuditGroup[]): RenderNode[] {
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
    if (g.header.actorName === SYSTEM_ACTOR && g.children.length === 0) run.push(g);
    else {
      flush();
      out.push({ type: "group", group: g });
    }
  }
  flush();
  return out;
}

function nodeTime(node: RenderNode): string | null {
  return node.type === "group" ? node.group.header.createdAt : node.latest;
}

function nodeId(node: RenderNode): string {
  return node.type === "group" ? node.group.header.id : node.id;
}

/** The nodes cut into days (Israel's calendar), newest day first, as they come. */
export function splitByDay(nodes: RenderNode[]): { dayKey: string; nodes: RenderNode[] }[] {
  const days: { dayKey: string; nodes: RenderNode[] }[] = [];
  for (const node of nodes) {
    const dayKey = israelDayKeyOf(nodeTime(node)) ?? "unknown";
    const last = days[days.length - 1];
    if (last && last.dayKey === dayKey) last.nodes.push(node);
    else days.push({ dayKey, nodes: [node] });
  }
  return days;
}

function fullStamp(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("he-IL", {
    timeZone: ISRAEL_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Sentence({ parts }: { parts: SentencePart[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && !p.glue ? " " : null}
          {p.strong ? <bdi className="font-semibold text-foreground">{p.text}</bdi> : p.text}
        </Fragment>
      ))}
    </>
  );
}

// Written by the notes diff when one side is only the unchanged history.
const UNCHANGED_HISTORY = "(ללא שינוי בהיסטוריה הקודמת)";

// "סטטוס  ̶ח̶ד̶ש̶  ←  נמסר": the old value struck through, the new one in green.
// The arrow is an icon, not a character, so right-to-left text can't turn it
// around.
function ChangeChip({ change }: { change: AuditChange }) {
  if (change.before === UNCHANGED_HISTORY) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <span className="text-muted-foreground">נוספה הערה:</span>
        <span className="text-foreground">{change.after}</span>
      </span>
    );
  }
  if (change.after === UNCHANGED_HISTORY) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1">
        <span className="text-muted-foreground">הוסרה הערה:</span>
        <span className="text-foreground line-through decoration-palette-red-4/60">{change.before}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground">{change.label}</span>
      <bdi className="rounded bg-palette-red-10 px-1.5 py-px text-foreground/70 line-through decoration-palette-red-4/60">
        {change.before}
      </bdi>
      <ArrowLeftIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="שונה ל" />
      <bdi className="rounded bg-palette-green-10 px-1.5 py-px font-medium text-foreground ring-1 ring-palette-green-8">
        {change.after}
      </bdi>
    </span>
  );
}

function qty(n: number) {
  return n.toLocaleString("he-IL", { maximumFractionDigits: 2 });
}

function LineChip({ change }: { change: OrderLineChange }) {
  if (change.kind === "changed") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <bdi className="text-foreground">{change.name}</bdi>
        <span className="rounded bg-palette-red-10 px-1.5 py-px tabular-nums text-foreground/70 line-through decoration-palette-red-4/60">
          {qty(change.from)}
        </span>
        <ArrowLeftIcon className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="שונה ל" />
        <span className="rounded bg-palette-green-10 px-1.5 py-px font-medium tabular-nums text-foreground ring-1 ring-palette-green-8">
          {qty(change.to)}
        </span>
      </span>
    );
  }
  if (change.kind === "added") {
    return (
      <span className="rounded bg-palette-green-10 px-1.5 py-px text-foreground ring-1 ring-palette-green-8">
        {"נוסף: "}
        <bdi>{change.name}</bdi> <span className="tabular-nums">×{qty(change.qty)}</span>
      </span>
    );
  }
  return (
    <span className="rounded bg-palette-red-10 px-1.5 py-px text-foreground/70">
      {"הוסר: "}
      <bdi className="line-through decoration-palette-red-4/60">{change.name}</bdi>{" "}
      <span className="tabular-nums">×{qty(change.qty)}</span>
    </span>
  );
}

function Actor({ item }: { item: AuditFeedItem }) {
  if (item.actorName === SYSTEM_ACTOR) {
    return <span className="text-muted-foreground">אוטומטי</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <InitialsAvatar name={item.actorName} color={item.actorColor} colorKey={item.actorName} size="xs" />
      <span className="font-medium text-foreground/80">{item.actorName}</span>
    </span>
  );
}

/** A folded side-row, as a short line of its own. */
function ChildLine({ item }: { item: AuditFeedItem }) {
  const parts = activitySentence(item);
  const detail = detailLine(item, parts);
  const body = (
    <span className="flex items-start gap-2">
      <KindIcon kind={activityKind(item)} size="sm" className="mt-px" />
      <span className="min-w-0 flex-1 text-xs leading-snug text-foreground/80">
        <Sentence parts={parts} />
        {detail ? <span className="text-muted-foreground">{` · ${detail}`}</span> : null}
      </span>
      <time dir="ltr" className="shrink-0 text-[0.647rem] tabular-nums text-muted-foreground" title={fullStamp(item.createdAt)}>
        {israelClock(item.createdAt)}
      </time>
    </span>
  );
  return item.href ? (
    <Link href={item.href} className="-mx-1 block rounded px-1 py-0.5 hover:bg-secondary/10">
      {body}
    </Link>
  ) : (
    <div className="py-0.5">{body}</div>
  );
}

// What an entry shows, worked out once for the phone's list and the wide
// table alike.
function useEntryModel(group: AuditGroup) {
  const { header, children } = group;
  const kind = activityKind(header);
  const parts = activitySentence(header);
  const detail = detailLine(header, parts);
  const tellsStatus = sentenceTellsStatus(header);
  const changes = header.changes.filter((c) => !(tellsStatus && c.label === "סטטוס"));

  // An order's lines and their stock rows aren't actions of their own: a new
  // order lists its items in the detail line, and a save comes down to what
  // changed in them (or to nothing, when only the status moved).
  const isOrder = header.tableName === "orders";
  const lines = isOrder && isUpdate(header.action) ? orderLineDiff(children) : null;
  // Deleting an order first empties it (its total drops to 0) — part of the
  // deletion, not an edit of its own.
  const deleting = isDelete(header.action);
  const shownChildren = isOrder
    ? children.filter((c) => !isOrderPlumbing(c) && !(deleting && c.tableName === "orders" && isUpdate(c.action)))
    : children;
  const hiddenPlumbing = children.length - shownChildren.length;
  const [showAll, setShowAll] = useState(false);
  // With nothing but plumbing under it, "פירוט מלא" opens straight onto it.
  const listed = showAll || shownChildren.length === 0 ? children : shownChildren;
  const hasChips = changes.length > 0 || (lines !== null && lines.changes.length > 0);

  return { header, children, kind, parts, detail, changes, lines, shownChildren, hiddenPlumbing, showAll, setShowAll, listed, hasChips };
}
type EntryModel = ReturnType<typeof useEntryModel>;

function Chips({ m }: { m: EntryModel }) {
  if (!m.hasChips) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
      {m.lines?.changes.map((c) => <LineChip key={`${c.kind}:${c.key}`} change={c} />)}
      {m.changes.map((c, i) => (
        <ChangeChip key={i} change={c} />
      ))}
    </div>
  );
}

function SentenceLink({ m }: { m: EntryModel }) {
  return m.header.href ? (
    <Link
      href={m.header.href}
      onClick={(e) => e.stopPropagation()}
      className="hover:underline hover:decoration-secondary/50 hover:underline-offset-2"
    >
      <Sentence parts={m.parts} />
    </Link>
  ) : (
    <Sentence parts={m.parts} />
  );
}

function FoldToggle({ m, expanded, onToggle }: { m: EntryModel; expanded: boolean; onToggle: () => void }) {
  if (m.children.length === 0) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      className={cn(
        "inline-flex min-h-7 items-center gap-1 text-xs hover:underline",
        m.shownChildren.length > 0 ? "font-medium text-secondary" : "text-muted-foreground"
      )}
    >
      <ChevronDownIcon className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
      {expanded
        ? "הסתרה"
        : m.shownChildren.length > 0
          ? `ועוד ${m.shownChildren.length} ${m.shownChildren.length === 1 ? "פעולה שנלוותה" : "פעולות שנלוו"}`
          : "פירוט מלא"}
    </button>
  );
}

function FoldedRows({ m }: { m: EntryModel }) {
  return (
    <div className="space-y-0.5 border-s-2 border-border/70 ps-2.5" onClick={(e) => e.stopPropagation()}>
      {m.listed.map((child) => (
        <ChildLine key={child.id} item={child} />
      ))}
      {!m.showAll && m.hiddenPlumbing > 0 && m.shownChildren.length > 0 ? (
        <button
          type="button"
          onClick={() => m.setShowAll(true)}
          className="text-[0.647rem] text-muted-foreground hover:text-foreground hover:underline"
        >
          {`כל ${m.children.length} השורות שנרשמו (פריטים ומלאי)`}
        </button>
      ) : null}
    </div>
  );
}

// ── Phone (and any narrow width): one entry as a list item ──────────────────

function Entry({
  group,
  fresh,
  expanded,
  onToggle,
}: {
  group: AuditGroup;
  fresh: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const m = useEntryModel(group);
  return (
    <li className={cn("relative flex gap-3 px-3 py-2.5 sm:px-4", fresh && "motion-safe:animate-activity-flash")}>
      <KindIcon kind={m.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm leading-snug text-foreground/90">
            <SentenceLink m={m} />
          </p>
          <time dir="ltr" className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground" title={fullStamp(m.header.createdAt)}>
            {israelClock(m.header.createdAt)}
          </time>
        </div>
        {m.hasChips ? (
          <div className="mt-1.5">
            <Chips m={m} />
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <Actor item={m.header} />
          {m.detail ? (
            <>
              <span aria-hidden>·</span>
              <bdi className="min-w-0 break-words">{m.detail}</bdi>
            </>
          ) : null}
        </div>
        {m.children.length > 0 ? (
          <div className="mt-1.5">
            <FoldToggle m={m} expanded={expanded} onToggle={onToggle} />
            {expanded ? (
              <div className="mt-1">
                <FoldedRows m={m} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SystemBatch({
  node,
  expanded,
  onToggle,
}: {
  node: Extract<RenderNode, { type: "sysBatch" }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex gap-3 px-3 py-2 sm:px-4">
      <KindIcon kind="system" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="inline-flex min-w-0 flex-1 items-center gap-1 text-start text-sm text-muted-foreground hover:text-foreground"
          >
            {`${node.rows.length} עדכונים אוטומטיים של המערכת`}
            <ChevronDownIcon className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
          <time dir="ltr" className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground" title={fullStamp(node.latest)}>
            {israelClock(node.latest)}
          </time>
        </div>
        {expanded ? (
          <div className="mt-1 space-y-0.5 border-s-2 border-border/70 ps-2.5">
            {node.rows.map((r) => (
              <ChildLine key={r.id} item={r} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

// ── Wide screens: a table, one per day ─────────────────────────────────────
// Each day's table carries its own heading in its sticky header — the day's
// name over the column names — so while a day scrolls by, its name and the
// columns stay on screen, and the next day's header takes over at its turn.

function TableColumns() {
  return (
    <colgroup>
      <col className="w-[3.25rem]" />
      <col />
      <col className="w-[32%]" />
      <col className="w-[9rem]" />
      <col className="w-[4.5rem]" />
    </colgroup>
  );
}

function TableRow({
  group,
  fresh,
  expanded,
  onToggle,
}: {
  group: AuditGroup;
  fresh: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const m = useEntryModel(group);
  const href = m.header.href;
  return (
    <>
      {/* Only a row that leads somewhere reacts to the pointer. */}
      <tr
        className={cn(
          "align-top [&>td]:border-t [&>td]:border-border/50",
          href && "cursor-pointer hover:bg-secondary/[0.07]",
          fresh && "motion-safe:animate-activity-flash"
        )}
        onClick={href ? () => router.push(href) : undefined}
      >
        <td className="py-2 pe-1 ps-3">
          <KindIcon kind={m.kind} size="sm" className="mt-px h-7 w-7" />
        </td>
        <td className="px-2 py-2">
          <p className="text-sm leading-snug text-foreground/90">
            <SentenceLink m={m} />
          </p>
          <FoldToggle m={m} expanded={expanded} onToggle={onToggle} />
        </td>
        <td className="px-2 py-2 text-xs">
          <div className="flex flex-col gap-1">
            <Chips m={m} />
            {m.detail ? <bdi className="break-words text-muted-foreground">{m.detail}</bdi> : null}
          </div>
        </td>
        <td className="px-2 py-2 text-xs">
          <Actor item={m.header} />
        </td>
        <td className="py-2 pe-3 ps-2 text-xs">
          <time dir="ltr" className="tabular-nums text-muted-foreground" title={fullStamp(m.header.createdAt)}>
            {israelClock(m.header.createdAt)}
          </time>
        </td>
      </tr>
      {expanded && m.children.length > 0 ? (
        <tr className="bg-muted/25">
          <td />
          <td colSpan={4} className="px-2 pb-2 pt-0.5">
            <FoldedRows m={m} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TableSystemBatch({
  node,
  expanded,
  onToggle,
}: {
  node: Extract<RenderNode, { type: "sysBatch" }>;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="align-top [&>td]:border-t [&>td]:border-border/50">
        <td className="py-2 pe-1 ps-3">
          <KindIcon kind="system" size="sm" className="mt-px h-7 w-7" />
        </td>
        <td className="px-2 py-2" colSpan={2}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-start text-sm text-muted-foreground hover:text-foreground"
          >
            {`${node.rows.length} עדכונים אוטומטיים של המערכת`}
            <ChevronDownIcon className={cn("h-3.5 w-3.5 shrink-0 transition-transform", expanded && "rotate-180")} />
          </button>
        </td>
        <td className="px-2 py-2 text-xs text-muted-foreground">אוטומטי</td>
        <td className="py-2 pe-3 ps-2 text-xs">
          <time dir="ltr" className="tabular-nums text-muted-foreground" title={fullStamp(node.latest)}>
            {israelClock(node.latest)}
          </time>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-muted/25">
          <td />
          <td colSpan={4} className="px-2 pb-2 pt-0.5">
            <div className="space-y-0.5 border-s-2 border-border/70 ps-2.5">
              {node.rows.map((r) => (
                <ChildLine key={r.id} item={r} />
              ))}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

const STICKY_TOP = "top-[calc(60px+var(--page-sticky-h,0px))]";

export default function ActivityFeed({
  nodes,
  todayKey,
  todayCount,
  freshIds,
  dimmed,
}: {
  nodes: RenderNode[];
  todayKey: string;
  /** People's actions today, for today's heading (older days show what's loaded). */
  todayCount: number | null;
  /** Entries that just arrived live — they flash once. */
  freshIds: Set<string>;
  dimmed: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const days = splitByDay(nodes);
  const heading = (dayKey: string) => (dayKey === "unknown" ? "ללא תאריך" : dayHeading(dayKey, todayKey));
  const count = (dayKey: string) =>
    dayKey === todayKey && todayCount !== null ? `${todayCount.toLocaleString("he-IL")} פעולות` : null;

  return (
    // The table or the list by the width there is, measured in the text's own
    // size (rem, @container): at a big text size the table's columns would
    // squeeze beside the sidebar, and there the phone's list reads better.
    <div className={cn("@container", dimmed && "opacity-60 transition-opacity")}>
      {/* Wide: a table per day. */}
      <div className="hidden space-y-4 md:@min-[44rem]:block">
        {days.map(({ dayKey, nodes: dayNodes }) => (
          // overflow-clip, not -hidden: rounds the card's corners without
          // becoming a scroll box, which would stop the header from sticking.
          <section
            key={dayKey}
            aria-label={heading(dayKey)}
            className="overflow-clip rounded-xl border border-border/60 bg-card shadow-sm"
          >
            <table className="w-full table-fixed border-separate border-spacing-0 text-start">
              <TableColumns />
              <thead className={cn("sticky z-10", STICKY_TOP)}>
                <tr>
                  <th colSpan={5} className="bg-card px-3 pb-2 pt-2.5 text-start">
                    <span className="text-sm font-semibold text-foreground">{heading(dayKey)}</span>
                    {count(dayKey) ? <span className="ms-2 text-xs font-normal text-muted-foreground">{count(dayKey)}</span> : null}
                  </th>
                </tr>
                <tr className="bg-[rgb(var(--secondary-10))] text-xs font-semibold text-foreground/80 [&>th]:border-y [&>th]:border-border/60 [&>th]:py-2">
                  <th className="ps-3" />
                  <th className="px-2 text-start">מה קרה</th>
                  <th className="px-2 text-start">פרטים ושינויים</th>
                  <th className="px-2 text-start">מי</th>
                  <th className="pe-3 ps-2 text-start">שעה</th>
                </tr>
              </thead>
              <tbody className="bg-card [&>tr:first-child>td]:border-t-0">
                {dayNodes.map((node) =>
                  node.type === "sysBatch" ? (
                    <TableSystemBatch key={node.id} node={node} expanded={expanded.has(node.id)} onToggle={() => toggle(node.id)} />
                  ) : (
                    <TableRow
                      key={nodeId(node)}
                      group={node.group}
                      fresh={freshIds.has(node.group.header.id)}
                      expanded={expanded.has(node.group.header.id)}
                      onToggle={() => toggle(node.group.header.id)}
                    />
                  )
                )}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      {/* Narrow: the list, under a heading per day that stays on screen. */}
      <div className="space-y-3 md:@min-[44rem]:hidden">
        {days.map(({ dayKey, nodes: dayNodes }) => (
          <section key={dayKey} aria-label={heading(dayKey)}>
            {/* Sticks under the top bar and the page's sticky strip (alerts,
                the phone's search row) — their live height is --page-sticky-h. */}
            <h2
              className={cn(
                "sticky z-10 -mx-1 flex items-baseline gap-2 bg-background/95 px-1 py-1.5 text-sm font-semibold text-foreground backdrop-blur supports-[backdrop-filter]:bg-background/80",
                STICKY_TOP
              )}
            >
              {heading(dayKey)}
              {count(dayKey) ? <span className="text-xs font-normal text-muted-foreground">{count(dayKey)}</span> : null}
            </h2>
            <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
              {dayNodes.map((node) =>
                node.type === "sysBatch" ? (
                  <SystemBatch key={node.id} node={node} expanded={expanded.has(node.id)} onToggle={() => toggle(node.id)} />
                ) : (
                  <Entry
                    key={nodeId(node)}
                    group={node.group}
                    fresh={freshIds.has(node.group.header.id)}
                    expanded={expanded.has(node.group.header.id)}
                    onToggle={() => toggle(node.group.header.id)}
                  />
                )
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
