"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { offlineFetch } from "@/lib/offline-queue";
import { EditButton } from "@/components/ui/icon-button";
import { scheduleDeferredAction } from "@/lib/undo-engine";

/** Customer comments with inline editing (the הערות section on the customer page). */
export default function CustomerNotesEditor({
  customerId,
  initialNotes,
}: {
  customerId: string;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState(initialNotes ?? "");

  function save() {
    const next = draft;
    const previous = notes;
    setEditing(false);
    scheduleDeferredAction({
      key: `customer-notes:${customerId}`,
      message: "ההערות נשמרו",
      onApplyOptimistic: () => setNotes(next),
      onRevert: () => setNotes(previous),
      onCommit: async () => {
        const result = await offlineFetch(
          "/api/customers/update",
          { id: customerId, notes: next },
          "עדכון הערות לקוח"
        );
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "שמירת ההערות נכשלה.") };
        }
        router.refresh();
        return { ok: true };
      },
    });
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="הערות ללקוח..."
            className="pe-11"
          />
          <DictateButton
            onTranscript={(text) => setDraft((prev) => appendDictatedText(prev, text))}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={save}>
            שמירה
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(notes ?? "");
              setEditing(false);
            }}
          >
            ביטול
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      {notes ? (
        <div className="min-w-0 whitespace-pre-wrap rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
          {notes}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">אין הערות ללקוח זה.</p>
      )}
      <EditButton onClick={() => setEditing(true)} label="עריכת הערות" />
    </div>
  );
}
