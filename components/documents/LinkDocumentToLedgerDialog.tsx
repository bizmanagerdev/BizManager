"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { OptionRow } from "@/components/ui/option-row";
import { toHebrewError } from "@/lib/error-messages";
import {
  findLedgerCandidates,
  linkDocumentToLedger,
  type LedgerCandidate,
} from "@/lib/documents/moneyLink";

// "שיוך להוצאה או לתשלום" — ties a money document to the transaction it
// documents, without re-uploading the file.
//
// The alternative people reach for is opening the expense and attaching the
// file there, which creates a SECOND copy of the same document. This links the
// one that already exists.

function formatAmount(value: number | null) {
  if (value === null) return "";
  return `₪${value.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;
}

export default function LinkDocumentToLedgerDialog({
  documentId,
  documentTitle,
  open,
  onOpenChange,
  onLinked,
}: {
  documentId: string | null;
  documentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LedgerCandidate[] | null>(null);
  const [selected, setSelected] = useState<LedgerCandidate | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(null);
    setCandidates(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Debounced so typing an amount does not fire a query per keystroke.
    const timer = setTimeout(() => {
      findLedgerCandidates(query)
        .then((rows) => {
          if (!cancelled) setCandidates(rows);
        })
        .catch(() => setCandidates([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  const rows = useMemo(() => candidates ?? [], [candidates]);

  async function save() {
    if (!documentId || !selected || busy) return;
    setBusy(true);
    try {
      const result = await linkDocumentToLedger(documentId, selected.entityType, selected.id);
      if (!result.ok) {
        toast.error(toHebrewError(result.error, "השיוך נכשל."));
        return;
      }
      toast.success("המסמך שויך לתנועה");
      onOpenChange(false);
      onLinked?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="שיוך להוצאה או לתשלום"
      description={documentTitle}
      size="formMd"
      onSubmit={() => void save()}
      submitLabel="שיוך"
      busyLabel="משייך..."
      busy={busy}
      submitDisabled={!selected}
    >
      <div className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">חיפוש</span>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="תיאור, ספק או סכום"
            disabled={busy}
          />
        </label>

        {candidates === null ? (
          <p className="text-sm text-muted-foreground">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו תנועות מתאימות.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <OptionRow
                key={`${row.entityType}-${row.id}`}
                label={row.label}
                sub={[row.entityType === "expense" ? "הוצאה" : "תשלום", row.date, formatAmount(row.amount)]
                  .filter(Boolean)
                  .join(" · ")}
                selected={selected?.id === row.id && selected?.entityType === row.entityType}
                onClick={() => setSelected(row)}
              />
            ))}
          </div>
        )}
      </div>
    </FormDialog>
  );
}
