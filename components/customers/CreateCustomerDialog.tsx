"use client";
import { toHebrewError } from "@/lib/error-messages";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { invalidateCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { Check, ChevronLeft, ChevronRight, Info, Plus, Sparkles, UserRound, Users } from "lucide-react";
import {
  AdaptiveDialog,
  AdaptiveGrid,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { offlineFetch } from "@/lib/offline-queue";

export type CreatedCustomer = {
  id: string;
  name: string;
  name_for_invoice: string | null;
  registration_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  notes: string | null;
  requires_prepayment: boolean;
};

type SimilarContact = {
  full_name: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
};

type SimilarCustomer = CreatedCustomer & { contacts?: SimilarContact[] };

type ContactDraft = {
  full_name: string;
  role: string;
  phone: string;
  email: string;
  whatsapp: string;
  notes: string;
  is_primary: boolean;
  active: boolean;
};

import { CITY_OPTIONS } from "@/lib/ui/cities";

export const CREATE_CUSTOMER_CITY_OPTIONS = CITY_OPTIONS;

type WizardStep = 1 | 2 | 3 | 4;

const WIZARD_STEPS: { n: WizardStep; label: string }[] = [
  { n: 1, label: "פרטים בסיסיים" },
  { n: 2, label: "חיוב וכתובת" },
  { n: 3, label: "אנשי קשר" },
  { n: 4, label: "סיכום" },
];

function makeEmptyContact(): ContactDraft {
  return {
    full_name: "",
    role: "",
    phone: "",
    email: "",
    whatsapp: "",
    notes: "",
    is_primary: false,
    active: true,
  };
}

export interface CreateCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CreatedCustomer, contacts: Record<string, unknown>[]) => void;
  description?: string;
}

