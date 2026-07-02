"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toHebrewError } from "@/lib/error-messages";

export type EditableCommunication = {
  id: string;
  channel: string;
  direction: string;
  category: string;
  content: string | null;
};

const CHANNELS = [
  { value: "phone", label: "טלפון" },
  { value: "whatsapp", label: "וואטסאפ" },
  { value: "email", label: "מייל" },
  { value: "sms", label: "SMS" },
  { value: "meeting", label: "פגישה" },
  { value: "other", label: "אחר" },
];
const TOPICS = [
  { value: "collection", label: "גבייה" },
  { value: "sales", label: "מכירה" },
  { value: "service", label: "שירות" },
  { value: "delivery", label: "משלוח" },
  { value: "general", label: "כללי" },
];

export default function EditCommunicationDialog({
  log,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  log: EditableCommunication | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: (id: string) => void;
}) {
  const [channel, setChannel] = useState("phone");
  const [direction, setDirection] = useState("outgoing");
  const [topic, setTopic] = useState("general");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !log) return;
    setChannel(log.channel);
    setDirection(log.direction);
    setTopic(log.category);
    setContent(log.content ?? "");
    setError(null);
  }, [open, log]);

  async function save() {
    if (!log || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/communications/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: log.id, channel, direction, category: topic, content: content.trim() || null }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success("הפנייה עודכנה.");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(toHebrewError(err, "עדכון נכשל."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!log || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/communications/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: log.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success("הפנייה נמחקה.");
      onDeleted(log.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(toHebrewError(err, "מחיקה נכשלה."));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir="rtl" className="w-[calc(100vw-1rem)] max-w-md p-4 text-right sm:p-6">
          <DialogHeader>
            <DialogTitle>עריכת פנייה</DialogTitle>
            <DialogDescription>עדכון פרטי השיחה או מחיקתה.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">ערוץ</label>
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">כיוון</label>
                <select value={direction} onChange={(e) => setDirection(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  <option value="outgoing">יוצאת</option>
                  <option value="incoming">נכנסת</option>
                  <option value="missed">שלא נענתה</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">נושא</label>
              <select value={topic} onChange={(e) => setTopic(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">תוכן</label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
            </div>
            {error ? <div className="text-sm text-destructive">{error}</div> : null}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            <Button type="button" variant="outline" className="me-auto text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
              מחיקה
            </Button>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="מחיקת פנייה"
        description="הפנייה תימחק. פעולה זו אינה הפיכה."
        confirmLabel="מחיקה"
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </>
  );
}
