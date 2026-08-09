import Link from "next/link";
import { ChevronLeftIcon, SuccessIcon } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inboxOrigin, type InboxView, type WorklistSeverity } from "@/lib/reminders/worklist";

// The morning landing. Whether or not the daily summary push was seen, this is
// the first thing on the dashboard: what needs you, today. It reads the SAME
// inbox model as the bell and /inbox, so all three always agree.
//
// Replaces the old "התראות" + "תזכורות" widgets, which were two views of one
// list and left no single place to look.

const DOT: Record<WorklistSeverity, string> = {
  danger: "bg-destructive",
  warning: "bg-warning",
  info: "bg-muted-foreground/40",
};

function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function TodayCard({ inbox }: { inbox: InboxView }) {
  const total = inbox.items.length + inbox.summaries.length;
  // Show a scannable head of the list; the rest is one tap away.
  const shown = inbox.items.slice(0, 6);
  const rest = total - shown.length - inbox.summaries.length;

  const today = new Intl.DateTimeFormat("he-IL", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div>
          <CardTitle className="text-lg">היום</CardTitle>
          <p className="text-xs text-muted-foreground">{today}</p>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/inbox">
            {total > 0 ? `${total} ממתינים` : "התיבה"}
          </Link>
        </Button>
      </CardHeader>

      <CardContent className="space-y-1.5">
        {total === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success-soft px-3 py-3 text-sm">
            <SuccessIcon className="h-4 w-4 shrink-0 text-success" />
            <span className="text-success-soft-foreground">אין מה לטפל היום.</span>
          </div>
        ) : null}

        {shown.map((item) => {
          const mine = inboxOrigin(item) === "mine";
          return (
            <Link
              key={item.id}
              href={item.url}
              className="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[item.severity] ?? DOT.info)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("rounded px-1 py-px", mine ? "bg-primary/10 text-primary" : "bg-muted")}>
                    {mine ? "שלי" : "אוטומטי"}
                  </span>
                  {mine && item.remindAt ? <span>{fmtTime(item.remindAt)}</span> : null}
                  {item.customerName ? <span>· {item.customerName}</span> : null}
                </span>
              </span>
              <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}

        {inbox.summaries.map((s) => (
          <Link
            key={s.id}
            href={s.href}
            className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[s.severity] ?? DOT.info)} />
              <span className="text-sm font-medium">{s.title}</span>
            </span>
            <ChevronLeftIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}

        {rest > 0 ? (
          <Link href="/inbox" className="block px-1 pt-1 text-xs text-muted-foreground hover:underline">
            ועוד {rest} בתיבה
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
