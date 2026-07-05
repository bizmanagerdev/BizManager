"use client";

import { useEffect, useState } from "react";
import { NOTIF_BUCKETS } from "@/lib/notifications/categories";
import { alertNoiseVerdict, readRate, type AlertReadMetric, type AlertRuleMetric } from "@/lib/notifications/metrics";

// Hebrew labels for every system rule key (+ manual/nightly). Kept here rather
// than imported from the server rules so this stays a pure client component.
const RULE_LABEL: Record<string, string> = {
  task_overdue: "משימות באיחור",
  task_due_soon: "משימות לביצוע בקרוב",
  project_deadline: "פרויקטים לקראת דדליין",
  project_starting: "פרויקטים שמתחילים בקרוב",
  stale_quote: "הצעות מחיר ישנות",
  project_closed_unbilled: "פרויקטים סגורים ללא חיוב",
  collection_overdue: "גבייה באיחור",
  check_deposit_due: "צ׳קים לפירעון",
  payment_due_today: "תשלומים לגבייה היום",
  promise_broken: "הבטחות תשלום שהופרו",
  recurring_expense_confirm: "אישור הוצאות קבועות",
  wage_overdue: "שכר עובדים באיחור",
  session_unallocated: "שעות עבודה לשיוך",
  vehicle_expiry: "רכבים — טסט/ביטוח/רישוי",
  low_stock: "מלאי נמוך",
  unprocessed_items: "הוצאות לא מעובדות",
  nightly_review: "סקירת לילה",
  manual: "תזכורות אישיות",
};

const BUCKET_LABEL: Record<string, string> = Object.fromEntries(NOTIF_BUCKETS.map((b) => [b.key, b.label]));

const PERIODS = [7, 30, 90] as const;

function pct(n: number, d: number) {
  if (d <= 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  noisy: { label: "רועשת", cls: "border-destructive/40 text-destructive" },
  watch: { label: "לבדיקה", cls: "border-warning/40 text-warning-strong" },
  ok: { label: "תקין", cls: "border-success/40 text-success" },
};

export default function AlertMetricsPanel() {
  const [days, setDays] = useState<number>(30);
  const [rules, setRules] = useState<AlertRuleMetric[] | null>(null);
  const [read, setRead] = useState<AlertReadMetric[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/notifications/metrics?days=${days}`, { cache: "no-store" });
        const d = (res.ok ? await res.json().catch(() => null) : null) as
          | { rules?: AlertRuleMetric[]; read?: AlertReadMetric[] }
          | null;
        if (cancelled) return;
        setRules(d?.rules ?? []);
        setRead(d?.read ?? []);
      } catch {
        if (!cancelled) setRules([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="rounded-xl border bg-muted/10 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">איכות ההתראות</div>
          <div className="text-[11px] text-muted-foreground">אילו התראות עובדות ואילו רק מרעישות — לפי נתוני השימוש.</div>
        </div>
        <div className="flex rounded-lg border bg-background p-0.5 text-xs">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={`rounded-md px-2.5 py-1 transition-colors ${days === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40"}`}
            >
              {p} ימים
            </button>
          ))}
        </div>
      </div>

      {loading || rules === null ? (
        <div className="py-6 text-center text-xs text-muted-foreground">טוען נתונים…</div>
      ) : rules.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">אין מספיק נתונים בטווח שנבחר.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-right text-xs">
            <thead className="text-[11px] text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pe-2 font-medium">התראה</th>
                <th className="px-2 py-1.5 font-medium">נשלחו</th>
                <th className="px-2 py-1.5 font-medium">פתוחות</th>
                <th className="px-2 py-1.5 font-medium">נדחו</th>
                <th className="px-2 py-1.5 font-medium">נפתרו לבד</th>
                <th className="px-2 py-1.5 font-medium" title="הזמן מרגע שההתראה זוהתה ועד שנסגרה — לא זמן התגובה של המשתמש">משך עד סגירה</th>
                <th className="ps-2 py-1.5 font-medium">מצב</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((m) => {
                const v = alertNoiseVerdict(m);
                const meta = VERDICT_META[v.level];
                return (
                  <tr key={m.rule_key} className="border-b last:border-0">
                    <td className="py-2 pe-2 font-medium">{RULE_LABEL[m.rule_key] ?? m.rule_key}</td>
                    <td className="px-2 py-2 tabular-nums">{m.fired}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">{m.still_open}</td>
                    <td className="px-2 py-2 tabular-nums">{pct(m.snoozed, m.fired)}</td>
                    <td className="px-2 py-2 tabular-nums">{pct(m.resolved_unpushed, m.fired)}</td>
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {m.avg_resolve_hours != null ? `${m.avg_resolve_hours} ש׳` : "—"}
                    </td>
                    <td className="ps-2 py-2">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${meta.cls}`}
                        title={v.reasons.join(" · ") || undefined}
                      >
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {read.length > 0 ? (
        <div className="mt-3 border-t pt-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">אחוז קריאה לפי סוג (במרכז ההתראות)</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {read.map((r) => (
              <span key={r.category} className="text-muted-foreground">
                {BUCKET_LABEL[r.category] ?? r.category}:{" "}
                <span className="font-medium text-foreground">{Math.round(readRate(r) * 100)}%</span>{" "}
                <span className="text-[10px]">({r.read_count}/{r.delivered})</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
