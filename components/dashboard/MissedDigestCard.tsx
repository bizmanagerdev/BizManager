"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AiIcon, ChevronDownIcon, CloseIcon } from "@/components/ui/icons";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import { Button } from "@/components/ui/button";
import { formatShortDateTime } from "@/lib/date";
import { groupAuditFeedItems, type AuditFeedItem } from "@/lib/audit";
import { cn } from "@/lib/utils";
import { withViewTransition } from "@/lib/ui/view-transition";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

// Tables that feed the digest — a relative realtime INSERT triggers a refetch
// (the server re-applies role + since-anchor + exclude-self filtering).
const DIGEST_TABLES = new Set([
  "orders",
  "projects",
  "customers",
  "payments",
  "expenses",
  "worker_payments",
  "attendance_sessions",
  "users",
  "accounts",
]);

// Section label + display order per entity type.
function typeLabel(locale: Locale): Record<string, string> {
  return {
    orders: t(dashboardDict, locale, "digestTypeOrders"),
    projects: t(dashboardDict, locale, "digestTypeProjects"),
    customers: t(dashboardDict, locale, "digestTypeCustomers"),
    payments: t(dashboardDict, locale, "digestTypePayments"),
    expenses: t(dashboardDict, locale, "digestTypeExpenses"),
    attendance_sessions: t(dashboardDict, locale, "digestTypeAttendance"),
    worker_payments: t(dashboardDict, locale, "digestTypeWorkerPayments"),
    accounts: t(dashboardDict, locale, "digestTypeAccounts"),
    users: t(dashboardDict, locale, "digestTypeUsers"),
  };
}
const TYPE_ORDER = ["orders", "projects", "customers", "payments", "expenses", "attendance_sessions", "worker_payments", "accounts", "users"];

/** One changed topic: its table name and the rows that changed under it. */
type TypeBucket = [type: string, rows: AuditFeedItem[]];

/**
 * The digest, always the first SECONDARY card when it has anything to show — the
 * board pins it right after "היום" (see DashboardSections). It doesn't size
 * itself any more: like every other card, it just fills whatever cell the board
 * gave it (see the shared `Cell` there).
 *
 * Renders NULL when there's nothing missed (the common case) or once dismissed.
 * The component stays mounted either way — on an unplanned board (nothing
 * missed at request time) that's what lets its realtime subscription notice new
 * activity and ask the board to replan itself around it (see refetch below),
 * rather than trying to draw a card the layout never made room for.
 */
export default function MissedDigestCell({
  initialItems,
  planned = false,
  locale,
}: {
  initialItems: AuditFeedItem[];
  /** The board already gave this card a cell — render into it, don't make one. */
  planned?: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const [items, setItems] = useState<AuditFeedItem[]>(initialItems);
  const [dismissed, setDismissed] = useState(false);
  // Which topics are expanded — none to begin with, so the card lands compact.
  const [openTopics, setOpenTopics] = useState<Set<string>>(() => new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fold cascades (order + its items/payment → one row), then bucket by type.
  const typed = useMemo<TypeBucket[]>(() => {
    const byType = new Map<string, AuditFeedItem[]>();
    for (const g of groupAuditFeedItems(items)) {
      const t = g.header.tableName;
      const arr = byType.get(t) ?? [];
      arr.push(g.header);
      byType.set(t, arr);
    }
    return [...byType.entries()].sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a[0]);
      const bi = TYPE_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [items]);

  const total = useMemo(() => typed.reduce((n, [, rows]) => n + rows.length, 0), [typed]);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/digest", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: AuditFeedItem[] };
      if (!res.ok || !Array.isArray(json.items)) return;
      if (planned) {
        // The board already reserved this card's tier — just refresh what it
        // shows, in place.
        setItems(json.items);
        return;
      }
      // UNPLANNED: the board's hero/secondary/tertiary tiers were laid out
      // assuming this card had nothing to say, so there's no cell for it to draw
      // itself into. Rather than invent one client-side (and get it wrong —
      // there's no telling from here whether the right slot is even still free),
      // let the server replan the whole board with this card included. Same fix
      // as dismiss, same reason.
      if (json.items.length > 0) router.refresh();
    } catch {
      // ignore transient errors
    }
  }, [planned, router]);

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
        .channel("dashboard-digest")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, (payload) => {
          const row = payload.new as { table_name?: string } | null;
          if (!row?.table_name || !DIGEST_TABLES.has(row.table_name)) return;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => void refetch(), 1500);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [refetch]);

  const toggleTopic = useCallback((type: string) => {
    // Opening a topic makes this card taller, which pushes the cards under it
    // down the column — animated, that reads as the consequence of the click.
    withViewTransition(() =>
      setOpenTopics((prev) => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      })
    );
  }, []);

  const dismiss = useCallback(async () => {
    // The card leaves the board entirely and everything after it packs up into
    // the hole. This is the repack worth animating — it's instant, local, and
    // doesn't wait on the network.
    withViewTransition(() => setDismissed(true));
    try {
      await fetch("/api/dashboard/digest/dismiss", { method: "POST" });
      // The board's COLUMN layout — how many columns, and which cards share
      // which one — was planned server-side around this card occupying a cell.
      // Hiding it via local state lets its own column's siblings grow into the
      // gap (plain CSS), but a column where this was the ONLY card is left
      // empty until the board is replanned without it. router.refresh() re-runs
      // DashboardPanels so that happens right away instead of on the next
      // manual reload — the bug this fixed (user, 2026-08-19).
      router.refresh();
    } catch {
      // Best-effort, and deliberately NOT refreshed on failure: if the anchor
      // didn't move, the server still sees this activity as unseen and a
      // refresh would bring the card right back — worse than just leaving the
      // optimistic dismiss in place until the next real reload.
    }
  }, [router]);

  // Total===0 covers BOTH real cases: nothing missed, and — for an unplanned
  // instance — live activity that arrived and triggered a refresh instead of
  // being drawn here (see refetch above). Either way there's nothing to render;
  // sizing is entirely the parent Cell's business now, not this component's.
  if (dismissed || total === 0) return null;

  return (
    <MissedDigestCard
      typed={typed}
      total={total}
      open={openTopics}
      onToggleTopic={toggleTopic}
      onDismiss={dismiss}
      locale={locale}
    />
  );
}


