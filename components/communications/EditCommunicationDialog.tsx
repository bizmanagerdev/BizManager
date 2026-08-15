"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DeleteButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/ui/form-dialog";
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
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="עריכת פנייה"
        description="עדכון פרטי השיחה או מחיקתה."
        size="formMd"
        onSubmit={() => void save()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={busy}
        error={error || undefined}
        footerStart={
          <DeleteButton onClick={() => setConfirmDelete(true)} disabled={busy} size="default" />
        }
      >

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">ערוץ</label>
                <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value)}>
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">כיוון</label>
                <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value)}>
                  <option value="outgoing">יוצאת</option>
                  <option value="incoming">נכנסת</option>
                  <option value="missed">שלא נענתה</option>
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">נושא</label>
              <NativeSelect value={topic} onChange={(e) => setTopic(e.target.value)}>
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">תוכן</label>
              <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
            </div>
          </div>
      </FormDialog>

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
