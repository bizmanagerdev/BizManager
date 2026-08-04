"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { offlineFetch } from "@/lib/offline-queue";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { FormDialog } from "@/components/ui/form-dialog";

/** "+ איש קשר" — add a contact straight from the customer details page. */
export default function AddContactButton({
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
      const result = await offlineFetch(
        "/api/customer-contacts/create",
        {
          customer_id: customerId,
          full_name: name.trim(),
          role: role.trim() || null,
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          is_primary: isPrimary,
          active: true,
        },
        "איש קשר חדש",
        { idempotent: true }
      );
      if (!result.queued && !result.ok) {
        setError(toHebrewError(result.error, "יצירת איש קשר נכשלה."));
        return;
      }
      if (!result.queued) toast.success("איש הקשר נוסף");
      setOpen(false);
      router.refresh();
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
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
        + איש קשר
      </Button>
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
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPrimary}
                  onChange={(e) => setIsPrimary(e.target.checked)}
                />
                <span>איש קשר ראשי</span>
              </label>
            </>
      </FormDialog>
    </>
  );
}
