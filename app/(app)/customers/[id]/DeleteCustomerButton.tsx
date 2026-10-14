"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { offlineFetch } from "@/lib/offline-queue";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { registerReversibleAction, scheduleDeferredDelete } from "@/lib/undo-engine";

// Deleting a customer, opened from the page's ⋮ (CustomerHeaderMenu).
//
// A customer the database won't let go of — orders, projects, a lease or a
// Morning document point at it — is said to be so UP FRONT (owner,
// 2026-10-13): the dialog names what's in the way and offers to mark the
// customer inactive instead. It used to navigate back to the list and fail
// there ten seconds later. Before leaving the page the server is asked once
// more (a dry run of the same route), in case something was added since the
// page was read; with no connection the page's own counts decide.

export default function DeleteCustomerButton({
  customerId,
  customerName,
  blocker,
  active,
  open,
  onOpenChange,
  onActiveChange,
  returnHref = "/customers",
}: {
  customerId: string;
  customerName: string;
  /** Why it can't be deleted ("יש ללקוח 6 הזמנות ו-2 פרויקטים"), or null. */
  blocker: string | null;
  active: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Marked inactive here (or that undone) — the page shows it at once. */
  onActiveChange: (active: boolean) => void;
  returnHref?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // What the server's dry run found when the page's own counts said "free to delete".
  const [lateBlocker, setLateBlocker] = useState<string | null>(null);
  const reason = lateBlocker ?? blocker;

  function close(next: boolean) {
    if (!next) {
      setError("");
      setLateBlocker(null);
    }
    onOpenChange(next);
  }

  async function serverBlocker(): Promise<string | null> {
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    try {
      const response = await fetch("/api/customers/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: customerId, dry_run: true }),
      });
      const json = (await response.json().catch(() => ({}))) as { blocker?: string | null };
      return response.ok && typeof json.blocker === "string" && json.blocker ? json.blocker : null;
    } catch {
      // No answer: the page's own counts (already checked) decide.
      return null;
    }
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    const late = await serverBlocker();
    setBusy(false);
    if (late) {
      setLateBlocker(late);
      return;
    }
    close(false);
    emitNavigationStart();
    router.push(returnHref);
    scheduleDeferredDelete({
      scope: "customer",
      id: customerId,
      message: "הלקוח נמחק",
      onCommit: async () => {
        const result = await offlineFetch("/api/customers/delete", { id: customerId }, "מחיקת לקוח");
        if (!result.queued && !result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת לקוח נכשלה.") };
        const json = result.queued ? null : (result.data as { ok?: boolean } | null);
        if (json && !json.ok) return { ok: false, error: "מחיקת לקוח נכשלה." };
        startTransition(() => {
          router.refresh();
        });
        return { ok: true };
      },
    });
  }

  async function setActive(next: boolean) {
    return offlineFetch(
      "/api/customers/update",
      { id: customerId, active: next },
      next ? "סימון לקוח כפעיל" : "סימון לקוח כלא פעיל"
    );
  }

  async function markInactive() {
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await setActive(false);
    setBusy(false);
    if (!result.queued && !result.ok) {
      setError(toHebrewError(result.error, "הסימון כלא פעיל נכשל."));
      return;
    }
    onActiveChange(false);
    close(false);
    registerReversibleAction({
      key: `customer-inactive:${customerId}`,
      message: "הלקוח סומן כלא פעיל",
      onUndo: async () => {
        const undo = await setActive(true);
        if (!undo.queued && !undo.ok) return { ok: false, error: toHebrewError(undo.error, "הביטול נכשל.") };
        onActiveChange(true);
        return { ok: true };
      },
    });
  }

  if (reason) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={close}
        title="לא ניתן למחוק את הלקוח"
        description={
          active
            ? `${reason}. אפשר לסמן אותו כלא פעיל במקום — הוא וההיסטוריה שלו נשמרים.`
            : `${reason}. הלקוח כבר מסומן כלא פעיל.`
        }
        confirmLabel={active ? "סימון כלא פעיל" : "סגירה"}
        cancelLabel={active ? "סגירה" : "ביטול"}
        loading={busy}
        error={error || undefined}
        onConfirm={() => (active ? void markInactive() : close(false))}
      />
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={close}
      destructive
      title="מחיקת לקוח"
      description={`האם למחוק את הלקוח "${customerName}"?`}
      confirmLabel="מחיקה"
      loading={busy}
      onConfirm={() => void confirmDelete()}
    />
  );
}
