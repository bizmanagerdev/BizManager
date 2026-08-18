"use client";

import { useState } from "react";
import Link from "next/link";
import { PaymentIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent } from "@/components/ui/card";
import DashboardCardHeader from "@/components/dashboard/DashboardCardHeader";
import DashboardCardFooter from "@/components/dashboard/DashboardCardFooter";
import QuietCard from "@/components/dashboard/QuietCard";
import { formatShortDate } from "@/lib/date";
import { formatCurrency } from "@/lib/payroll";
import { cn } from "@/lib/utils";
import type { PaymentCalendarItem } from "@/lib/payables";

const CALENDAR_HREF = "/financial/payments-calendar";

/** Two labels that say the same thing — one contained in the other, ignoring case/space. */
function sameText(a: string | null | undefined, b: string | null | undefined) {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** The calendar's own words for a stage — the card must not invent its own. */
const STAGE_LABEL: Record<string, string> = {
  pending: "ממתין",
  scheduled: "צפוי",
};

/** …and its colours: status is never blue here, צפוי is slate (design rule). */
const STAGE_DOT: Record<string, string> = {
  pending: "bg-warning",
  scheduled: "bg-muted-foreground/60",
};

export type PaymentsSummary = {
  /** Today's payments — the card's headline, whether or not there are any. */
  today: PaymentCalendarItem[];
  todayTotal: number;
  /**
   * The days after today whose own heads-up has opened — each payment carries
   * its own "remind me N work-days before", and only the ones already inside
   * that window are on the card. Everything further out is on the calendar.
   */
  upcoming: PaymentCalendarItem[];
  upcomingTotal: number;
  /** Still unpaid with the date already past. */
  late: PaymentCalendarItem[];
  lateCount: number;
  lateTotal: number;
};

/** A variable-amount forecast has no number yet — the calendar says so in words. */
function amountLabel(item: PaymentCalendarItem) {
  return item.variableAmount && item.amount === 0 ? "משתנה" : formatCurrency(item.amount);
}

/**
 * One payment, built exactly like a delivery row: full-bleed, hairline-separated,
 * an overlay link over the whole row, two lines of text and the number in the
 * corner. Same rules as there — the name TRUNCATES rather than wrapping, because
 * a two-line name makes its row taller than its neighbours and a column of rows
 * that don't line up reads as broken (the full text is in the title attribute).
 */
function PaymentRow({ item, late }: { item: PaymentCalendarItem; late?: boolean }) {
  // Where it came from, but only when that ISN'T what the title already says. A
  // recurring expense names the row from its description and labels its source
  // with the same words, so the row read "החזר הלוואה … · החזר הלוואה …".
  const source = sameText(item.sourceLabel, item.label) ? "" : item.sourceLabel;
  return (
    <li className="relative px-4 py-3 transition-colors hover:bg-secondary/10">
      {item.sourceHref ? (
        <Link
          href={item.sourceHref}
          aria-label={item.label}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="truncate text-sm font-medium" title={item.label}>
            {item.label}
          </div>
          <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                late ? "bg-destructive" : STAGE_DOT[item.stage]
              )}
            />
            <span className="truncate">
              {late ? "באיחור" : STAGE_LABEL[item.stage] ?? ""}
              {" · "}
              {formatShortDate(item.date)}
              {source ? ` · ${source}` : ""}
            </span>
          </div>
        </div>
        <div
          className={cn(
            "shrink-0 text-sm font-semibold tabular-nums",
            late ? "text-destructive" : "text-foreground"
          )}
        >
          {amountLabel(item)}
        </div>
      </div>
    </li>
  );
}

/**
 * "תשלומים קרובים" — the payments calendar as a card, in the calendar's own terms
 * (באיחור / ממתין / צפוי) so the two never say different things about the same
 * payment.
 *
 * TODAY IS THE HEADLINE, at the top, whether or not there is anything — and when
 * there isn't it says so in the same green line the "היום" card uses, since the
 * two sit on the same board answering about the same day.
 *
 * Under it, the two figures worth knowing — what's alerting ahead and what's
 * late — are the SWITCH between the two lists, not just labels: whichever you
 * press is the list underneath. "Alerting" is each payment's own setting, not a
 * window this card picked: a bill set to warn five work-days ahead appears five
 * work-days ahead, one set to warn the day before appears the day before.
 */
export default function UpcomingPayments({ summary }: { summary: PaymentsSummary }) {
  const { today, todayTotal, upcoming, upcomingTotal, late, lateCount, lateTotal } = summary;
  // Late is the louder of the two, so it opens on the list that has something —
  // but never jumps you to an empty tab.
  const [tab, setTab] = useState<"upcoming" | "late">(upcoming.length > 0 || lateCount === 0 ? "upcoming" : "late");

  if (today.length === 0 && upcoming.length === 0 && lateCount === 0) {
    return (
      <QuietCard icon={PaymentIcon} title="תשלומים קרובים" note="אין תשלומים בקרוב" href={CALENDAR_HREF} />
    );
  }

  const rows = tab === "late" ? late : upcoming;

  return (
    // Card → the calendar, each row → the expense it came from. Overlay link, so
    // the rows and the switch can carry their own clicks (see UpcomingDeliveries).
    <Card className="relative flex h-full flex-col">
      <Link
        href={CALENDAR_HREF}
        aria-label="ללוח התשלומים"
        className="absolute inset-0 rounded-[1.125rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
        <DashboardCardHeader icon={PaymentIcon} title="תשלומים קרובים" />

        {/* p-0, like the deliveries card: the rows run edge to edge and carry
            their own padding, so the hairlines between them span the card. */}
        <CardContent className="pointer-events-auto min-h-0 flex-1 overflow-y-auto p-0">
          {/* ── היום ─────────────────────────────────────────────────────── */}
          <section>
            {/* Only over a list. With nothing today the green line below already
                says so in words — a "היום" heading above it just says it twice.
                Not warning-orange either: today is the subject, not an alarm. */}
            {today.length > 0 ? (
              <div className="px-4 pt-2 text-xs font-semibold text-muted-foreground">
                היום · {formatCurrency(todayTotal)}
              </div>
            ) : null}
            {today.length > 0 ? (
              <ul className="divide-y">
                {today.map((item) => (
                  <PaymentRow key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              // The SAME green line the "היום" card uses for an empty day — the
              // two cards answer the same question about the same day, so a
              // reader shouldn't have to learn two ways of being told "nothing".
              <div className="m-3 inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success-soft px-2.5 py-1 text-xs">
                <SuccessIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                <span className="text-success-soft-foreground">אין תשלומים להיום</span>
              </div>
            )}
          </section>

          {/* ── The switch: two figures, and the list follows the one you press ── */}
          {upcoming.length > 0 || lateCount > 0 ? (
            <div className="border-t border-border/50">
              <div className="flex flex-wrap items-center gap-2 px-4 py-2">
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
                  צפוי {upcoming.length}
                  <span className="tabular-nums">· {formatCurrency(upcomingTotal)}</span>
                </button>

                {lateCount > 0 ? (
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
                    באיחור {lateCount}
                    <span className="tabular-nums">· {formatCurrency(lateTotal)}</span>
                  </button>
                ) : null}
              </div>

              {rows.length > 0 ? (
                <ul className="divide-y border-t border-border/50">
                  {rows.map((item) => (
                    <PaymentRow key={item.id} item={item} late={tab === "late"} />
                  ))}
                </ul>
              ) : (
                <p className="px-4 pb-3 text-sm text-muted-foreground">
                  {tab === "late" ? "אין תשלומים באיחור." : "אין תשלומים שמתריעים כעת."}
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
        <DashboardCardFooter href={CALENDAR_HREF} label="כל התשלומים" />
      </div>
    </Card>
  );
}
