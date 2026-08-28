"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NoteIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import { toHebrewError } from "@/lib/error-messages";
import { parseOrderComments, type OrderComment } from "@/lib/orders/comments";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

/**
 * Attributed comment thread on the order page: post several timestamped comments
 * over time, and edit or delete each one. Comments live inside the order's
 * `notes` field — the add/edit/delete routes rewrite an attributed text log, and
 * parseOrderComments reads them back (legacy plain notes surface as a single
 * unattributed comment that can still be edited or removed).
 */
export default function OrderCommentsThread({
  orderId,
  initialNotes,
  authorColors = {},
}: {
  orderId: string;
  initialNotes: string | null;
  /** Map of author display-name/email → chosen avatar color (users.avatar_color). */
  authorColors?: Record<string, string>;
}) {
  const router = useRouter();
  // Seed once from the notes field; edits/adds mutate local state so they appear
  // immediately without waiting on a full page reload.
  const [comments, setComments] = useState<OrderComment[]>(() => parseOrderComments(initialNotes));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function addComment() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/orders/add-comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, message }),
      });
      const json = (await res.json().catch(() => ({}))) as { comment?: OrderComment; error?: string };
      if (!res.ok) throw new Error(toHebrewError(json.error, "הוספת התגובה נכשלה."));
      if (json.comment) setComments((prev) => [...prev, json.comment as OrderComment]);
      setDraft("");
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "הוספת התגובה נכשלה."));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditDraft(comments[index]?.body ?? "");
  }

  async function saveEdit() {
    if (editingIndex === null || editBusy) return;
    const target = comments[editingIndex];
    const message = editDraft.trim();
    if (!target || !message) return;
    if (message === target.body) {
      setEditingIndex(null);
      return;
    }
    setEditBusy(true);
    try {
      const res = await fetch("/api/orders/edit-comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, target, message }),
      });
      const json = (await res.json().catch(() => ({}))) as { comment?: OrderComment; error?: string };
      if (!res.ok) throw new Error(toHebrewError(json.error, "עריכת התגובה נכשלה."));
      const updated = (json.comment as OrderComment) ?? { ...target, body: message };
      setComments((prev) => prev.map((comment, i) => (i === editingIndex ? updated : comment)));
      setEditingIndex(null);
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "עריכת התגובה נכשלה."));
    } finally {
      setEditBusy(false);
    }
  }

  async function confirmDelete() {
    if (pendingDelete === null || deleteBusy) return;
    const target = comments[pendingDelete];
    if (!target) {
      setPendingDelete(null);
      return;
    }
    setDeleteBusy(true);
    try {
      const res = await fetch("/api/orders/delete-comment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId, target }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(toHebrewError(json.error, "מחיקת התגובה נכשלה."));
      setComments((prev) => prev.filter((_, i) => i !== pendingDelete));
      if (editingIndex === pendingDelete) setEditingIndex(null);
      setPendingDelete(null);
      router.refresh();
    } catch (err: unknown) {
      toast.error(toHebrewError(err, "מחיקת התגובה נכשלה."));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין תגובות להזמנה זו עדיין.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((comment, index) => (
            <div key={`comment-${index}`} className="flex gap-2">
              {comment.author_name ? (
                <InitialsAvatar
                  name={comment.author_name}
                  color={authorColors[comment.author_name] ?? null}
                  size="sm"
                />
              ) : (
                // An author-less block is the order's original note (from the
                // wizard), not a user comment — show it as such, not a fake user.
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <NoteIcon className="h-3.5 w-3.5" />
                </span>
              )}
              <div className="min-w-0 flex-1 rounded-md border bg-muted/20 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{comment.author_name ?? "הערת הזמנה"}</span>
                    {comment.created_at ? (
                      <span className="text-[11px] text-muted-foreground">{comment.created_at}</span>
                    ) : null}
                  </div>
                  {editingIndex === index ? null : (
                    <div className="flex shrink-0 items-center gap-1">
                      <EditButton onClick={() => startEdit(index)} label="עריכת תגובה" />
                      <DeleteButton label="מחיקת תגובה" onClick={() => setPendingDelete(index)} />
                    </div>
                  )}
                </div>

                {editingIndex === index ? (
                  <div className="mt-2 space-y-2">
                    <div className="relative">
                      <Textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        className="min-h-16 pe-11"
                        disabled={editBusy}
                      />
                      <DictateButton
                        onTranscript={(text) => setEditDraft((prev) => appendDictatedText(prev, text))}
                        disabled={editBusy}
                        className="absolute bottom-1 end-1 h-8 w-8"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={editBusy}
                        onClick={() => setEditingIndex(null)}
                      >
                        ביטול
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={editBusy || !editDraft.trim()}
                        onClick={() => void saveEdit()}
                      >
                        {editBusy ? "שומר..." : "שמירה"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5 whitespace-pre-wrap text-sm leading-6">{comment.body}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="כתבו תגובה..."
            className="min-h-16 pe-11"
            disabled={busy}
          />
          <DictateButton
            onTranscript={(text) => setDraft((prev) => appendDictatedText(prev, text))}
            disabled={busy}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void addComment()}>
            {busy ? "שומר..." : "הוספת תגובה"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
        title="מחיקת תגובה"
        description="למחוק את התגובה? לא ניתן לשחזר."
        confirmLabel="מחיקה"
        destructive
        loading={deleteBusy}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
