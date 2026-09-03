"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { offlineUpload } from "@/lib/offline-upload";
import { FormDialog } from "@/components/ui/form-dialog";
import { registerReversibleAction } from "@/lib/undo-engine";

/** "+ מסמך" — upload documents linked to this customer, from the customer page. */
export default function AddCustomerDocumentButton({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState("");

  function openDialog() {
    setError("");
    setFiles([]);
    setCategory("");
    setOpen(true);
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
      let uploaded = 0;
      // uploaded + queued files are both "done" (removed on close/retry); a
      // queued upload was saved to the device and will replay when the
      // connection returns (ConnectionToasts announces it), so it must not be
      // re-sent.
      let done = 0;
      const uploadedIds: string[] = [];
      for (const file of files) {
        const fields: Record<string, string> = { customer_id: customerId };
        if (category.trim()) fields.category = category.trim();
        const result = await offlineUpload("/api/documents/upload", {
          fields,
          file,
          label: file.name,
        });
        if (result.queued) {
          done += 1;
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
          const data = result.data as { document?: { id?: string } } | null;
          if (data?.document?.id) uploadedIds.push(data.document.id);
        } else {
          setError(result.error || `העלאת ${file.name} נכשלה.`);
          break;
        }
      }
      if (uploaded > 0) {
        router.refresh();
        const message = uploaded === 1 ? "המסמך הועלה" : `${uploaded} מסמכים הועלו`;
        if (uploadedIds.length > 0) {
          // The document(s) already exist server-side (uploaded straight to
          // storage) — can't be a deferred create, so undo replays the same
          // delete route the documents archive page already uses, once per
          // uploaded file.
          registerReversibleAction({
            key: `customer-document:${customerId}:${Date.now()}`,
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
              router.refresh();
              return { ok: true };
            },
          });
        } else {
          toast.success(message);
        }
      }
      if (done === files.length) {
        setOpen(false);
      } else {
        // Keep only the files that didn't make it, so retry won't duplicate.
        setFiles(files.slice(done));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
        onClick={openDialog}
      >
        + מסמך
      </Button>
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
            <FileUploadActions
              files={files}
              onFilesSelected={setFiles}
              multiple
              disabled={busy}
              chooseLabel="בחירת קבצים"
            />
            <div className="space-y-1">
              <label className="text-sm font-medium">קטגוריה (אופציונלי)</label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="למשל: חוזה, תעודת משלוח..."
                disabled={busy}
              />
            </div>
          </div>
      </FormDialog>
    </>
  );
}
