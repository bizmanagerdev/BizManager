"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { FormDialog } from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import type { MorningLocalDocument } from "@/lib/morning/types";

type LineDraft = {
  description: string;
  quantity: string;
  unitPrice: string;
};

function emptyLine(): LineDraft {
  return { description: "", quantity: "1", unitPrice: "" };
}

export default function MorningQuoteDialog({
  customerId,
  onCreated,
  triggerLabel = "הצעת מחיר חדשה",
  triggerVariant = "outline",
  triggerSize = "sm",
}: {
  customerId: string;
  onCreated?: (document: MorningLocalDocument) => void;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerSize?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetForm() {
    setLines([emptyLine()]);
    setNotes("");
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setLines((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  async function submit() {
    const normalized = lines
      .map((line) => ({
        description: line.description.trim(),
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        vatType: "include" as const,
      }))
      .filter(
        (line) =>
          line.description.length > 0 &&
          Number.isFinite(line.quantity) &&
          line.quantity > 0 &&
          Number.isFinite(line.unitPrice) &&
          line.unitPrice >= 0
      );

    if (normalized.length === 0) {
      toast.error("יש להוסיף לפחות שורה אחת עם תיאור, כמות ומחיר.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/morning/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          customLines: normalized,
          notes: notes.trim() || undefined,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        morningDocument?: MorningLocalDocument;
      };
      if (!response.ok) throw new Error(toHebrewError(json.error, "יצירת הצעת מחיר נכשלה."));
      toast.success("הצעת המחיר נוצרה ב-Morning");
      if (json.morningDocument) onCreated?.(json.morningDocument);
      setOpen(false);
      resetForm();
    } catch (error) {
      toast.error(toHebrewError(error, "יצירת הצעת מחיר נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button type="button" size={triggerSize} variant={triggerVariant} onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <FormDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetForm();
        }}
        title="הצעת מחיר חדשה"
        description="הצעה ללקוח ללא קישור להזמנה. השורות יישלחו ל-Morning כפי שהזנת."
        size="form2xl"
        onSubmit={() => void submit()}
        submitLabel="יצירת הצעת מחיר"
        busyLabel="יוצר..."
        busy={submitting}
      >

          <div className="space-y-3">
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 bg-background/70 p-3 sm:grid-cols-[1fr_100px_140px_auto]"
                >
                  <Input
                    placeholder="תיאור השורה"
                    value={line.description}
                    onChange={(event) => updateLine(index, { description: event.target.value })}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="כמות"
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  />
                  <CurrencyInput
                    type="number"
                    placeholder="מחיר ליחידה"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                  />
                  <DeleteButton
                    label="הסרת שורה"
                    onClick={() => removeLine(index)}
                    disabled={lines.length === 1}
                  />
                </div>
              ))}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={addLine}>
              + הוספת שורה
            </Button>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">הערות להצעה (אופציונלי)</label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="הערות שיופיעו על המסמך..."
                rows={3}
              />
            </div>
          </div>
      </FormDialog>
    </>
  );
}
