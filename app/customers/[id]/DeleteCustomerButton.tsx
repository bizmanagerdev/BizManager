"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function DeleteCustomerButton({
  customerId,
  customerName,
  returnHref,
  iconOnly = false,
  className,
}: {
  customerId: string;
  customerName: string;
  returnHref: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openConfirm() {
    setError(null);
    setOpen(true);
  }

  function handleOpenChange(next: boolean) {
    if (loading) return;
    if (!next) setError(null);
    setOpen(next);
  }

  async function onConfirm() {
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/customers/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: customerId }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };

      if (!res.ok || !json.ok) {
        setError(json.error ?? "מחיקת לקוח נכשלה.");
        return;
      }

      emitNavigationStart();
      setOpen(false);
      router.push(returnHref);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {iconOnly ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          className={className ?? "h-9 w-9 rounded-xl"}
          onClick={openConfirm}
          aria-label="מחיקת לקוח"
          title="מחיקת לקוח"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <Button type="button" variant="destructive" size="sm" className={className} onClick={openConfirm}>
          מחיקת לקוח
        </Button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="text-right">
          <DialogHeader className="text-right">
            <DialogTitle>מחיקת לקוח</DialogTitle>
            <DialogDescription>
              האם למחוק את הלקוח &quot;{customerName}&quot;? הפעולה אינה הפיכה.
            </DialogDescription>
          </DialogHeader>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onConfirm()}
              disabled={loading}
            >
              {loading ? "מוחק..." : "מחיקה"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
