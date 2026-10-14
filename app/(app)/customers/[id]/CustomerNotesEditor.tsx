"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { offlineFetch } from "@/lib/offline-queue";
import { EditButton } from "@/components/ui/icon-button";
import { scheduleDeferredAction } from "@/lib/undo-engine";

/**
 * The customer's notes with inline editing (the הערות section). A save shows
 * at once and goes out after the undo window, through the send queue — the
 * page isn't read again for it (`onSaved` tells the page, so the customer's
 * edit dialog opens with the same text).
 *
 * The notes the page hands in win whenever they change: edited in the
 * customer's edit dialog, they used to stay old here, because the text was
 * only ever read on the first render.
 */
export default function CustomerNotesEditor({
  customerId,
  initialNotes,
  onSaved,
  editRequest,
}: {
  customerId: string;
  initialNotes: string | null;
  onSaved?: (notes: string | null) => void;
  /** Start editing (a new number each time) — the section's "+" when there are no notes yet. */
  editRequest?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [seen, setSeen] = useState(initialNotes);
  if (initialNotes !== seen) {
    setSeen(initialNotes);
    setNotes(initialNotes);
    if (!editing) setDraft(initialNotes ?? "");
  }

  const [seenRequest, setSeenRequest] = useState(editRequest);
  if (editRequest !== seenRequest) {
    setSeenRequest(editRequest);
    if (editRequest) {
      setDraft(notes ?? "");
      setEditing(true);
    }
  }

  function save() {
    const next = draft.trim() ? draft : null;
    const previous = notes;
    setEditing(false);
    scheduleDeferredAction({
      key: `customer-notes:${customerId}`,
      message: "ההערות נשמרו",
      onApplyOptimistic: () => {
        setNotes(next);
        onSaved?.(next);
      },
      onRevert: () => {
        setNotes(previous);
        onSaved?.(previous);
      },
      onCommit: async () => {
        const result = await offlineFetch("/api/customers/update", { id: customerId, notes: next }, "עדכון הערות לקוח");
        if (!result.queued && !result.ok) {
          return { ok: false, error: toHebrewError(result.error, "שמירת ההערות נכשלה.") };
        }
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
            aria-label="הערות ללקוח"
            autoFocus
          />
          <DictateButton
            onTranscript={(text) => setDraft((prev) => appendDictatedText(prev, text))}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="muted"
            onClick={() => {
              setDraft(notes ?? "");
              setEditing(false);
            }}
          >
            ביטול
          </Button>
          <Button type="button" size="sm" onClick={save}>
            שמירה
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-2">
      {notes ? (
        <div className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
          {notes}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">אין הערות ללקוח זה.</p>
      )}
      <EditButton
        onClick={() => {
          setDraft(notes ?? "");
          setEditing(true);
        }}
        label="עריכת הערות"
      />
    </div>
  );
}
