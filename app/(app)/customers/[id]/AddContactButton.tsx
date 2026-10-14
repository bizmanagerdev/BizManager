"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { offlineFetch } from "@/lib/offline-queue";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { FormDialog } from "@/components/ui/form-dialog";
import { registerReversibleCreate } from "@/lib/undo-engine";
import { waitingRowId } from "@/hooks/useLocalAdditions";
import { AddActionButton } from "@/app/(app)/customers/[id]/customerSectionUi";
import type { CustomerContactRow } from "@/app/(app)/customers/[id]/customerPageModel";

/**
 * "+ איש קשר" — add a contact straight from the customer page. The new contact
 * is handed to the page (`onAdded`) and shows at once — saved with no
 * connection too, marked as waiting — instead of after the page is read again.
 */
export default function AddContactButton({
  customerId,
  customerName,
  onAdded,
  onUndone,
}: {
  customerId: string;
  customerName: string;
  onAdded: (contact: CustomerContactRow) => void;
  /** The add was undone (the toast's "בטל"): the contact is inactive again. */
  onUndone: (contactId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  function openDialog() {
    setError("");
    setName("");
    setRole("");
    setPhone("");
    setWhatsapp("");
    setEmail("");
    setNotes("");
    setIsPrimary(false);
    setOpen(true);
  }

  async function submit() {
    if (busy) return;
    if (!name.trim()) {
      setError("יש למלא שם איש קשר.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = {
        customer_id: customerId,
        full_name: name.trim(),
        role: role.trim() || null,
        phone: phone.trim() || null,
        whatsapp: whatsapp.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
        is_primary: isPrimary,
        active: true,
      };
      const result = await offlineFetch("/api/customer-contacts/create", body, "איש קשר חדש", { idempotent: true });
      if (!result.queued && !result.ok) {
        setError(toHebrewError(result.error, "יצירת איש קשר נכשלה."));
        return;
      }
      setOpen(false);
      const saved = result.queued ? null : ((result.data as { contact?: Record<string, unknown> } | null)?.contact ?? null);
      const contactId = typeof saved?.id === "string" ? saved.id : null;
      onAdded({
        id: contactId ?? waitingRowId(),
        fullName: body.full_name,
        role: body.role,
        phone: typeof saved?.phone === "string" ? saved.phone : body.phone,
        email: body.email,
        whatsapp: body.whatsapp,
        isPrimary: body.is_primary,
        active: true,
        notes: body.notes,
        waiting: result.queued,
      });
      if (result.queued) return;
      if (!contactId) {
        toast.success("איש הקשר נוסף");
        return;
      }
      // Undo replays a genuine reverse call — the contact already exists
      // server-side (its id came from the response), so this can't be a
      // deferred create. There's no hard-delete route for contacts; the app's
      // own "remove contact" flow (EditCustomerDialog) already reuses this same
      // soft-delete update, so undo does the same.
      registerReversibleCreate({
        scope: "customer-contact",
        id: contactId,
        message: "איש הקשר נוסף",
        onUndo: async () => {
          const undoResult = await offlineFetch(
            "/api/customer-contacts/update",
            { id: contactId, active: false, is_primary: false },
            "ביטול הוספת איש קשר"
          );
          if (!undoResult.queued && !undoResult.ok) {
            return { ok: false, error: toHebrewError(undoResult.error, "ביטול הוספת איש הקשר נכשל.") };
          }
          onUndone(contactId);
          return { ok: true };
        },
      });
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AddActionButton label="איש קשר" ariaLabel="הוספת איש קשר" onClick={openDialog} />
      <FormDialog
        open={open}
        onOpenChange={setOpen}
        title="הוספת איש קשר"
        description={`לקוח: ${customerName}`}
        onSubmit={() => void submit()}
        submitLabel="יצירת איש קשר"
        busyLabel="יוצר..."
        busy={busy}
        error={error || undefined}
      >
        <>
          <Field label="שם מלא *">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="תפקיד">
            <Input value={role} onChange={(e) => setRole(e.target.value)} />
          </Field>
          <AdaptiveGrid variant="formTwo">
            <Field label="טלפון">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
            </Field>
            <Field label="וואטסאפ">
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} dir="ltr" />
            </Field>
          </AdaptiveGrid>
          <Field label="אימייל">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </Field>
          <Field label="הערות">
            <div className="relative">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="pe-11" />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                disabled={busy}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </Field>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            <span>איש קשר ראשי</span>
          </label>
        </>
      </FormDialog>
    </>
  );
}