export function CreateCustomerDialog({
  open,
  onOpenChange,
  onCreated,
  description = "שדות חובה: שם, טלפון ועיר.",
}: CreateCustomerDialogProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [nameForInvoice, setNameForInvoice] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [city, setCity] = useState("");
  const [cityOther, setCityOther] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [requiresPrepayment, setRequiresPrepayment] = useState(false);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarDismissed, setSimilarDismissed] = useState(false);

  const contactSearchValues = contacts.flatMap((c) => [c.full_name, c.phone, c.whatsapp, c.email]);
  const contactSearchKey = contactSearchValues.join("|");

  const similarTerms = useMemo(() => {
    const unique = new Set<string>();
    for (const value of [name, nameForInvoice, regNumber, phone, whatsapp, email, address, ...contactSearchValues]) {
      const trimmed = value.trim();
      if (trimmed.length >= 2) unique.add(trimmed);
    }
    return Array.from(unique);
    // contactSearchKey captures all contact field changes without depending on the array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, nameForInvoice, regNumber, phone, whatsapp, email, address, contactSearchKey]);

  const similarTermsKey = similarTerms.join("|");

  useEffect(() => {
    if (!open) return;
    if (similarDismissed) return;
    if (similarTerms.length === 0) {
      setSimilar([]);
      return;
    }
    const controller = new AbortController();
    setSimilarLoading(true);
    const timer = setTimeout(async () => {
      try {
        const responses = await Promise.all(
          similarTerms.map((term) =>
            fetch(`/api/customers/search?q=${encodeURIComponent(term)}&limit=10`, {
              signal: controller.signal,
            })
              .then((res) => (res.ok ? (res.json() as Promise<{ customers?: SimilarCustomer[] }>) : null))
              .catch(() => null)
          )
        );
        if (controller.signal.aborted) return;
        const byId = new Map<string, SimilarCustomer>();
        for (const json of responses) {
          for (const c of json?.customers ?? []) {
            const existing = byId.get(c.id);
            if (!existing) {
              byId.set(c.id, { ...c, contacts: c.contacts ? [...c.contacts] : undefined });
              continue;
            }
            if (c.contacts && c.contacts.length > 0) {
              const merged = existing.contacts ? [...existing.contacts] : [];
              for (const contact of c.contacts) {
                const dupe = merged.some(
                  (m) =>
                    m.full_name === contact.full_name &&
                    m.phone === contact.phone &&
                    m.email === contact.email &&
                    m.whatsapp === contact.whatsapp
                );
                if (!dupe) merged.push(contact);
              }
              existing.contacts = merged;
            }
          }
        }
        setSimilar(Array.from(byId.values()).slice(0, 10));
      } catch {
        // ignore — abort or network error
      } finally {
        if (!controller.signal.aborted) setSimilarLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // similarTermsKey captures changes to similarTerms without depending on the array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, similarTermsKey, similarDismissed]);

  function applyExistingCustomer(existing: CreatedCustomer) {
    // A duplicate was picked instead of creating a new customer — close the
    // wizard and open that customer's page rather than staying on the list.
    reset();
    onOpenChange(false);
    router.push(`/customers/${encodeURIComponent(existing.id)}`);
  }

  function reset() {
    setStep(1);
    setName("");
    setPhone("");
    setWhatsapp("");
    setEmail("");
    setNameForInvoice("");
    setRegNumber("");
    setCity("");
    setCityOther("");
    setAddress("");
    setNotes("");
    setRequiresPrepayment(false);
    setContacts([]);
    setError(null);
    setSimilar([]);
    setSimilarDismissed(false);
    setSimilarLoading(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function addContact() {
    setContacts((prev) => {
      const hasPrimary = prev.some((c) => c.is_primary);
      return [...prev, { ...makeEmptyContact(), is_primary: prev.length === 0 || !hasPrimary }];
    });
  }

  function updateContact(index: number, patch: Partial<ContactDraft>) {
    setContacts((prev) =>
      prev.map((c, i) => {
        if (i !== index) {
          if (patch.is_primary) return { ...c, is_primary: false };
          return c;
        }
        const next = { ...c, ...patch };
        if (patch.active === false) next.is_primary = false;
        return next;
      })
    );
  }

  function removeContact(index: number) {
    setContacts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0 || next.some((c) => c.is_primary)) return next;
      return next.map((c, i) => (i === 0 ? { ...c, is_primary: true } : c));
    });
  }

  const finalCity = city === "אחר" ? cityOther.trim() : city.trim();

  function stepError(n: WizardStep): string | null {
    if (n === 1) {
      if (!name.trim()) return "יש להזין שם לקוח.";
      if (!phone.trim()) return "יש להזין מספר טלפון.";
      if (!finalCity) return "יש לבחור עיר.";
      return null;
    }
    if (n === 3) {
      const badIdx = contacts.findIndex(
        (c) =>
          !c.full_name.trim() &&
          (c.role.trim() || c.phone.trim() || c.email.trim() || c.whatsapp.trim() || c.notes.trim())
      );
      if (badIdx >= 0) return `איש קשר ${badIdx + 1} חייב לכלול שם מלא.`;
      return null;
    }
    return null;
  }

  function canClickStep(n: WizardStep): boolean {
    if (submitting) return false;
    if (n <= step) return true;
    for (const s of WIZARD_STEPS) {
      if (s.n >= n) break;
      if (stepError(s.n)) return false;
    }
    return true;
  }

  function goToStep(n: WizardStep) {
    if (!canClickStep(n)) return;
    setError(null);
    setStep(n);
  }

  function goBack() {
    if (step > 1) {
      setError(null);
      setStep((step - 1) as WizardStep);
    }
  }

  function goNext() {
    if (step === 4) {
      void submit();
      return;
    }
    const validation = stepError(step);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setStep((step + 1) as WizardStep);
  }

  async function submit() {
    if (submitting) return;
    setError(null);

    const trimName = name.trim();
    const trimPhone = phone.trim();

    const firstInvalid = WIZARD_STEPS.map((s) => ({ n: s.n, error: stepError(s.n) })).find((s) => s.error);
    if (firstInvalid?.error) {
      setStep(firstInvalid.n);
      setError(firstInvalid.error);
      return;
    }

    const prepared = contacts
      .map((c) => ({
        full_name: c.full_name.trim(),
        role: c.role.trim() || null,
        phone: c.phone.trim() || null,
        email: c.email.trim() || null,
        whatsapp: c.whatsapp.trim() || null,
        notes: c.notes.trim() || null,
        is_primary: c.active ? c.is_primary : false,
        active: c.active,
      }))
      .filter((c) => c.full_name || c.role || c.phone || c.email || c.whatsapp || c.notes);

    const hasPrimary = prepared.some((c) => c.is_primary);
    const normalized = prepared.map((c, i) => ({
      ...c,
      is_primary: hasPrimary ? c.is_primary : i === 0,
    }));

    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/customers/create",
        {
          name: trimName,
          name_for_invoice: nameForInvoice.trim() || null,
          registration_number: regNumber.trim() || null,
          phone: trimPhone || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          city: finalCity,
          address: address.trim() || null,
          notes: notes.trim() || null,
          requires_prepayment: requiresPrepayment,
        },
        "לקוח חדש",
        { idempotent: true }
      );

      if (result.queued) {
        // The customer is queued for creation on reconnect. We can't create its
        // contacts now (they need the new customer's id) or hand a real id to the
        // parent, so just close — the global toast tells the user it's saved and
        // it will appear in the list after sync.
        reset();
        onOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, "יצירת לקוח נכשלה."));
        return;
      }
      const json = result.data as { customer?: Record<string, unknown> } | null;
      if (!json?.customer) {
        setError("יצירת לקוח נכשלה.");
        return;
      }

      const raw = json.customer;
      const customerId = typeof raw.id === "string" ? raw.id : "";

      const createdContacts: Record<string, unknown>[] = [];
      for (const [idx, contact] of normalized.entries()) {
        const contactResult = await offlineFetch(
          "/api/customer-contacts/create",
          { customer_id: customerId, ...contact },
          "איש קשר חדש",
          { idempotent: true }
        );
        if (contactResult.queued) continue;
        const contactJson = contactResult.ok
          ? (contactResult.data as { contact?: Record<string, unknown> } | null)
          : null;
        if (!contactResult.ok || !contactJson?.contact) {
          const detail = contact.full_name || `#${idx + 1}`;
          if (typeof window !== "undefined") {
            window.alert(
              (contactResult.ok ? undefined : contactResult.error) ??
                `הלקוח נוצר, אבל איש הקשר ${detail} לא נוצר בהצלחה.`
            );
          }
          break;
        }
        createdContacts.push(contactJson.contact);
      }

      const customer: CreatedCustomer = {
        id: customerId,
        name: (typeof raw.name === "string" ? raw.name : null) ?? trimName,
        name_for_invoice: typeof raw.name_for_invoice === "string" ? raw.name_for_invoice : null,
        registration_number: typeof raw.registration_number === "string" ? raw.registration_number : null,
        phone: typeof raw.phone === "string" ? raw.phone : null,
        whatsapp: typeof raw.whatsapp === "string" ? raw.whatsapp : null,
        email: typeof raw.email === "string" ? raw.email : null,
        address: typeof raw.address === "string" ? raw.address : null,
        active: raw.active !== false,
        notes: typeof raw.notes === "string" ? raw.notes : null,
        requires_prepayment: raw.requires_prepayment === true,
      };

      invalidateCustomerSearchIndex();
      onCreated(customer, createdContacts);
      reset();
      onOpenChange(false);
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setSubmitting(false);
    }
  }

  const visibleContactsCount = contacts.length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <AdaptiveDialog
        size="formLg"
        className="flex max-h-[92svh] flex-col gap-0 overflow-y-hidden p-0 sm:p-0"
      >
        {/* Pinned top bar: title + step progress. Stays put while the body scrolls. */}
        <div className="shrink-0 space-y-2 border-b border-border/70 bg-background px-4 py-3 sm:px-6">
          <DialogHeader className="space-y-1 text-start">
            <DialogTitle>הוספת לקוח חדש</DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </DialogHeader>

          <CustomerWizardStepper current={step} canClick={canClickStep} onStepClick={goToStep} />
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            goNext();
          }}
        >
          {/* Scrollable body — only this section scrolls; the bars stay pinned. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        {!similarDismissed && similar.length > 0 ? (
          <div className="sticky top-0 z-10 -mx-4 bg-background px-4 pb-2 pt-1 sm:-mx-6 sm:px-6">
          <div className="space-y-2 rounded-md border border-warning bg-warning/15 p-3 text-sm text-warning-strong">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">
                נמצאו לקוחות דומים — אולי לא צריך ליצור חדש?
              </div>
              <button
                type="button"
                className="text-xs underline opacity-80 hover:opacity-100"
                onClick={() => setSimilarDismissed(true)}
              >
                התעלם והמשך
              </button>
            </div>
            <ul className="space-y-1">
              {similar.map((match) => {
                const detailFields: Array<{ label: string; value: string }> = [];
                if (match.phone) detailFields.push({ label: "טלפון", value: match.phone });
                if (match.whatsapp && match.whatsapp !== match.phone) {
                  detailFields.push({ label: "וואטסאפ", value: match.whatsapp });
                }
                if (match.email) detailFields.push({ label: "אימייל", value: match.email });
                if (match.address) detailFields.push({ label: "כתובת", value: match.address });
                if (match.name_for_invoice && match.name_for_invoice !== match.name) {
                  detailFields.push({ label: "שם לחשבונית", value: match.name_for_invoice });
                }
                return (
                  <li
                    key={match.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        <Highlight text={match.name} terms={similarTerms} />
                      </div>
                      {detailFields.length > 0 ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {detailFields.map((field, idx) => (
                            <span key={field.label}>
                              {idx > 0 ? " · " : null}
                              {field.label}: <Highlight text={field.value} terms={similarTerms} />
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {match.contacts && match.contacts.length > 0 ? (
                        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                          {match.contacts.map((contact, idx) => {
                            const contactDetails: Array<{ label: string; value: string }> = [];
                            if (contact.phone) {
                              contactDetails.push({ label: "טלפון", value: contact.phone });
                            }
                            if (contact.whatsapp && contact.whatsapp !== contact.phone) {
                              contactDetails.push({ label: "וואטסאפ", value: contact.whatsapp });
                            }
                            if (contact.email) {
                              contactDetails.push({ label: "אימייל", value: contact.email });
                            }
                            return (
                              <li key={`${match.id}-contact-${idx}`} className="truncate">
                                <span className="opacity-70">איש קשר: </span>
                                <Highlight text={contact.full_name} terms={similarTerms} />
                                {contactDetails.map((field) => (
                                  <span key={field.label}>
                                    {" · "}
                                    {field.label}: <Highlight text={field.value} terms={similarTerms} />
                                  </span>
                                ))}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => applyExistingCustomer(match)}
                    >
                      שימוש בלקוח זה
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
          </div>
        ) : null}
        {!similarDismissed && similar.length === 0 && similarLoading ? (
          <div className="text-xs text-muted-foreground">בודק אם קיים לקוח דומה...</div>
        ) : null}

          <fieldset disabled={submitting} className="space-y-3">
            {step === 1 ? (
              <div className="space-y-3">
                <Field label="שם לקוח" required>
                  <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                </Field>

                <AdaptiveGrid variant="formTwo">
                  <Field label="טלפון" required>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
                  </Field>
                  <Field label="וואטסאפ" hint="רשות">
                    <Input
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      inputMode="tel"
                      placeholder="אם שונה מהטלפון"
                    />
                  </Field>
                </AdaptiveGrid>

                <Field label="אימייל" hint="רשות">
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>

                <Field label="עיר" required>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value=""></option>
                    {CREATE_CUSTOMER_CITY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>

                {city === "אחר" ? (
                  <Field label="עיר (הקלדה חופשית)" required>
                    <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <Field label="שם לחשבונית" hint="אם שונה משם הלקוח">
                  <Input value={nameForInvoice} onChange={(e) => setNameForInvoice(e.target.value)} />
                </Field>

                <Field label="ח.פ / ת.ז" hint="רשות">
                  <Input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} inputMode="numeric" />
                </Field>

                <Field label="כתובת" hint="רשות">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="רחוב, מספר, שכונה"
                  />
                </Field>

                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/70 px-4 py-3">
                  <div>
                    <div className="text-sm font-medium">לקוח ברשימת תשלום מראש</div>
                    <div className="text-xs text-muted-foreground">חיוב מתבצע לפני אספקה</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0"
                    checked={requiresPrepayment}
                    onChange={(e) => setRequiresPrepayment(e.target.checked)}
                  />
                </label>

                <Field label="הערות" hint="רשות">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </Field>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-secondary/35 bg-secondary/10 px-3 py-2.5 text-sm text-foreground">
                  <Info className="h-4 w-4 shrink-0 text-secondary" />
                  <span>אפשר להוסיף אנשי קשר כבר עכשיו, או לדלג ולהוסיף מאוחר יותר.</span>
                </div>

                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  אנשי קשר
                </div>

                {contacts.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    עדיין לא נוספו אנשי קשר.
                  </div>
                ) : null}

                {contacts.map((contact, index) => (
                  <div
                    key={`new-contact-${index}`}
                    className="space-y-3 rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">איש קשר {index + 1}</div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => removeContact(index)}
                      >
                        הסרה
                      </Button>
                    </div>
                    <Field label="שם מלא" required>
                      <Input
                        value={contact.full_name}
                        onChange={(e) => updateContact(index, { full_name: e.target.value })}
                      />
                    </Field>
                    <Field label="תפקיד" hint="רשות">
                      <Input
                        value={contact.role}
                        onChange={(e) => updateContact(index, { role: e.target.value })}
                      />
                    </Field>
                    <AdaptiveGrid variant="formTwo">
                      <Field label="טלפון" hint="רשות">
                        <Input
                          value={contact.phone}
                          onChange={(e) => updateContact(index, { phone: e.target.value })}
                          inputMode="tel"
                        />
                      </Field>
                      <Field label="וואטסאפ" hint="רשות">
                        <Input
                          value={contact.whatsapp}
                          onChange={(e) => updateContact(index, { whatsapp: e.target.value })}
                          inputMode="tel"
                        />
                      </Field>
                    </AdaptiveGrid>
                    <Field label="אימייל" hint="רשות">
                      <Input
                        value={contact.email}
                        onChange={(e) => updateContact(index, { email: e.target.value })}
                      />
                    </Field>
                    <Field label="הערות" hint="רשות">
                      <Textarea
                        value={contact.notes}
                        onChange={(e) => updateContact(index, { notes: e.target.value })}
                        rows={2}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={contact.is_primary}
                        onChange={(e) =>
                          updateContact(index, {
                            is_primary: e.target.checked,
                            active: e.target.checked ? true : contact.active,
                          })
                        }
                      />
                      <span>איש קשר ראשי</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={contact.active}
                        onChange={(e) => updateContact(index, { active: e.target.checked })}
                      />
                      <span>פעיל</span>
                    </label>
                  </div>
                ))}

                <div className="flex justify-end">
                  <Button type="button" variant="secondary" size="sm" onClick={addContact}>
                    <Plus className="h-4 w-4" />
                    הוספת איש קשר
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-md border border-secondary/35 bg-secondary/10 px-3 py-2.5 text-sm text-foreground">
                  <Sparkles className="h-4 w-4 shrink-0 text-secondary" />
                  <span>
                    בדקו שהכל תקין ולחצו <span className="font-semibold">יצירת לקוח</span>.
                  </span>
                </div>

                <SummarySection icon={<UserRound className="h-4 w-4" />} title="פרטי הלקוח">
                  <SummaryRow label="שם לקוח" value={name.trim()} />
                  <SummaryRow label="טלפון" value={phone.trim()} />
                  <SummaryRow label="וואטסאפ" value={whatsapp.trim()} />
                  <SummaryRow label="אימייל" value={email.trim()} />
                  <SummaryRow label="עיר" value={finalCity} />
                </SummarySection>

                <SummarySection title="חיוב וכתובת">
                  <SummaryRow label="שם לחשבונית" value={nameForInvoice.trim()} />
                  <SummaryRow label="ח.פ / ת.ז" value={regNumber.trim()} />
                  <SummaryRow label="כתובת" value={address.trim()} />
                  <SummaryRow
                    label="תשלום מראש"
                    value={requiresPrepayment ? "כן — חיוב לפני אספקה" : "לא"}
                  />
                  {notes.trim() ? <SummaryRow label="הערות" value={notes.trim()} /> : null}
                </SummarySection>

                <SummarySection icon={<Users className="h-4 w-4" />} title="אנשי קשר">
                  {visibleContactsCount === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-muted-foreground">לא נוספו אנשי קשר.</div>
                  ) : (
                    contacts.map((c, i) => (
                      <SummaryRow
                        key={`summary-contact-${i}`}
                        label={c.is_primary ? "איש קשר ראשי" : `איש קשר ${i + 1}`}
                        value={[c.full_name.trim(), c.phone.trim()].filter(Boolean).join(" · ")}
                      />
                    ))
                  )}
                </SummarySection>
              </div>
            ) : null}
          </fieldset>
          </div>

          {/* Pinned bottom bar */}
          <div className="shrink-0 space-y-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {submitting ? (
              <p className="text-xs text-muted-foreground">יוצר לקוח חדש, נא להמתין...</p>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">שלב {step} מתוך 4</span>
                {step > 1 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={goBack} disabled={submitting}>
                    <ChevronRight className="h-4 w-4" />
                    חזרה
                  </Button>
                ) : null}
              </div>
              {/* No "ביטול" button — the dialog's X already closes it, and two
                  ways out crowded the bar next to the primary action. */}
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={submitting}>
                  {step === 4 ? (
                    <>
                      <Check className="h-4 w-4" />
                      {submitting ? "יוצר..." : "יצירת לקוח"}
                    </>
                  ) : (
                    <>
                      הבא
                      <ChevronLeft className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}

/** Top progress indicator: numbered steps with labels, connected by a track. RTL-aware. */
function CustomerWizardStepper({
  current,
  canClick,
  onStepClick,
}: {
  current: WizardStep;
  canClick: (n: WizardStep) => boolean;
  onStepClick: (n: WizardStep) => void;
}) {
  return (
    <div className="flex items-start px-1 pb-1">
      {WIZARD_STEPS.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = canClick(s.n);
        return (
          <Fragment key={s.n}>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                disabled={!clickable}
                onClick={() => clickable && onStepClick(s.n)}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  active && "border-primary text-primary",
                  done && "border-primary bg-primary text-primary-foreground",
                  !active && !done && "border-border text-muted-foreground",
                  clickable && !active ? "cursor-pointer hover:border-primary/60" : "cursor-default"
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : s.n}
              </button>
              <div
                className={cn(
                  "w-16 text-center text-[10px] font-medium leading-tight",
                  active || done ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </div>
            </div>
            {i < WIZARD_STEPS.length - 1 ? (
              <div
                className={cn(
                  "mx-1 mt-[14px] h-0.5 flex-1 rounded-full sm:mx-2",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function SummarySection({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        {title}
      </div>
      <div className="divide-y rounded-xl border">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{value || "—"}</span>
    </div>
  );
}

function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
        {hint ? <span className="font-normal text-muted-foreground"> · {hint}</span> : null}
      </label>
      {children}
    </div>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function Highlight({ text, terms }: { text: string | null | undefined; terms: string[] }) {
  const safeText = typeof text === "string" ? text : text == null ? "" : String(text);
  const patterns = terms
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map(escapeRegExp);
  if (patterns.length === 0 || !safeText) return <>{safeText}</>;
  const regex = new RegExp(`(${patterns.join("|")})`, "gi");
  const parts = safeText.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 px-0.5 font-bold text-foreground dark:bg-yellow-700/60"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
