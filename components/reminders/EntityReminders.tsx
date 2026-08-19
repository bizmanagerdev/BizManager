"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AddIcon, ClockIcon, NotificationIcon, NotificationOffIcon, ReminderIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import ReminderFormDialog, { type ReminderFormValue } from "@/components/reminders/ReminderFormDialog";
import { toHebrewError } from "@/lib/error-messages";
import { EditButton } from "@/components/ui/icon-button";

// Shows ALL open reminders attached to one entity (order / project / customer /
// task…) with inline add / edit / done / cancel. Drop it on any details page:
//   <EntityReminders queryKey="order_id" queryId={id} links={{ order_id: id }} canManage />
type ReminderRow = {
  id: string;
  remindAt: string;
  content: string | null;
  status: string;
  assignedTo: string | null;
  assignedToName: string | null;
  source: "manual" | "system";
  behavior: string;
  severity: string;
  notifiedAt: string | null;
};

function fmt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function EntityReminders({
  queryKey,
  queryId,
  links,
  category = "order",
  canManage,
  hideAddButton = false,
  addOpen: addOpenProp,
  onAddOpenChange,
  onCountChange,
}: {
  queryKey: string;
  queryId: string;
  links: Record<string, string | null | undefined>;
  category?: string;
  canManage: boolean;
  /** Hide the built-in "הוסף תזכורת" — for callers that put a "+" in their own header. */
  hideAddButton?: boolean;
  /** Control the add dialog from outside (pairs with hideAddButton). */
  addOpen?: boolean;
  onAddOpenChange?: (open: boolean) => void;
  /** Fires whenever the list is (re)loaded — lets a wrapping section fold itself when empty. */
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ReminderRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpenState, setAddOpenState] = useState(false);
  const addOpen = addOpenProp ?? addOpenState;
  const setAddOpen = (next: boolean) => {
    setAddOpenState(next);
    onAddOpenChange?.(next);
  };
  const [editing, setEditing] = useState<ReminderFormValue | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/reminders/list?${queryKey}=${encodeURIComponent(queryId)}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { items?: ReminderRow[] };
      const next = res.ok ? json.items ?? [] : [];
      setItems(next);
      onCountChange?.(next.length);
    } catch {
      setItems([]);
      onCountChange?.(0);
    }
  }, [queryKey, queryId, onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  // Pick up reminders added elsewhere (e.g. another tab) when returning to page.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function act(id: string, action: "done" | "dismiss") {
    setBusy(id);
    try {
      const res = await fetch("/api/reminders/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success(action === "done" ? "סומן כבוצע" : "התזכורת בוטלה");
      await load();
    } catch (err) {
      toast.error(toHebrewError(err, "הפעולה נכשלה."));
    } finally {
      setBusy(null);
    }
  }

  if (items === null) return <p className="text-sm text-muted-foreground">טוען תזכורות…</p>;

  return (
    <div className="space-y-2">
      {canManage && !hideAddButton ? (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
            <AddIcon className="h-4 w-4" /> הוסף תזכורת
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין תזכורות פתוחות.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => {
            const isSilent = r.behavior === "silent";
            const NotifyIcon = isSilent ? NotificationOffIcon : r.notifiedAt ? ReminderIcon : NotificationIcon;
            const notifyText = isSilent ? "ללא התראה" : r.notifiedAt ? "התראה נשלחה" : "התראה מתוזמנת";
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 px-3 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <ClockIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{fmt(r.remindAt)}</span>
                  </div>
                  {r.content ? <div className="text-sm text-muted-foreground">{r.content}</div> : null}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {r.assignedToName ? <span>{r.assignedToName}</span> : null}
                    <span className={`flex items-center gap-1 ${isSilent || r.notifiedAt ? "" : "text-primary"}`}>
                      <NotifyIcon className="h-3 w-3 shrink-0" />
                      {notifyText}
                    </span>
                  </div>
                </div>

                {canManage ? (
                  <div className="flex items-center gap-1.5">
                    <EditButton onClick={() =>
                        setEditing({ id: r.id, remindAt: r.remindAt, content: r.content, assignedTo: r.assignedTo })
                      } disabled={busy === r.id} label="עריכת תזכורת" />
                    <Button size="sm" onClick={() => act(r.id, "done")} disabled={busy === r.id}>
                      בוצע
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => act(r.id, "dismiss")} disabled={busy === r.id}>
                      בטל
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ReminderFormDialog
        mode="create"
        open={addOpen}
        onOpenChange={setAddOpen}
        links={links}
        category={category}
        onSaved={() => void load()}
      />
      <ReminderFormDialog
        mode="edit"
        open={editing !== null}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
        value={editing ?? undefined}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </div>
  );
}
