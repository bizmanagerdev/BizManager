"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoinsIcon, PhoneIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import type { CollectionsDebtor, CollectionsSummary } from "@/lib/collections";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";

const COLLECTIONS_HREF = "/collections";

/** How many rows either side of the switch ever draws. The footer counts the rest. */
const SHOWN_LIMIT = 8;

/**
 * "גבייה" — money coming IN, built as the mirror of "תשלומים קרובים", which is
 * the same question pointing the other way. Same three parts, same order, so a
 * reader who has learned one has learned both:
 *
 *   1. TODAY — dated payments landing today, each with the one-click "נגבה".
 *      This is the only part of collections that is genuinely one action.
 *   2. The SWITCH — באיחור (n · ₪) / צפוי (n · ₪) — which is also the choice of
 *      list underneath, not a pair of labels.
 *   3. The list, WORST FIRST: the oldest debt is the one that stops being
 *      collectable, so it sorts by days late, not by size.
 *
 * A debtor row's action is NOT "נגבה" — nothing has arrived to mark. It's a call,
 * so the row carries a phone glyph and leads to the customer, where the calls and
 * reminders live. The aging chart (שוטף / 30 / 60 / 90+) deliberately isn't here:
 * four buckets tell you the shape of the problem, and the board's job is to tell
 * you the next move. That belongs on /collections, where it already is.
 */
