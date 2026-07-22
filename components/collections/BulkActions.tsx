"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { whatsappHref } from "@/lib/whatsapp";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REMINDER_ACTION_TYPES } from "@/lib/communications";
import type { CollectionCustomerGroup } from "@/lib/collections";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(value);
}

// Bar + dialogs for acting on several selected debtors at once: blast a WhatsApp
// reminder to each, or create the same follow-up reminder for all of them.
export default function BulkActions({
  groups,
  onClear,
}: {
  groups: CollectionCustomerGroup[];
  onClear: () => void;
}) {
  const router = useRouter();
  const { currentUserId } = useAssignableUsers();
  const [mode, setMode] = useState<null | "reminder" | "whatsapp">(null);
  const [remindAt, setRemindAt] = useState("");
  const [actionType, setActionType] = useState("call");
  const [content, setContent] = useState("");
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUserId) setAssignee((prev) => prev || currentUserId);
  }, [currentUserId]);

  const targets = groups.filter((g) => g.customer_id);

  async function createReminders() {
    if (busy) return;
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה לתזכורת.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const results = await Promise.all(
        targets.map((g) =>
          fetch("/api/reminders/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              customer_id: g.customer_id,
              remind_at: new Date(remindAt).toISOString(),
              action_type: actionType,
              content: content.trim() || undefined,
              category: "collection",
              assigned_to: assignee || undefined,
            }),
          })
        )
      );
      if (results.some((r) => !r.ok)) {
        setError("חלק מהתזכורות לא נוצרו.");
        return;
      }
      setMode(null);
      setRemindAt("");
      setContent("");
      router.refresh();
      onClear();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <span className="font-medium">נבחרו {targets.length} לקוחות</span>
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setMode("whatsapp")}>
          וואטסאפ לנבחרים
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setMode("reminder")}>
          קבע תזכורת לכולם
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={onClear}>
          נקה בחירה
        </Button>
      </div>

      {/* Create one reminder per selected customer */}
      <Dialog open={mode === "reminder"} onOpenChange={(o) => { if (!o) setMode(null); }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>תזכורת ל-{targets.length} לקוחות</DialogTitle>
            <DialogDescription>תיווצר תזכורת זהה לכל אחד מהלקוחות שנבחרו.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-right">
            <div className="grid gap-2 sm:grid-cols-2">
              <DateTimeInput value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                {REMINDER_ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <Textarea
              rows={2}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="תוכן התזכורת (אופציונלי)"
            />
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">אחראי</div>
              <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} disabled={busy}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void createReminders()} disabled={busy}>
              {busy ? "שומר..." : "צור תזכורות"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-send WhatsApp to each selected customer */}
      <Dialog open={mode === "whatsapp"} onOpenChange={(o) => { if (!o) setMode(null); }}>
        <DialogContent className="max-h-[85svh] w-[calc(100vw-1rem)] max-w-md overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>וואטסאפ ל-{targets.length} לקוחות</DialogTitle>
            <DialogDescription>הוסיפו הערה משותפת ושלחו לכל לקוח בלחיצה.</DialogDescription>
          </DialogHeader>
          <Textarea
            className="text-right"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="הערה שתתווסף לכל ההודעות (אופציונלי)"
          />
          <div className="mt-2 space-y-1 text-right">
            {targets.map((g) => {
              const base = `שלום, נותרה יתרה לתשלום בסך ${formatCurrency(g.outstanding_amount)}. נשמח להסדרת התשלום. תודה!`;
              const msg = note.trim() ? `${base}\n${note.trim()}` : base;
              const link = whatsappHref(g.customer_whatsapp ?? g.customer_phone, msg);
              return (
                <div
                  key={g.customer_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{g.customer_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCurrency(g.outstanding_amount)}
                      {g.customer_phone ? ` · ${g.customer_phone}` : ""}
                    </div>
                  </div>
                  {link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-input px-2 text-xs hover:bg-muted"
                    >
                      <MessageCircle className="h-4 w-4 text-success" /> שלח
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">אין מספר</span>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setMode(null)}>
              סגירה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
