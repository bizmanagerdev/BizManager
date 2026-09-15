"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { sourceSettingKey, type OutflowSourceRow } from "@/lib/outflow-source-settings";

// The salaries / loan instalments / card charges that reach the payments board
// from elsewhere, with their planning settings (active, alert work days,
// account). Fetched when the tab opens — not with the calendar page — since
// they need every loan and every salary agreement. Saving a setting is per row
// and optimistic; a failed save reverts and says so.

export type SourceRowState = { reminder: number; accountId: string; active: boolean; saving: boolean };

export function sourceRowId(row: OutflowSourceRow) {
  return sourceSettingKey(row.kind, row.key);
}

export function useOutflowSources() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState<OutflowSourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, SourceRowState>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/outflow-sources", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { rows?: OutflowSourceRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(toHebrewError(json.error, "טעינת המקורות נכשלה."));
          setRows([]);
          return;
        }
        const list = json.rows ?? [];
        setRows(list);
        setState(
          Object.fromEntries(
            list.map((r) => [sourceRowId(r), { reminder: r.effectiveReminderDays, accountId: r.accountId ?? "", active: r.isActive, saving: false }])
          )
        );
      } catch (err) {
        if (cancelled) return;
        setError(toHebrewError(err, "טעינת המקורות נכשלה."));
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stateOf = (row: OutflowSourceRow): SourceRowState =>
    state[sourceRowId(row)] ?? { reminder: row.effectiveReminderDays, accountId: row.accountId ?? "", active: row.isActive, saving: false };

  async function save(row: OutflowSourceRow, patch: Partial<Pick<SourceRowState, "reminder" | "accountId" | "active">>) {
    const id = sourceRowId(row);
    const before = stateOf(row);
    const next = { ...before, ...patch, saving: true };
    setState((s) => ({ ...s, [id]: next }));
    try {
      const res = await fetch("/api/outflow-sources/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source_kind: row.kind,
          source_key: row.key,
          reminder_work_days_before: next.reminder,
          account_id: next.accountId || null,
          is_active: next.active,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error("שמירת ההגדרה נכשלה", { description: toHebrewError(json.error, "") });
        setState((s) => ({ ...s, [id]: { ...before, saving: false } }));
        return;
      }
      setState((s) => ({ ...s, [id]: { ...next, saving: false } }));
      toast.success("נשמר");
      // The board (account scoping, inactive sources) and the alert rules read the stored row.
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("שמירת ההגדרה נכשלה", { description: toHebrewError(err, "") });
      setState((s) => ({ ...s, [id]: { ...before, saving: false } }));
    }
  }

  return { rows, loading: rows === null, error, stateOf, save };
}
