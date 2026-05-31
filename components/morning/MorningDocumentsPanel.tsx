"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { MorningLocalDocument } from "@/lib/morning/types";

type IssueKind = "quote" | "invoice" | "receipt" | "invoice-receipt";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function formatAmount(value: number | string | null | undefined, currency = "ILS") {
  if (value === null || value === undefined) return "—";
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: currency || "ILS",
    maximumFractionDigits: 2,
  }).format(amount);
}

function documentStatusLabel(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "0":
    case "created":
      return "נוצרה";
    case "1":
    case "sent":
      return "נשלחה";
    case "2":
    case "paid":
      return "שולמה";
    case "closed":
      return "נסגרה";
    case "cancelled":
      return "בוטלה";
    default:
      return value || "ללא סטטוס";
  }
}

function statusClass(value: string | null | undefined) {
  switch ((value ?? "").toLowerCase()) {
    case "2":
    case "paid":
    case "closed":
      return "bg-success text-success-foreground border-transparent";
    case "cancelled":
      return "bg-destructive text-destructive-foreground border-transparent";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

export default function MorningDocumentsPanel({
  customerId,
  orderId,
  projectId,
  paymentId,
  documents,
  allowQuote = false,
  allowInvoice = false,
  allowReceipt = false,
  allowInvoiceReceipt = false,
  onChanged,
  compact = false,
}: {
  customerId: string;
  orderId?: string;
  projectId?: string;
  paymentId?: string;
  documents: MorningLocalDocument[];
  allowQuote?: boolean;
  allowInvoice?: boolean;
  allowReceipt?: boolean;
  allowInvoiceReceipt?: boolean;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const [docs, setDocs] = useState<MorningLocalDocument[]>(documents);
  const [busyKey, setBusyKey] = useState<string>("");
  const [editing, setEditing] = useState<MorningLocalDocument | null>(null);
  const [editNotes, setEditNotes] = useState<string>("");

  useEffect(() => {
    setDocs(documents);
  }, [documents]);

  const sortedDocs = useMemo(
    () =>
      [...docs].sort((a, b) => {
        return (b.issued_at ?? "").localeCompare(a.issued_at ?? "");
      }),
    [docs]
  );

  async function issue(kind: IssueKind) {
    const route =
      kind === "quote"
        ? "/api/morning/quotes"
        : kind === "invoice"
          ? "/api/morning/invoices"
          : kind === "receipt"
            ? "/api/morning/receipts"
            : "/api/morning/invoice-receipts";

    const body =
      kind === "receipt" || kind === "invoice-receipt"
        ? { paymentId }
        : {
            customerId,
            orderId,
            projectId,
          };

    setBusyKey(kind);
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        morningDocument?: MorningLocalDocument;
      };
      if (!response.ok) throw new Error(json.error ?? "פעולת Morning נכשלה.");
      const nextDocument = json.morningDocument;
      if (nextDocument) {
        setDocs((current) => [nextDocument, ...current]);
      }
      toast.success("המסמך נוצר ב-Morning");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "פעולת Morning נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  async function syncDocument(localId: string) {
    setBusyKey(`sync:${localId}`);
    try {
      const response = await fetch(`/api/morning/documents/${localId}/sync`, { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        document?: MorningLocalDocument;
      };
      if (!response.ok) throw new Error(json.error ?? "סנכרון מסמך Morning נכשל.");
      const nextDocument = json.document;
      if (nextDocument) {
        setDocs((current) => current.map((item) => (item.id === localId ? nextDocument : item)));
      }
      toast.success("מסמך Morning סונכרן");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "סנכרון מסמך Morning נכשל.");
    } finally {
      setBusyKey("");
    }
  }

  async function deleteDocument(localId: string) {
    const confirmed = typeof window !== "undefined"
      ? window.confirm(
          "המסמך יוסר מ-BizH בלבד. הוא ימשיך להתקיים ב-Morning ולא יבוטל שם. להמשיך?"
        )
      : true;
    if (!confirmed) return;
    setBusyKey(`delete:${localId}`);
    try {
      const response = await fetch(`/api/morning/documents/${localId}`, { method: "DELETE" });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "מחיקת מסמך Morning נכשלה.");
      setDocs((current) => current.filter((item) => item.id !== localId));
      toast.success("המסמך הוסר מ-BizH");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "מחיקת מסמך Morning נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  function startEdit(document: MorningLocalDocument) {
    setEditing(document);
    setEditNotes(document.notes ?? "");
  }

  async function saveEdit() {
    if (!editing) return;
    setBusyKey(`edit:${editing.id}`);
    try {
      const response = await fetch(`/api/morning/documents/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editNotes.trim() ? editNotes.trim() : null }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        document?: MorningLocalDocument;
      };
      if (!response.ok) throw new Error(json.error ?? "עדכון מסמך Morning נכשל.");
      if (json.document) {
        setDocs((current) => current.map((item) => (item.id === editing.id ? json.document! : item)));
      }
      toast.success("המסמך עודכן");
      setEditing(null);
      setEditNotes("");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "עדכון מסמך Morning נכשל.");
    } finally {
      setBusyKey("");
    }
  }

  async function closeDocument(localId: string) {
    setBusyKey(`close:${localId}`);
    try {
      const response = await fetch(`/api/morning/documents/${localId}/close`, { method: "POST" });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        document?: MorningLocalDocument;
      };
      if (!response.ok) throw new Error(json.error ?? "סגירת מסמך Morning נכשלה.");
      const nextDocument = json.document;
      if (nextDocument) {
        setDocs((current) => current.map((item) => (item.id === localId ? nextDocument : item)));
      }
      toast.success("מסמך Morning נסגר");
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "סגירת מסמך Morning נכשלה.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="space-y-3">
      {(allowQuote || allowInvoice || allowReceipt || allowInvoiceReceipt) ? (
        <div className={`flex flex-wrap gap-2 ${compact ? "" : "justify-end"}`}>
          {allowQuote ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void issue("quote")} disabled={busyKey === "quote"}>
              {busyKey === "quote" ? "יוצר..." : "יצירת הצעת מחיר"}
            </Button>
          ) : null}
          {allowInvoice ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void issue("invoice")} disabled={busyKey === "invoice"}>
              {busyKey === "invoice" ? "יוצר..." : "יצירת חשבונית"}
            </Button>
          ) : null}
          {allowReceipt ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void issue("receipt")}
              disabled={!paymentId || busyKey === "receipt"}
            >
              {busyKey === "receipt" ? "יוצר..." : "יצירת קבלה"}
            </Button>
          ) : null}
          {allowInvoiceReceipt ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void issue("invoice-receipt")}
              disabled={!paymentId || busyKey === "invoice-receipt"}
            >
              {busyKey === "invoice-receipt" ? "יוצר..." : "חשבונית + קבלה"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {sortedDocs.length === 0 ? (
        compact ? null : (
          <div className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
            אין מסמכי Morning מקומיים להצגה.
          </div>
        )
      ) : (
        <div className="space-y-2">
          {sortedDocs.map((document) => (
            <div key={document.id} className="rounded-xl border bg-background/70 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {document.document_type_label}
                  {document.morning_document_number ? ` #${document.morning_document_number}` : ""}
                </div>
                <Badge className={statusClass(document.status)}>{documentStatusLabel(document.status)}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatDate(document.issued_at)} • {formatAmount(document.amount, document.currency ?? "ILS")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {document.pdf_url ? (
                  <a
                    href={document.pdf_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                  >
                    PDF
                  </a>
                ) : null}
                {document.morning_url ? (
                  <a
                    href={document.morning_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                  >
                    פתיחה ב-Morning
                  </a>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => void syncDocument(document.id)}
                  disabled={busyKey === `sync:${document.id}`}
                >
                  {busyKey === `sync:${document.id}` ? "מסנכרן..." : "סנכרון"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => startEdit(document)}
                  disabled={busyKey === `edit:${document.id}`}
                  title="הוספת/עריכת הערה פנימית. מסמך החשבונית עצמו ב-Morning אינו ניתן לעריכה (חוק מע״מ)."
                >
                  הערה
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive"
                  onClick={() => void deleteDocument(document.id)}
                  disabled={busyKey === `delete:${document.id}`}
                >
                  {busyKey === `delete:${document.id}` ? "מוחק..." : "מחיקה"}
                </Button>
                {document.status !== "closed" && document.status !== "cancelled" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => void closeDocument(document.id)}
                    disabled={busyKey === `close:${document.id}`}
                  >
                    {busyKey === `close:${document.id}` ? "סוגר..." : "סגירה"}
                  </Button>
                ) : null}
              </div>
              {document.notes ? (
                <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                  {document.notes}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setEditNotes("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>עריכת הערה למסמך</DialogTitle>
            <DialogDescription>
              ההערה נשמרת ב-BizH בלבד ולא מתעדכנת ב-Morning. שימושי לסימון פנימי.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editNotes}
            onChange={(event) => setEditNotes(event.target.value)}
            placeholder="הערה למסמך..."
            rows={4}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(null);
                setEditNotes("");
              }}
            >
              ביטול
            </Button>
            <Button
              type="button"
              onClick={() => void saveEdit()}
              disabled={editing !== null && busyKey === `edit:${editing.id}`}
            >
              {editing !== null && busyKey === `edit:${editing.id}` ? "שומר..." : "שמירה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
