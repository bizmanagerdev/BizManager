"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, Phone, CalendarDays, MessageCircle, Mail, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatShortDate } from "@/lib/date";
import { actionTypeLabel, type Reminder } from "@/lib/communications";

const ACTION_ICON: Record<string, LucideIcon> = {
  call: Phone,
  meeting: CalendarDays,
  whatsapp: MessageCircle,
  email: Mail,
};

function timePart(value: string) {
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match ? match[1] : null;
}

type GroupKey = "overdue" | "today" | "tomorrow" | "week";

const GROUP_LABEL: Record<GroupKey, string> = {
  overdue: "באיחור",
  today: "היום",
  tomorrow: "מחר",
  week: "השבוע",
};

export default function RemindersPanel({ reminders: initial }: { reminders: Reminder[] }) {
  const router = useRouter();
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const reminders = useMemo(() => initial.filter((r) => !doneIds.has(r.id)), [initial, doneIds]);

  const groups = useMemo(() => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const tomorrowIso = new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10);
    const weekEndIso = new Date(today.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

    const buckets: Record<GroupKey, Reminder[]> = { overdue: [], today: [], tomorrow: [], week: [] };
    for (const r of reminders) {
      const day = r.remind_at.slice(0, 10);
      if (day < todayIso) buckets.overdue.push(r);
      else if (day === todayIso) buckets.today.push(r);
      else if (day === tomorrowIso) buckets.tomorrow.push(r);
      else if (day <= weekEndIso) buckets.week.push(r);
    }
    return buckets;
  }, [reminders]);

  const orderedGroups = (["overdue", "today", "tomorrow", "week"] as GroupKey[]).filter(
    (key) => groups[key].length > 0
  );

  if (orderedGroups.length === 0) return null;

  async function markDone(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/reminders/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, status: "done" }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "הפעולה נכשלה.");
        return;
      }
      setDoneIds((prev) => new Set(prev).add(id));
      toast.success("התזכורת סומנה כבוצעה.");
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "הפעולה נכשלה.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">תזכורות</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {orderedGroups.map((groupKey) => (
          <div key={groupKey} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-muted-foreground">{GROUP_LABEL[groupKey]}</span>
              <Badge variant="neutral" className="text-[10px]">
                {groups[groupKey].length}
              </Badge>
            </div>
            {groups[groupKey].map((r) => {
              const Icon = ACTION_ICON[r.action_type] ?? Bell;
              const time = timePart(r.remind_at);
              return (
                <div
                  key={r.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-2.5",
                    groupKey === "overdue" && "border-destructive/30"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        {r.customer_id ? (
                          <Link href={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                            {r.customer_name ?? "לקוח"}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.customer_name ?? "כללי"}</span>
                        )}
                        <span className="text-muted-foreground">{actionTypeLabel(r.action_type)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {r.content ? <span className="truncate">{r.content}</span> : null}
                        {r.customer_phone ? (
                          <a href={`tel:${r.customer_phone}`} className="hover:underline">
                            ☎ {r.customer_phone}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {time ?? formatShortDate(r.remind_at)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={busyId === r.id}
                      onClick={() => void markDone(r.id)}
                    >
                      בוצע
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
