"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { toHebrewError } from "@/lib/error-messages";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        form.append("customer_id", customerId);
        if (category.trim()) form.append("category", category.trim());
        const res = await fetch("/api/documents/upload", { method: "POST", body: form });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setError(toHebrewError(json.error, `העלאת ${file.name} נכשלה.`));
          break;
        }
        uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "המסמך הועלה" : `${uploaded} מסמכים הועלו`);
        router.refresh();
      }
      if (uploaded === files.length) {
        setOpen(false);
      } else {
        // Keep only the files that didn't make it, so retry won't duplicate.
        setFiles(files.slice(uploaded));
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
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && busy) return;
          setOpen(next);
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>העלאת מסמך</DialogTitle>
            <DialogDescription>לקוח: {customerName}</DialogDescription>
          </DialogHeader>
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
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
                ביטול
              </Button>
              <Button type="button" onClick={() => void upload()} disabled={busy}>
                {busy ? "מעלה..." : "העלאה"}
              </Button>
            </DialogFooter>
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