/**
 * "פעילות חדשה" — every changed record, grouped by topic, ALL OPEN (user,
 * 2026-08-17: "it should all be open"). There is no collapsed/expanded mode any
 * more and no "פירוט" toggle: the card is two rows tall, so the names fit, and a
 * digest you have to open to read is one you don't read. The list scrolls inside
 * the card rather than making it taller than its cell.
 *
 * Wears the shared DashboardCardHeader like every other card — it's a sibling
 * of them, not a mini-widget with its own vocabulary. Dismissing advances the
 * server anchor.
 */
function MissedDigestCard({
  typed,
  total,
  open,
  onToggleTopic,
  onDismiss,
  locale,
}: {
  typed: TypeBucket[];
  total: number;
  /** Which topics are expanded. Empty = the compact default. */
  open: Set<string>;
  onToggleTopic: (type: string) => void;
  onDismiss: () => void;
  locale: Locale;
}) {
  const TYPE_LABEL = typeLabel(locale);
  return (
    // Card → the full activity feed, each line → the record it's about. The
    // card's link is a full-bleed overlay rather than a wrapper: the lines carry
    // their own links and the header a dismiss button, and neither is legal
    // inside an <a>. Everything else falls through to the overlay.
    <Card className="relative flex h-full flex-col">
      <Link
        href="/activity"
        aria-label={t(dashboardDict, locale, "digestAria")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
      <DashboardCardHeader
        icon={AiIcon}
        title={t(dashboardDict, locale, "digestCardTitle")}
        count={total}
        action={
          <Button
            variant="ghost"
            size="icon-sm"
            className="pointer-events-auto -me-1 -mt-1"
            onClick={onDismiss}
            aria-label={t(dashboardDict, locale, "markReadLabel")}
            title={t(dashboardDict, locale, "markReadLabel")}
          >
            <CloseIcon />
          </Button>
        }
      />
      {/* One column: the card is a quarter of the board wide, and two columns of
          names in that width wrap every line. */}
      {/* pt-4: CardContent's base is `p-6 pt-0`, so the first topic heading sat
          flush under the card header's rule — the word pinned between two lines
          with nothing above it. */}
      {/* The board's list style: p-0 content, rows that run edge to edge and
          carry their own padding, hairlines between them — same as the deliveries
          and payments cards. Here a topic heading is a row too (it's the toggle),
          so the whole card reads as one column of lines. */}
      <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
        <ul className="divide-y">
          {typed.map(([type, rows]) => {
            const isOpen = open.has(type);
            return (
              <li key={type} className="min-w-0">
                {/* The heading IS the toggle. Collapsed by default, so the card
                    opens as a short list of "what changed and how much" and you
                    open only the topic you care about — with five topics the
                    names ran well past the card's share of the board. */}
                <button
                  type="button"
                  onClick={() => onToggleTopic(type)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary/10 hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={cn("h-4 w-4 shrink-0 transition-transform", isOpen ? "rotate-0" : "rotate-90")}
                  />
                  <span>{TYPE_LABEL[type] ?? type}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    {rows.length}
                  </span>
                </button>

                {isOpen ? (
                  <ul className="divide-y border-t border-border/40">
                    {rows.map((it) => {
                      const label = it.title || it.summary;
                      const when = it.createdAt ? formatShortDateTime(it.createdAt, "-") : "";
                      const meta = [it.actorName, when].filter(Boolean).join(" · ");
                      return (
                        <li
                          key={it.id}
                          className="relative bg-muted/20 px-4 py-3 transition-colors hover:bg-secondary/10"
                        >
                          {/* Covers the row, so the whole line is the target. */}
                          {it.href ? (
                            <Link
                              href={it.href}
                              aria-label={label}
                              className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          ) : null}
                          <div className="min-w-0 space-y-0.5">
                            {/* Truncates like the delivery rows: a two-line name
                                makes its row taller than its neighbours. */}
                            <div className="truncate text-sm font-medium" title={label}>
                              {label}
                            </div>
                            {meta ? <div className="truncate text-xs text-muted-foreground">{meta}</div> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
      <DashboardCardFooter href="/activity" label={t(dashboardDict, locale, "digestFooterLabel")} count={total} />
      </div>
    </Card>
  );
}
