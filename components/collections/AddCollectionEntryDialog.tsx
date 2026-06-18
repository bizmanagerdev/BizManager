"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { COMMUNICATION_CHANNELS } from "@/lib/communications";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { offlineFetch } from "@/lib/offline-queue";

type Mode = "reminder" | "call";
type CustomerHit = { id: string; name: string; phone: string | null };

// Page-level "add reminder" / "log call" for the פניות center, so a follow-up can
// be created without first drilling into a specific debtor row. A call requires a
// customer; a reminder may be general (no customer).
export default function AddCollectionEntryDialog({
  mode,
  open,
  onOpenChange,
  onSaved,
}: {
  mode: Mode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { currentUserId } = useAssignableUsers();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [assignee, setAssignee] = useState("");

  // Reminder fields
  const [reminderDate, setReminderDate] = useState("");
  const [reminderNote, setReminderNote] = useState("");

  // Call fields
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState("outgoing");
  const [content, setContent] = useState("");
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpContent, setFollowUpContent] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setCustomer(null);
    setAssignee(currentUserId ?? "");
    setReminderDate("");
    setReminderNote("");
    // (currentUserId may not be loaded yet on first open — defaulted below.)
    setChannel("phone");
    setDirection("outgoing");
    setContent("");
    setWithFollowUp(false);
    setFollowUpDate("");
    setFollowUpContent("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the assignee to the current user once the list resolves.
  useEffect(() => {
    if (open && currentUserId) setAssignee((prev) => prev || currentUserId);
  }, [open, currentUserId]);

  // Debounced customer search.
  useEffect(() => {
    const q = query.trim();
    if (!q || customer) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/search?q=${encodeURIComponent(q)}&limit=20`);
        if (!res.ok) return;
        const json = (await res.json()) as {
          customers?: Array<{ id: string; name: string; phone?: string | null }>;
        };
        setResults(
          (json.customers ?? []).map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null }))
        );
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, customer]);

  async function submit() {
    if (submitting) return;
    setError(null);

    if (mode === "call" && !customer) {
      setError("יש לבחור לקוח.");
      return;
    }
    if (mode === "reminder" && !reminderDate) {
      setError("יש לבחור תאריך לתזכורת.");
      return;
    }
    if (mode === "call" && !content.trim() && !withFollowUp) {
      setError("יש להזין תוכן שיחה או לקבוע תזכורת המשך.");
      return;
    }
    if (mode === "call" && withFollowUp && !followUpDate) {
      setError("יש לבחור תאריך לתזכורת ההמשך.");
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === "reminder"
          ? await offlineFetch(
              "/api/reminders/create",
              {
                customer_id: customer?.id ?? null,
                remind_at: reminderDate,
                content: reminderNote.trim() || undefined,
                action_type: "call",
                category: "collection",
                assigned_to: assignee || undefined,
              },
              "תזכורת חדשה",
              { idempotent: true }
            )
          : await offlineFetch(
              "/api/communications/create",
              {
                customer_id: customer!.id,
                channel,
                direction,
                content: content.trim() || undefined,
                category: "collection",
                follow_up: withFollowUp
                  ? {
                      remind_at: followUpDate,
                      content: followUpContent.trim() || undefined,
                      assigned_to: assignee || undefined,
                    }
                  : undefined,
              },
              "תיעוד שיחה",
              { idempotent: true }
            );

      if (result.queued) {
        onSaved();
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "שמירה נכשלה."));
        return;
      }
      toast.success(mode === "reminder" ? "התזכורת נוספה." : "השיחה תועדה.");
      onSaved();
      onOpenChange(false);
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[90svh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto p-4 text-right sm:p-6"
      >
        <DialogHeader>
          <DialogTitle>{mode === "reminder" ? "הוספת תזכורת" : "תיעוד שיחה"}</DialogTitle>
          <DialogDescription>
            {mode === "reminder"
              ? "קביעת תזכורת מעקב, עם או בלי שיוך ללקוח."
              : "תיעוד פנייה/שיחה מול לקוח, עם אפשרות לתזכורת המשך."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Customer picker */}
          <div className="space-y-1">
            <label className="text-sm font-medium">
              לקוח{mode === "call" ? " *" : " (אופציונלי)"}
            </label>
            {customer ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <span>
                  {customer.name}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setCustomer(null);
                    setQuery("");
                  }}
                >
                  שינוי
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש לקוח לפי שם או טלפון"
                />
                {results.length > 0 ? (
                  <div className="max-h-44 overflow-auto rounded-md border border-input">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCustomer(c);
                          setResults([]);
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-muted/40"
                      >
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.phone ?? ""}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {mode === "reminder" ? (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך תזכורת *</label>
                <DateInput value={reminderDate} onChange={(e) => setReminderDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">על מה להזכיר?</label>
                <Input
                  value={reminderNote}
                  onChange={(e) => setReminderNote(e.target.value)}
                  placeholder="אופציונלי"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">אחראי</label>
                <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {COMMUNICATION_CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="outgoing">שיחה יוצאת</option>
                  <option value="incoming">שיחה נכנסת</option>
                </select>
              </div>
              <Textarea
                rows={2}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="מה סוכם? מה הלקוח אמר?"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={withFollowUp}
                  onChange={(e) => setWithFollowUp(e.target.checked)}
                />
                קבע תזכורת המשך
              </label>
              {withFollowUp ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <DateInput value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
                    <Input
                      value={followUpContent}
                      onChange={(e) => setFollowUpContent(e.target.value)}
                      placeholder="להתקשר שוב..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">אחראי לתזכורת</label>
                    <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
                  </div>
                </>
              ) : null}
            </>
          )}

          {error ? <div className="text-sm text-destructive">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            ביטול
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={submitting}>
            {submitting ? "שומר..." : mode === "reminder" ? "הוספת תזכורת" : "שמירה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
