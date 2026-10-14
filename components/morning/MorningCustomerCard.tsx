"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/meta-row";
import { OfflineIcon } from "@/components/ui/icons";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { formatShortDateTime } from "@/lib/date";
import { useOnline } from "@/hooks/useOfflineRows";
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

/** The customer's Morning link as the card shows it — the server's, then what this card did since. */
type MorningLink = {
  clientId: string | null;
  matchStatus: string | null;
  syncedAt: string | null;
  lastError: string | null;
};

function buildMorningClientUrl(morningClientId: string | null | undefined) {
  if (!morningClientId) return null;

  const template = process.env.NEXT_PUBLIC_MORNING_CLIENT_URL_TEMPLATE?.trim();
  if (template) {
    return template.includes("{id}") ? template.replaceAll("{id}", encodeURIComponent(morningClientId)) : template;
  }

  return `https://app.greeninvoice.co.il/incomes/clients/${encodeURIComponent(morningClientId)}/documents`;
}

export function morningStatusLabel(status: string | null | undefined, hasError = false) {
  if (hasError) return "שגיאת סנכרון";
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

export function morningStatusClass(status: string | null | undefined, hasError: boolean) {
  if (hasError) return getStatusColorClasses("danger");
  switch (status) {
    case "matched":
      return getStatusColorClasses("success");
    case "manual_review":
      return getStatusColorClasses("warning");
    default:
      return getStatusColorClasses("neutral");
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
  bare = false,
  onStatusChange,
}: {
  customerId: string;
  morningClientId: string | null | undefined;
  morningMatchStatus: string | null | undefined;
  morningSyncedAt: string | null | undefined;
  morningLastSyncError: string | null | undefined;
  morningDocuments: MorningLocalDocument[];
  onChanged?: () => void;
  /** Inside a section that already frames it and names it "Morning" (the customer page). */
  bare?: boolean;
  /** The link's status as this card changes it — for a section header that shows it. */
  onStatusChange?: (status: { matchStatus: string | null; hasError: boolean }) => void;
}) {
  const online = useOnline();
  const [busyKey, setBusyKey] = useState("");
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [documents, setDocuments] = useState<MorningLocalDocument[]>(morningDocuments);
  const [seenDocuments, setSeenDocuments] = useState(morningDocuments);
  if (morningDocuments !== seenDocuments) {
    setSeenDocuments(morningDocuments);
    setDocuments(morningDocuments);
  }

  // The link as it stands after this card's own create/link/sync — the page's
  // props only change when it is read again, so the card used to keep saying
  // "לא מקושר" after a create, and a second tap made a second Morning client.
  const serverLink: MorningLink = {
    clientId: morningClientId ?? null,
    matchStatus: morningMatchStatus ?? null,
    syncedAt: morningSyncedAt ?? null,
    lastError: morningLastSyncError ?? null,
  };
  const serverKey = JSON.stringify(serverLink);
  const [seenServerKey, setSeenServerKey] = useState(serverKey);
  const [link, setLink] = useState<MorningLink>(serverLink);
  if (serverKey !== seenServerKey) {
    setSeenServerKey(serverKey);
    setLink(serverLink);
  }

  const hasError = Boolean(link.lastError);
  useEffect(() => {
    onStatusChange?.({ matchStatus: link.matchStatus, hasError });
  }, [link.matchStatus, hasError, onStatusChange]);

  const isLinked = Boolean(link.clientId);
  const morningClientUrl = buildMorningClientUrl(link.clientId);
  // Every action here talks to Morning: none can wait in the send queue.
  const offlineReason = online ? undefined : "אין חיבור — פעולות Morning זמינות כשהחיבור חוזר";
  const busy = busyKey !== "";

  function linked(clientId: string | null | undefined) {
    setLink({
      clientId: clientId ?? link.clientId,
      matchStatus: "matched",
      syncedAt: new Date().toISOString(),
      lastError: null,
    });
  }

  async function createRemoteClient() {
    if (busy) return;
    setBusyKey("create");
    try {
      const response = await fetch("/api/morning/customers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; morningClient?: { id?: string } };
      if (!response.ok) throw new Error(toHebrewError(json.error, "יצירת לקוח ב-Morning נכשלה."));
      linked(json.morningClient?.id);
      toast.success("לקוח Morning נוצר בהצלחה.");
      onChanged?.();
    } catch (error) {
      const message = toHebrewError(error, "יצירת לקוח ב-Morning נכשלה.");
      setLink((current) => ({ ...current, lastError: message }));
      toast.error(message);
    } finally {
      setBusyKey("");
    }
  }

  async function syncRemoteClient() {
    if (busy) return;
    setBusyKey("sync");
    try {
      const response = await fetch("/api/morning/customers/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; morningClient?: { id?: string } };
      if (!response.ok) throw new Error(toHebrewError(json.error, "סנכרון פרטי חיוב ל-Morning נכשל."));
      linked(json.morningClient?.id);
      toast.success("פרטי החיוב סונכרנו ל-Morning.");
      onChanged?.();
    } catch (error) {
      const message = toHebrewError(error, "סנכרון פרטי חיוב ל-Morning נכשל.");
      setLink((current) => ({ ...current, lastError: message }));
      toast.error(message);
    } finally {
      setBusyKey("");
    }
  }

  async function loadMatches() {
    if (busy) return;
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
      if (!response.ok) throw new Error(toHebrewError(json.error, "בדיקת התאמות Morning נכשלה."));
      const nextCandidates = Array.isArray(json.candidates) ? json.candidates : [];
      setCandidates(nextCandidates);
      if (json.shouldAutoMatch && json.bestCandidate?.morningClientId) {
        await confirmLink(json.bestCandidate.morningClientId, { force: true });
      } else if (nextCandidates.length === 0) {
        toast.info("לא נמצאה התאמה אוטומטית ב-Morning. אפשר ליצור לקוח חדש.");
      }
    } catch (error) {
      toast.error(toHebrewError(error, "בדיקת התאמות Morning נכשלה."));
    } finally {
      setBusyKey("");
    }
  }

  async function confirmLink(morningClientIdToLink: string, { force = false }: { force?: boolean } = {}) {
    // `force`: the automatic link inside loadMatches, which is itself the busy action.
    if (busy && !force) return;
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
      const json = (await response.json().catch(() => ({}))) as { error?: string; morningClient?: { id?: string } };
      if (!response.ok) throw new Error(toHebrewError(json.error, "קישור הלקוח ל-Morning נכשל."));
      linked(json.morningClient?.id ?? morningClientIdToLink);
      toast.success("הלקוח קושר ל-Morning.");
      setCandidates([]);
      onChanged?.();
    } catch (error) {
      toast.error(toHebrewError(error, "קישור הלקוח ל-Morning נכשל."));
    } finally {
      setBusyKey("");
    }
  }

  function openMorningClient() {
    if (!morningClientUrl) return;
    window.open(morningClientUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={bare ? "space-y-3 text-sm" : "space-y-3 rounded-md border bg-background p-3 text-sm"}>
      {bare ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-semibold">Morning</div>
          <Badge className={morningStatusClass(link.matchStatus, Boolean(link.lastError))}>
            {morningStatusLabel(link.matchStatus, Boolean(link.lastError))}
          </Badge>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailField label="מזהה לקוח Morning" value={link.clientId || "—"} valueClassName="break-all" />
        <DetailField label="סנכרון אחרון" value={formatShortDateTime(link.syncedAt, "—")} />
        {link.lastError ? (
          <DetailField
            label="שגיאת סנכרון"
            value={link.lastError}
            className="sm:col-span-2"
            valueClassName="whitespace-pre-wrap text-destructive"
          />
        ) : null}
      </div>

      {offlineReason ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <OfflineIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {offlineReason}
        </p>
      ) : null}

      {/* No connection: every Morning button is off at once (a disabled
          fieldset), the documents' own buttons included — they would only fail. */}
      <fieldset disabled={!online} className="min-w-0 space-y-3" title={offlineReason}>
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
              <Button type="button" size="sm" variant="outline" onClick={() => void syncRemoteClient()} disabled={busy}>
                {busyKey === "sync" ? "מסנכרן..." : "סנכרון פרטי חיוב"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={openMorningClient} disabled={!morningClientUrl}>
                פתיחה ב-Morning
              </Button>
            </>
          ) : (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => void loadMatches()} disabled={busy}>
                {busyKey === "match" ? "בודק..." : "איתור לקוח Morning"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void createRemoteClient()} disabled={busy}>
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

        {candidates.length > 0 && !isLinked ? (
          <div className="space-y-2 rounded-xl border border-dashed p-3">
            <div className="font-medium">התאמות אפשריות ב-Morning</div>
            {candidates.map((candidate) => (
              <div key={candidate.morningClientId} className="rounded-lg border p-2">
                <div className="font-medium">{candidate.morningClientName}</div>
                <div className="text-xs text-muted-foreground">{candidate.reason}</div>
                <MetaRow
                  className="mt-1 text-xs text-muted-foreground"
                  items={[candidate.email, candidate.phone, candidate.taxId]}
                  fallback="—"
                />
                <div className="mt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void confirmLink(candidate.morningClientId)}
                    disabled={busy}
                  >
                    {busyKey === `link:${candidate.morningClientId}` ? "מקשר..." : "קישור ללקוח זה"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <MorningDocumentsPanel customerId={customerId} documents={documents} compact />
      </fieldset>
    </div>
  );
}
