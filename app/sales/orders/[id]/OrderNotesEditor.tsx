"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toHebrewError } from "@/lib/error-messages";

/** Order comments with inline editing (the הערות section on the order page). */
export default function OrderNotesEditor({
  orderId,
  initialNotes,
}: {
  orderId: string;
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
      const res = await fetch("/api/orders/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, notes: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("שמירת ההערות נכשלה", { description: toHebrewError(data.error, "") });
        return;
      }
      toast.success("ההערות נשמרו");
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
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="הערות להזמנה..."
          disabled={busy}
        />
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
        <p className="text-sm text-muted-foreground">אין הערות להזמנה זו.</p>
      )}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 w-8 shrink-0 p-0"
        title="עריכת הערות"
        aria-label="עריכת הערות"
        onClick={() => setEditing(true)}
      >
        <PencilLine className="h-4 w-4" />
      </Button>
    </div>
  );
}
