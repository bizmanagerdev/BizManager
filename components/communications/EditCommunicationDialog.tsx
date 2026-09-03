"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DeleteButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toHebrewError } from "@/lib/error-messages";
import { appendDictatedText } from "@/lib/dictation";
import { scheduleDeferredEdit, scheduleDeferredDelete } from "@/lib/undo-engine";

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

/** Only mounted (by the caller) while there's a log to edit, so local state
 *  initializes fresh from `log` on every open — no prop-change reset effect. */
export default function EditCommunicationDialog({
  log,
  onClose,
  onSaved,
}: {
  log: EditableCommunication;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState(log.channel);
  const [direction, setDirection] = useState(log.direction);
  const [topic, setTopic] = useState(log.category);
  const [content, setContent] = useState(log.content ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save() {
    const id = log.id;
    const snapshotChannel = channel;
    const snapshotDirection = direction;
    const snapshotTopic = topic;
    const snapshotContent = content.trim() || null;
    onClose();
    scheduleDeferredEdit({
      scope: "communication",
      id,
      message: "הפנייה עודכנה.",
      patch: { channel: snapshotChannel, direction: snapshotDirection, category: snapshotTopic, content: snapshotContent },
      onCommit: async () => {
        const res = await fetch("/api/communications/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, channel: snapshotChannel, direction: snapshotDirection, category: snapshotTopic, content: snapshotContent }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return { ok: false, error: toHebrewError(json.error, "עדכון נכשל.") };
        onSaved();
        return { ok: true };
      },
    });
  }

  function remove() {
    const id = log.id;
    onClose();
    setConfirmDelete(false);
    scheduleDeferredDelete({
      scope: "communication",
      id,
      message: "הפנייה נמחקה.",
      onCommit: async () => {
        const res = await fetch("/api/communications/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return { ok: false, error: toHebrewError(json.error, "מחיקה נכשלה.") };
        router.refresh();
        return { ok: true };
      },
    });
  }

  return (
    <>
      <FormDialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title="עריכת פנייה"
        description="עדכון פרטי השיחה או מחיקתה."
        size="formMd"
        onSubmit={save}
        submitLabel="שמירה"
        footerStart={
          <DeleteButton onClick={() => setConfirmDelete(true)} size="default" />
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
              <div className="relative">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  className="pe-11"
                />
                <DictateButton
                  onTranscript={(text) => setContent((prev) => appendDictatedText(prev, text))}
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
            </div>
          </div>
      </FormDialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="מחיקת פנייה"
        description="הפנייה תימחק."
        confirmLabel="מחיקה"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
