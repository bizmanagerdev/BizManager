"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { DOCUMENT_CATEGORIES, getDocumentCategoryLabel, isDocumentCategory } from "@/lib/documents";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { offlineUpload } from "@/lib/offline-upload";
import { uploadTogether } from "@/lib/upload-together";
import { FormDialog } from "@/components/ui/form-dialog";
import { registerReversibleAction } from "@/lib/undo-engine";
import { waitingRowId } from "@/hooks/useLocalAdditions";
import { AddActionButton } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerDocumentItem } from "@/app/(app)/customers/[id]/customerPageModel";

/** The file itself, to view and download until the page has its signed link. */
function localUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/**
 * "+ מסמך" — upload documents linked to this customer, from the customer page.
 * Each file is handed to the page (`onUploaded`) and listed at once — one that
 * waits for the connection too, marked as waiting — opened from the file on
 * this device until the page is read again.
 */
export default function AddCustomerDocumentButton({
  customerId,
  customerName,
  onUploaded,
  onUndone,
  open: openProp,
  onOpenChange,
  presetCategory,
}: {
  customerId: string;
  customerName: string;
  onUploaded: (documents: CustomerDocumentItem[]) => void;
  /** The upload was undone (the toast's "בטל"): these documents are gone. */
  onUndone: (documentIds: string[]) => void;
  /** Opened from elsewhere too (the missing-documents list's "העלאה"). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The category to start with — the missing document being uploaded. */
  presetCategory?: string;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("");
  // Each opening starts clean — on the missing document's category when it
  // was opened for one.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError("");
      setFiles([]);
      setCategory(presetCategory ?? "");
    }
  }

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }

  async function upload() {
    if (busy) return;
    if (files.length === 0) {
      setError("יש לבחור קובץ להעלאה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // uploaded + queued files are both "done" (removed on close/retry); a
      // queued upload was saved to the device and will replay when the
      // connection returns (ConnectionToasts announces it), so it must not be
      // re-sent. All files go up together (lib/upload-together.ts).
      const fields: Record<string, string> = { customer_id: customerId };
      if (category.trim()) fields.category = category.trim();
      const results = await uploadTogether(files, (file) =>
        offlineUpload("/api/documents/upload", { fields, file, label: file.name })
      );
      const added: CustomerDocumentItem[] = [];
      const uploadedIds: string[] = [];
      const remaining: File[] = [];
      results.forEach((result, i) => {
        const file = files[i]!;
        if (!result.queued && !result.ok) {
          remaining.push(file);
          return;
        }
        const saved = result.queued
          ? null
          : ((result.data as { document?: { id?: string; file_name?: string; document_type?: string; uploaded_at?: string } } | null)
              ?.document ?? null);
        if (saved?.id) uploadedIds.push(saved.id);
        added.push({
          id: saved?.id ?? waitingRowId(),
          name: saved?.file_name || file.name,
          fileName: saved?.file_name || file.name,
          type: saved?.document_type ?? (category.trim() || null),
          uploadedAt: saved?.uploaded_at ?? new Date().toISOString(),
          url: localUrl(file),
          sourceType: "customer",
          sourceId: customerId,
          waiting: result.queued,
        });
      });
      const firstFailure = results.find((result) => !result.queued && !result.ok);
      if (firstFailure && !firstFailure.queued && !firstFailure.ok) {
        setError(firstFailure.error || `העלאת ${remaining[0]!.name} נכשלה.`);
      }
      if (added.length > 0) onUploaded(added);
      const uploaded = added.filter((doc) => !doc.waiting).length;
      if (uploaded > 0) {
        const message = uploaded === 1 ? "המסמך הועלה" : `${uploaded} מסמכים הועלו`;
        if (uploadedIds.length > 0) {
          // The document(s) already exist server-side (uploaded straight to
          // storage) — can't be a deferred create, so undo replays the same
          // delete route the documents archive page already uses, once per
          // uploaded file.
          registerReversibleAction({
            key: `customer-document:${customerId}:${uploadedIds.join(",")}`,
            message,
            onUndo: async () => {
              for (const id of uploadedIds) {
                const res = await fetch("/api/documents/delete", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ document_id: id }),
                });
                if (!res.ok) {
                  const json = await res.json().catch(() => ({}));
                  return { ok: false, error: toHebrewError((json as { error?: string })?.error, "ביטול ההעלאה נכשל.") };
                }
              }
              onUndone(uploadedIds);
              return { ok: true };
            },
          });
        } else {
          toast.success(message);
        }
      }
      if (remaining.length === 0) {
        setOpen(false);
      } else {
        // Keep only the files that didn't make it, so retry won't duplicate.
        setFiles(remaining);
      }
    } finally {
      setBusy(false);
    }
  }

  const currentIsListed = !category || isDocumentCategory(category);

  return (
    <>
      <AddActionButton label="מסמך" ariaLabel="העלאת מסמך" onClick={() => setOpen(true)} />
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="העלאת מסמך"
        description={`לקוח: ${customerName}`}
        onSubmit={() => void upload()}
        submitLabel="העלאה"
        busyLabel="מעלה..."
        busy={busy}
        error={error || undefined}
      >
        <div className="space-y-3">
          <FileUploadActions files={files} onFilesSelected={setFiles} multiple disabled={busy} chooseLabel="בחירת קבצים" />
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="customer-document-category">
              קטגוריה (אופציונלי)
            </label>
            <NativeSelect
              id="customer-document-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
            >
              <option value="">ללא קטגוריה</option>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              {currentIsListed ? null : <option value={category}>{getDocumentCategoryLabel(category)}</option>}
            </NativeSelect>
          </div>
        </div>
      </FormDialog>
    </>
  );
}
