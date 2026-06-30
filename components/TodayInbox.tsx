"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, ListTodo, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/date";
import { actionTypeLabel } from "@/lib/communications";
import { paymentMethodLabel } from "@/lib/orders/paymentStatus";
import type { TodayInboxData } from "@/lib/today-inbox";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// One unified "today" digest: my open tasks due, my reminders due, and (for
// back-office) payments to collect — each with an inline action. Optimistically
// hides a row on success and refreshes for source-of-truth.
export default function TodayInbox({ data }: { data: TodayInboxData }) {
  const router = useRouter();
  const [doneTaskIds, setDoneTaskIds] = useState<Set<string>>(() => new Set());
  const [doneReminderIds, setDoneReminderIds] = useState<Set<string>>(() => new Set());
  const [collectedIds, setCollectedIds] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasks = data.tasks.filter((t) => !doneTaskIds.has(t.id));
  const reminders = data.reminders.filter((r) => !doneReminderIds.has(r.id));
  const payments = data.payments.filter((p) => !collectedIds.has(p.id));
  const total = tasks.length + reminders.length + payments.length;

  if (total === 0) return null;

  const today = todayIso();

  async function act(
    id: string,
    url: string,
    body: Record<string, unknown>,
    onSuccess: () => void,
    successMsg: string
  ) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(toHebrewError(json.error, "הפעולה נכשלה."));
        return;
      }
      onSuccess();
      toast.success(successMsg);
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "הפעולה נכשלה."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">היום ({total})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* My tasks due */}
        {tasks.map((task) => {
          const overdue = task.overdue;
          return (
            <div
              key={`task-${task.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="warning" className="gap-1 text-[10px]">
                  <ListTodo className="h-3 w-3" /> משימה
                </Badge>
                <Link href={`/tasks/${task.id}`} className="font-medium hover:underline">
                  {task.subject}
                </Link>
                {task.project_name ? (
                  <span className="text-muted-foreground">· {task.project_name}</span>
                ) : null}
                <span className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {overdue ? "באיחור · " : ""}
                  {formatShortDate(task.due_date)}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busyId === task.id}
                onClick={() =>
                  void act(
                    task.id,
                    "/api/tasks/update-status",
                    { id: task.id, status: "done" },
                    () => setDoneTaskIds((prev) => new Set(prev).add(task.id)),
                    "המשימה סומנה כבוצעה."
                  )
                }
              >
                בוצע
              </Button>
            </div>
          );
        })}

        {/* My reminders due */}
        {reminders.map((r) => {
          const overdue = r.remind_at.slice(0, 10) < today;
          return (
            <div
              key={`reminder-${r.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="info" className="gap-1 text-[10px]">
                  <Bell className="h-3 w-3" /> תזכורת
                </Badge>
                {r.task_subject ? (
                  <Link href={`/tasks/${r.task_id}`} className="font-medium hover:underline">
                    {r.task_subject}
                  </Link>
                ) : r.customer_id ? (
                  <Link href={`/customers/${r.customer_id}`} className="font-medium hover:underline">
                    {r.customer_name ?? "לקוח"}
                  </Link>
                ) : (
                  <span className="font-medium">{r.customer_name ?? "כללי"}</span>
                )}
                {r.customer_phone ? (
                  <a href={`tel:${r.customer_phone}`} className="text-muted-foreground hover:underline">
                    ☎ {r.customer_phone}
                  </a>
                ) : null}
                <span className="text-muted-foreground">{r.task_subject ? "משימה" : actionTypeLabel(r.action_type)}</span>
                {r.content ? <span className="text-muted-foreground">· {r.content}</span> : null}
                <span className={overdue ? "font-medium text-destructive" : "text-muted-foreground"}>
                  {overdue ? "באיחור · " : ""}
                  {formatShortDate(r.remind_at)}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={busyId === r.id}
                onClick={() =>
                  void act(
                    r.id,
                    "/api/reminders/update",
                    { id: r.id, status: "done" },
                    () => setDoneReminderIds((prev) => new Set(prev).add(r.id)),
                    "התזכורת סומנה כבוצעה."
                  )
                }
              >
                בוצע
              </Button>
            </div>
          );
        })}

        {/* Payments to collect today (back-office) */}
        {payments.map((p) => (
          <div
            key={`payment-${p.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="success" className="gap-1 text-[10px]">
                <Wallet className="h-3 w-3" /> לגבייה
              </Badge>
              {p.customer_id ? (
                <Link href={`/customers/${p.customer_id}`} className="font-medium hover:underline">
                  {p.customer_name}
                </Link>
              ) : (
                <span className="font-medium">{p.customer_name}</span>
              )}
              {p.customer_phone ? (
                <a href={`tel:${p.customer_phone}`} className="text-muted-foreground hover:underline">
                  ☎ {p.customer_phone}
                </a>
              ) : null}
              <span className="font-semibold">{formatCurrency(p.amount)}</span>
              {p.payment_method === "check" ? (
                <Badge variant="info" className="gap-1 text-[10px]">
                  צ׳ק{p.check_number ? ` מס׳ ${p.check_number}` : ""} — להפקדה
                </Badge>
              ) : p.payment_method ? (
                <span className="text-xs text-muted-foreground">{paymentMethodLabel(p.payment_method)}</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={busyId === p.id}
              onClick={() =>
                void act(
                  p.id,
                  "/api/payments/mark-collected",
                  { id: p.id, collected: true },
                  () => setCollectedIds((prev) => new Set(prev).add(p.id)),
                  "התשלום סומן כנגבה."
                )
              }
            >
              סמן כנגבה
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
