"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { offlineFetch } from "@/lib/offline-queue";
import { EditButton } from "@/components/ui/icon-button";

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
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await offlineFetch(
        "/api/customers/update",
        { id: customerId, notes: draft },
        "עדכון הערות לקוח"
      );
      if (!result.queued && !result.ok) {
        toast.error("שמירת ההערות נכשלה", { description: toHebrewError(result.error, "") });
        return;
      }
      if (!result.queued) toast.success("ההערות נשמרו");
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("שמירת ההערות נכשלה");
    } finally {
      setBusy(false);
    }
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
            disabled={busy}
            className="pe-11"
          />
          <DictateButton
            onTranscript={(text) => setDraft((prev) => appendDictatedText(prev, text))}
            disabled={busy}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            {busy ? "שומר..." : "שמירה"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDraft(initialNotes ?? "");
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
      {initialNotes ? (
        <div className="min-w-0 whitespace-pre-wrap rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
          {initialNotes}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">אין הערות ללקוח זה.</p>
      )}
      <EditButton onClick={() => setEditing(true)} label="עריכת הערות" />
    </div>
  );
}
