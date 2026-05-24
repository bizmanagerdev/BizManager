"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import MorningDocumentsPanel from "@/components/morning/MorningDocumentsPanel";
import MorningQuoteDialog from "@/components/morning/MorningQuoteDialog";
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

function buildMorningClientUrl(morningClientId: string | null | undefined) {
  if (!morningClientId) return null;

  const template = process.env.NEXT_PUBLIC_MORNING_CLIENT_URL_TEMPLATE?.trim();
  if (template) {
    return template.includes("{id}") ? template.replaceAll("{id}", encodeURIComponent(morningClientId)) : template;
  }

  return `https://app.greeninvoice.co.il/incomes/clients/${encodeURIComponent(morningClientId)}/documents`;
}

function statusLabel(status: string | null | undefined) {
  switch (status) {
    case "matched":
      return "מקושר";
    case "manual_review":
      return "דורש בדיקה";
    case "ignored":
      return "הוחרג";
    case "unmatched":
    default:
      return "לא מקושר";
  }
}

function statusClass(status: string | null | undefined, hasError: boolean) {
  if (hasError) return "bg-destructive text-destructive-foreground border-transparent";
  switch (status) {
    case "matched":
      return "bg-success text-success-foreground border-transparent";
    case "manual_review":
      return "bg-warning text-warning-foreground border-transparent";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function DetailField({
  label,
  value,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`rounded-2xl border border-border/70 bg-background/70 px-4 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium leading-6 text-foreground ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
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
  const isLinked = Boolean(morningClientId);
  const morningClientUrl = buildMorningClientUrl(morningClientId);

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
      toast.success("לקוח Morning נוצר בהצלחה.");
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
      if (!response.ok) throw new Error(json.error ?? "סנכרון פרטי חיוב ל-Morning נכשל.");
      toast.success("פרטי החיוב סונכרנו ל-Morning.");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "סנכרון פרטי חיוב ל-Morning נכשל.");
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
        toast.info("לא נמצאה התאמה אוטומטית ב-Morning. אפשר ליצור לקוח חדש.");
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
      if (!response.ok) throw new Error(json.error ?? "קישור הלקוח ל-Morning נכשל.");
      toast.success("הלקוח קושר ל-Morning.");
      setCandidates([]);
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "קישור הלקוח ל-Morning נכשל.");
    } finally {
      setBusyKey("");
    }
  }

  function openMorningClient() {
    if (!morningClientUrl) return;
    window.open(morningClientUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-3 rounded-md border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">Morning</div>
        <Badge className={statusClass(morningMatchStatus, Boolean(morningLastSyncError))}>
          {morningLastSyncError ? "שגיאת סנכרון" : statusLabel(morningMatchStatus)}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DetailField label="מזהה לקוח Morning" value={morningClientId || "-"} valueClassName="break-all" />
        <DetailField label="סנכרון אחרון" value={morningSyncedAt || "-"} />
        {morningLastSyncError ? (
          <DetailField
            label="שגיאת סנכרון"
            value={morningLastSyncError}
            className="sm:col-span-2"
            valueClassName="whitespace-pre-wrap text-destructive"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {isLinked ? (
          <>
            <MorningQuoteDialog
              customerId={customerId}
              onCreated={(document) => {
                setDocuments((current) => [document, ...current]);
                onChanged?.();
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => void syncRemoteClient()} disabled={busyKey === "sync"}>
              {busyKey === "sync" ? "מסנכרן..." : "סנכרון פרטי חיוב"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={openMorningClient} disabled={!morningClientUrl}>
              פתיחה ב-Morning
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => void loadMatches()} disabled={busyKey === "match"}>
              {busyKey === "match" ? "בודק..." : "איתור לקוח Morning"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void createRemoteClient()} disabled={busyKey === "create"}>
              {busyKey === "create" ? "יוצר..." : "יצירת לקוח ב-Morning"}
            </Button>
          </>
        )}
      </div>

      {isLinked && documents.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          כרגע לא מוצגים כאן מסמכי עבר מ-Morning. אפשר לפתוח את כרטיס הלקוח ישירות ב-Morning מהכפתור כאן.
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed p-3">
          <div className="font-medium">התאמות אפשריות ב-Morning</div>
          {candidates.map((candidate) => (
            <div key={candidate.morningClientId} className="rounded-lg border p-2">
              <div className="font-medium">{candidate.morningClientName}</div>
              <div className="text-xs text-muted-foreground">{candidate.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {candidate.email || "-"} • {candidate.phone || "-"} • {candidate.taxId || "-"}
              </div>
              <div className="mt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void confirmLink(candidate.morningClientId)}
                  disabled={busyKey === `link:${candidate.morningClientId}`}
                >
                  {busyKey === `link:${candidate.morningClientId}` ? "מקשר..." : "קישור ללקוח זה"}
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