export default function CollectionsCard({ summary, locale }: { summary: CollectionsSummary; locale: Locale }) {
  const router = useRouter();
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set());
  // Late is the louder of the two, so it opens on the list that has something —
  // but never jumps you to an empty tab.
  const [tab, setTab] = useState<"late" | "upcoming">(
    summary.lateCount > 0 || summary.upcomingCount === 0 ? "late" : "upcoming"
  );

  const today = summary.today.filter((p) => !collectedIds.has(p.id));

  if (today.length === 0 && summary.lateCount === 0 && summary.upcomingCount === 0) {
    return (
      <QuietCard
        icon={CoinsIcon}
        title={t(dashboardDict, locale, "collectionsCardTitle")}
        note={t(dashboardDict, locale, "collectionsEmptyNote")}
        href={COLLECTIONS_HREF}
      />
    );
  }

  const rows = tab === "late" ? summary.late : summary.upcoming;

  function markCollected(id: string) {
    scheduleDeferredAction({
      key: `collections:collected:${id}`,
      message: t(dashboardDict, locale, "markCollectedSuccess"),
      // Optimistic: the row leaves the card now, and the server is asked for the
      // truth in the background.
      onApplyOptimistic: () => setCollectedIds((prev) => new Set(prev).add(id)),
      onRevert: () =>
        setCollectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      onCommit: async () => {
        const res = await fetch("/api/payments/mark-collected", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, collected: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return { ok: false, error: toHebrewError(json.error, t(dashboardDict, locale, "markCollectedError")) };
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    // Card → the collections worklist, each row → its customer. Overlay link, so
    // the rows and the switch keep their own clicks (see UpcomingDeliveries).
    <Card className="relative flex h-full flex-col">
      <Link
        href={COLLECTIONS_HREF}
        aria-label={t(dashboardDict, locale, "collectionsAria")}
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader icon={CoinsIcon} title={t(dashboardDict, locale, "collectionsCardTitle")} count={summary.lateCount} />

        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          {/* ── היום — the only rows you can finish from here ─────────────── */}
          {/* Always present, like the payments card's: with nothing due today the
              card was jumping straight to the באיחור/צפוי switch, and "so is
              anything due today?" went unanswered rather than answered "no". The
              heading only sits over a LIST — the green line below says it in
              words, so a "לגבייה היום" heading above it would say it twice. */}
          <section>
            {today.length > 0 ? (
              <div className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                {t(dashboardDict, locale, "collectingTodayLabel")} · {formatCurrency(summary.todayTotal)}
              </div>
            ) : null}
            {today.length > 0 ? (
              <ul className="divide-y">
                {today.map((payment) => (
                  <li key={payment.id} className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
                    {payment.customer_id ? (
                      <Link
                        href={`/customers/${payment.customer_id}`}
                        aria-label={payment.customer_name}
                        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : null}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="truncate text-sm font-medium" title={payment.customer_name}>
                          {payment.customer_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {formatCurrency(payment.amount)}
                          {payment.check_number ? ` · ${t(dashboardDict, locale, "checkAbbrev")} ${payment.check_number}` : ""}
                          {payment.customer_phone ? ` · ${payment.customer_phone}` : ""}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="relative h-8 shrink-0 px-3 text-sm max-md:min-h-[44px]"
                        onClick={() => markCollected(payment.id)}
                        title={t(dashboardDict, locale, "markCollectedTitle")}
                      >
                        {t(dashboardDict, locale, "collectedButtonLabel")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              // The SAME green line as the payments card and the "היום" card:
              // three cards answer a question about the same day, so a reader
              // shouldn't have to learn three ways of being told "nothing".
              <div className="m-3 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-2.5 py-1 text-xs">
                <SuccessIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-success-soft-foreground">{t(dashboardDict, locale, "noCollectionsToday")}</span>
              </div>
            )}
          </section>

          {/* ── The switch, and the list it chooses ───────────────────────── */}
          {summary.lateCount > 0 || summary.upcomingCount > 0 ? (
            <div className="border-t border-border/50">
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                {summary.lateCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTab("late")}
                    aria-pressed={tab === "late"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-destructive transition-colors",
                      tab === "late"
                        ? "bg-destructive/20 ring-1 ring-destructive/40"
                        : "bg-destructive/10 hover:bg-destructive/15"
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                    {t(dashboardDict, locale, "lateLabel")} {summary.lateCount}
                    <span className="tabular-nums">· {formatCurrency(summary.lateTotal)}</span>
                  </button>
                ) : null}

                {summary.upcomingCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTab("upcoming")}
                    aria-pressed={tab === "upcoming"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold transition-colors",
                      tab === "upcoming"
                        ? "bg-secondary/15 text-foreground ring-1 ring-secondary/40"
                        : "bg-muted text-muted-foreground hover:bg-secondary/10"
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
                    {t(dashboardDict, locale, "stageScheduled")} {summary.upcomingCount}
                    <span className="tabular-nums">· {formatCurrency(summary.upcomingTotal)}</span>
                  </button>
                ) : null}
              </div>

              {rows.length > 0 ? (
                <ul className="board-list divide-y">
                  {rows.slice(0, SHOWN_LIMIT).map((debtor) => (
                    <DebtorRow
                      key={`${tab}-${debtor.customerId ?? debtor.customerName}`}
                      debtor={debtor}
                      late={tab === "late"}
                      locale={locale}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>

        <DashboardCardFooter
          href={COLLECTIONS_HREF}
          label={t(dashboardDict, locale, "collectionsFooterLabel")}
          count={summary.lateCount + summary.upcomingCount}
        />
      </div>
    </Card>
  );
}

/**
 * One customer who owes money. Same shape as a delivery row — overlay link, two
 * lines, the number in the corner — with the phone as a glyph beside it: the
 * action on a debt isn't to tick it off, it's to ring them.
 */
function DebtorRow({ debtor, late, locale }: { debtor: CollectionsDebtor; late: boolean; locale: Locale }) {
  const href = debtor.customerId ? `/customers/${debtor.customerId}` : COLLECTIONS_HREF;
  const meta = [
    late && debtor.daysLate > 0
      ? `${debtor.daysLate} ${t(dashboardDict, locale, "daysLateSuffix")}`
      : late
        ? t(dashboardDict, locale, "lateLabel")
        : t(dashboardDict, locale, "stageScheduled"),
    debtor.sources > 1 ? `${debtor.sources} ${t(dashboardDict, locale, "sourcesCountSuffix")}` : null,
    debtor.customerPhone,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
      <Link
        href={href}
        aria-label={debtor.customerName}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="truncate text-sm font-medium" title={debtor.customerName}>
            {debtor.customerName}
          </div>
          <div className="truncate text-xs text-muted-foreground" title={meta}>
            {meta}
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-1.5">
          {debtor.customerPhone ? (
            <Button
              asChild
              variant="ghost"
              className="h-8 w-8 p-0 shadow-none max-md:min-h-[44px] max-md:min-w-[44px]"
              title={`${t(dashboardDict, locale, "callPrefix")}${debtor.customerName}`}
            >
              <a href={`tel:${debtor.customerPhone}`} aria-label={`${t(dashboardDict, locale, "callPrefix")}${debtor.customerName}`}>
                <PhoneIcon className="h-4 w-4" />
              </a>
            </Button>
          ) : null}
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              late ? "text-destructive" : "text-foreground"
            )}
          >
            {formatCurrency(debtor.amount)}
          </span>
        </div>
      </div>
    </li>
  );
}
