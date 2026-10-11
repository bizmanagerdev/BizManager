"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CoinsIcon, SuccessIcon } from "@/components/ui/icons";
import { CallIconButton } from "@/components/ui/contact-link";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/payroll";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { BOARD_CARD_BODY_CLASS, BOARD_ROW_CLASS, BOARD_ROW_MAIN_CLASS } from "@/lib/dashboard/widgets";
import { CountBadge } from "@/components/ui/count-badge";
import { TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import type { CollectionsDebtor, CollectionsSummary } from "@/lib/collections";
import { scheduleDeferredAction } from "@/lib/undo-engine";
import { t } from "@/lib/i18n/t";
import { dashboardDict } from "@/lib/i18n/dictionaries/dashboard";
import type { Locale } from "@/lib/i18n/types";
import { offlineFetch } from "@/lib/offline-queue";

const COLLECTIONS_HREF = "/collections";

/** How many rows either side of the switch ever draws. The footer counts the rest. */
const SHOWN_LIMIT = 8;

/** The pressed switch: the app's one toggle look (components/ui/filter-chip.tsx). */
const SWITCH_ON = `${TOGGLE_ON} hover:bg-secondary/90`;

/** The count's own "active" pill turns white on the pressed (blue) chip. */
function switchCountClass(on: boolean) {
  return on ? "bg-secondary-foreground text-secondary" : undefined;
}

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
  const [, startTransition] = useTransition();
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
        // Through the send queue: with no signal it waits for the connection
        // instead of coming back after the toast said "נגבה".
        const result = await offlineFetch("/api/payments/mark-collected", { id, collected: true }, "סימון התשלום כנגבה");
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, t(dashboardDict, locale, "markCollectedError")) };
        }
        if (!result.queued) startTransition(() => { router.refresh(); });
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
        className="absolute inset-0 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        {/* The same number as the footer's link, like every other card (owner,
            2026-10-11) — the overdue part is already its own red pill below. */}
        <DashboardCardHeader
          icon={CoinsIcon}
          title={t(dashboardDict, locale, "collectionsCardTitle")}
          count={summary.lateCount + summary.upcomingCount}
        />

        <CardContent className={cn("pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0", BOARD_CARD_BODY_CLASS)}>
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
                    <div className={BOARD_ROW_CLASS}>
                      <div className={BOARD_ROW_MAIN_CLASS}>
                        {/* Wraps on a phone and a tablet — the never-truncate rule (only
                            the deliveries card cuts with "…", see UpcomingDeliveries): with
                            a bigger text size a cut name lost most of itself, and a cut
                            phone number its first digits. On the one-page board (xl) the
                            row is narrow and everything must fit one screen, so there it
                            still cuts, with the whole name on hover. */}
                        <div className="text-sm font-medium xl:truncate" title={payment.customer_name}>
                          {payment.customer_name}
                        </div>
                        <div className="text-xs text-muted-foreground xl:truncate">
                          {formatCurrency(payment.amount)}
                          {payment.check_number ? ` · ${t(dashboardDict, locale, "checkAbbrev")} ${payment.check_number}` : ""}
                          {payment.customer_phone ? ` · ${payment.customer_phone}` : ""}
                        </div>
                      </div>
                      <div className="relative flex shrink-0 items-center gap-1.5">
                        {/* The number above stays text; this is how you ring them
                            — the app's one call button, as on the debtor rows
                            below (owner, 2026-10-11: one look for calling). The
                            row had the number and no way to call it. */}
                        {payment.customer_phone ? (
                          <CallIconButton phone={payment.customer_phone} name={payment.customer_name} />
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 px-3 text-sm max-md:min-h-[44px]"
                          onClick={() => markCollected(payment.id)}
                          title={t(dashboardDict, locale, "markCollectedTitle")}
                        >
                          {t(dashboardDict, locale, "collectedButtonLabel")}
                        </Button>
                      </div>
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
              {/* In a narrow card (BOARD_ROW_CLASS) each switch's amount goes under its label.
                  The pressed one is the app's one toggle look — blue, white text
                  (owner, 2026-10-11: "all the toggles should be blue"); it was a tint with
                  a ring. באיחור keeps its red dot, and its red words while it's
                  not the one pressed. */}
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
                {summary.lateCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTab("late")}
                    aria-pressed={tab === "late"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold @max-[17rem]:flex-wrap @max-[17rem]:gap-y-0.5 transition-colors",
                      tab === "late" ? SWITCH_ON : "text-destructive hover:bg-accent/60"
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                    {t(dashboardDict, locale, "lateLabel")}
                    <CountBadge count={summary.lateCount} active={tab === "late"} className={switchCountClass(tab === "late")} />
                    <span className="tabular-nums">
                      <span className="@max-[17rem]:hidden">· </span>
                      {formatCurrency(summary.lateTotal)}
                    </span>
                  </button>
                ) : null}

                {summary.upcomingCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTab("upcoming")}
                    aria-pressed={tab === "upcoming"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold @max-[17rem]:flex-wrap @max-[17rem]:gap-y-0.5 transition-colors",
                      tab === "upcoming" ? SWITCH_ON : TOGGLE_OFF
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        tab === "upcoming" ? "bg-secondary-foreground/70" : "bg-muted-foreground/60"
                      )}
                    />
                    {t(dashboardDict, locale, "stageScheduled")}
                    <CountBadge count={summary.upcomingCount} active={tab === "upcoming"} className={switchCountClass(tab === "upcoming")} />
                    <span className="tabular-nums">
                      <span className="@max-[17rem]:hidden">· </span>
                      {formatCurrency(summary.upcomingTotal)}
                    </span>
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

      <div className={BOARD_ROW_CLASS}>
        <div className={BOARD_ROW_MAIN_CLASS}>
          {/* Wraps below the one-page board, cuts on it (see the today rows above). */}
          <div className="text-sm font-medium xl:truncate" title={debtor.customerName}>
            {debtor.customerName}
          </div>
          <div className="text-xs text-muted-foreground xl:truncate" title={meta}>
            {meta}
          </div>
        </div>

        <div className="relative flex shrink-0 items-center gap-1.5">
          {/* The app's one call button (contact-link.tsx), as on every card. */}
          {debtor.customerPhone ? <CallIconButton phone={debtor.customerPhone} name={debtor.customerName} /> : null}
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
