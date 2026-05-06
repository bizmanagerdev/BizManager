"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import type { MorningLocalDocument } from "@/lib/morning/types";

type MatchCandidate = {
  morningClientId: string;
  morningClientName: string;
  score: number;
  reason: string;
  canAutoMatch: boolean;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
};

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "matched":
      return "מקושר";
    case "manual_review":
      return "דורש בדיקה";
    case "ignored":
      return "התעלמות";
    case "unmatched":
    default:
      return "לא מקושר";
  }
}

function statusClass(status: string | null | undefined, hasError: boolean) {
  if (hasError) return "border-rose-200 bg-rose-100 text-rose-800";
  switch (status) {
    case "matched":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    case "manual_review":
      return "border-amber-200 bg-amber-100 text-amber-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export default function MorningCustomerCard({
  customerId,
  morningClientId,
  morningMatchStatus,
  morningSyncedAt,
  morningLastSyncError,
  morningDocuments,
  onChanged,
}: {
  customerId: string;
  morningClientId: string | null | undefined;
  morningMatchStatus: string | null | undefined;
  morningSyncedAt: string | null | undefined;
  morningLastSyncError: string | null | undefined;
  morningDocuments: MorningLocalDocument[];
  onChanged?: () => void;
}) {
  const [busyKey, setBusyKey] = useState("");
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [documents, setDocuments] = useState<MorningLocalDocument[]>(morningDocuments);

  useEffect(() => {
    setDocuments(morningDocuments);
  }, [morningDocuments]);

  async function createRemoteClient() {
    setBusyKey("create");
    try {
      const response = await fetch("/api/morning/customers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "יצירת לקוח ב-Morning נכשלה.");
      toast.success("לקוח Morning נוצר או עודכן");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת לקוח ב-Morning נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  async function syncRemoteClient() {
    setBusyKey("sync");
    try {
      const response = await fetch("/api/morning/customers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "סנכרון לקוח ל-Morning נכשל.");
      toast.success("פרטי החיוב סונכרנו ל-Morning");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "סנכרון לקוח ל-Morning נכשל.");
    } finally {
      setBusyKey("");
    }
  }

  async function loadMatches() {
    setBusyKey("match");
    try {
      const response = await fetch(`/api/morning/customers/match?customerId=${encodeURIComponent(customerId)}`, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        candidates?: MatchCandidate[];
        bestCandidate?: MatchCandidate | null;
        shouldAutoMatch?: boolean;
      };
      if (!response.ok) throw new Error(json.error ?? "בדיקת התאמות Morning נכשלה.");
      const nextCandidates = Array.isArray(json.candidates) ? json.candidates : [];
      setCandidates(nextCandidates);
      if (json.shouldAutoMatch && json.bestCandidate?.morningClientId) {
        await confirmLink(json.bestCandidate.morningClientId);
      } else if (nextCandidates.length === 0) {
        toast.info("לא נמצאה התאמה אוטומטית. אפשר ליצור לקוח חדש ב-Morning.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "בדיקת התאמות Morning נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  async function confirmLink(morningClientIdToLink: string) {
    setBusyKey(`link:${morningClientIdToLink}`);
    try {
      const response = await fetch("/api/morning/customers/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          morningClientId: morningClientIdToLink,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "קישור לקוח ל-Morning נכשל.");
      toast.success("הלקוח קושר ל-Morning");
      setCandidates([]);
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "קישור לקוח ל-Morning נכשל.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="space-y-3 rounded-md border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Morning</div>
        <Badge className={statusClass(morningMatchStatus, Boolean(morningLastSyncError))}>
          {morningLastSyncError ? "שגיאת סנכרון" : statusLabel(morningMatchStatus)}
        </Badge>
      </div>
      <div className="space-y-1 text-muted-foreground">
        <div>מזהה לקוח Morning: {morningClientId || "—"}</div>
        <div>סנכרון אחרון: {morningSyncedAt || "—"}</div>
        {morningLastSyncError ? <div className="text-destructive">{morningLastSyncError}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void loadMatches()} disabled={busyKey === "match"}>
          {busyKey === "match" ? "בודק..." : "קישור לקוח Morning"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void createRemoteClient()} disabled={busyKey === "create"}>
          {busyKey === "create" ? "יוצר..." : "יצירת לקוח ב-Morning"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void syncRemoteClient()} disabled={busyKey === "sync"}>
          {busyKey === "sync" ? "מסנכרן..." : "סנכרון פרטי חיוב"}
        </Button>
      </div>

      {candidates.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <div className="font-medium">הצעות התאמה</div>
          {candidates.map((candidate) => (
            <div key={candidate.morningClientId} className="rounded-lg border p-2">
              <div className="font-medium">{candidate.morningClientName}</div>
              <div className="text-xs text-muted-foreground">{candidate.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {candidate.email || "—"} • {candidate.phone || "—"} • {candidate.taxId || "—"}
              </div>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void confirmLink(candidate.morningClientId)}
                  disabled={busyKey === `link:${candidate.morningClientId}`}
                >
                  {busyKey === `link:${candidate.morningClientId}` ? "מקשר..." : "קשר ללקוח הזה"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <MorningDocumentsPanel customerId={customerId} documents={documents} compact />
    </div>
  );
}
