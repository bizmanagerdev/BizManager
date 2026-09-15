"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { MetaRow } from "@/components/ui/meta-row";
import { SpinnerIcon } from "@/components/ui/icons";
import { toHebrewError } from "@/lib/error-messages";

// "השלמת חיובים חסרים" — create the occurrences a recurring bill should have
// produced but never did (a template saved after today's generator run, a start
// date moved back before the generator walked history, a row deleted by hand).
// Preview first, then create: a catch-up that silently invented rows in closed
// months would be indistinguishable from a bug. One hook instance = one dialog;
// the page header uses it for "all templates", the list for a single row.

/** What /api/recurring-expenses/backfill reports as missing, per template. */
type BackfillPreview = {
  templates: Array<{ id: string; name: string; autoPaid: boolean; months: string[]; count: number }>;
  total: number;
};

/** `id: null` = every active template. */
export type BackfillTarget = { id: string | null; label: string };

export function useBackfillMissing() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState<BackfillTarget | null>(null);
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function open(next: BackfillTarget) {
    setTarget(next);
    setPreview(null);
    setError(undefined);
    setLoading(true);
    try {
      const res = await fetch(`/api/recurring-expenses/backfill${next.id ? `?id=${encodeURIComponent(next.id)}` : ""}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as BackfillPreview & { error?: string };
      if (!res.ok) {
        setError(toHebrewError(json.error, "בדיקת החיובים החסרים נכשלה."));
        return;
      }
      setPreview({ templates: json.templates ?? [], total: json.total ?? 0 });
    } catch (err: unknown) {
      setError(toHebrewError(err, "בדיקת החיובים החסרים נכשלה."));
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!target) return;
    setRunning(true);
    setError(undefined);
    try {
      const res = await fetch("/api/recurring-expenses/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: target.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; created?: number };
      if (!res.ok) {
        setError(toHebrewError(json.error, "השלמת החיובים החסרים נכשלה."));
        return;
      }
      setTarget(null);
      startTransition(() => router.refresh());
      const created = Number(json.created) || 0;
      toast.success(created > 0 ? `נוצרו ${created} חיובים חסרים` : "לא נמצאו חיובים חסרים");
    } catch (err: unknown) {
      setError(toHebrewError(err, "השלמת החיובים החסרים נכשלה."));
    } finally {
      setRunning(false);
    }
  }

  const dialog = (
    <ConfirmDialog
      open={Boolean(target)}
      onOpenChange={(next) => {
        if (!next) {
          setTarget(null);
          setPreview(null);
          setError(undefined);
        }
      }}
      title="השלמת חיובים חסרים"
      description={
        loading
          ? undefined
          : preview && preview.total > 0
            ? "אלה החיובים שהיו אמורים להיווצר ולא נוצרו. חיוב של הוראת קבע ייווצר כשולם; חיוב רגיל ייווצר כממתין לאישור תשלום."
            : undefined
      }
      confirmLabel={preview && preview.total > 0 ? `יצירת ${preview.total} חיובים` : "סגירה"}
      loading={running}
      error={error}
      onConfirm={() => {
        if (preview && preview.total > 0) void run();
        else setTarget(null);
      }}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
          <SpinnerIcon className="h-4 w-4 animate-spin" />
          <span>בודק אילו חיובים חסרים...</span>
        </div>
      ) : preview && preview.total === 0 ? (
        <div className="py-2 text-sm text-muted-foreground">
          לא נמצאו חיובים חסרים ב{target?.label ?? ""}. הכול כבר נוצר.
        </div>
      ) : preview ? (
        <div className="max-h-64 space-y-3 overflow-y-auto">
          {preview.templates.map((row) => (
            <div key={row.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{row.name}</span>
                <Badge variant="outline">{row.count} חיובים</Badge>
                {row.autoPaid ? <Badge variant="outline">הוראת קבע</Badge> : null}
              </div>
              <MetaRow dir="ltr" className="text-xs text-muted-foreground" items={row.months} />
            </div>
          ))}
        </div>
      ) : null}
    </ConfirmDialog>
  );

  return { open, dialog };
}
