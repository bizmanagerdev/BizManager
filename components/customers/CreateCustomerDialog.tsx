"use client";

import { useEffect, useMemo, useState } from "react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
    for (const value of [name, phone, whatsapp, email, address, ...contactSearchValues]) {
      const trimmed = value.trim();
      if (trimmed.length >= 2) unique.add(trimmed);
    }
    return Array.from(unique);
    // contactSearchKey captures all contact field changes without depending on the array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, phone, whatsapp, email, address, contactSearchKey]);

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
    onCreated(existing, []);
    reset();
    onOpenChange(false);
  }

  function reset() {
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

  async function submit() {
    if (submitting) return;
    setError(null);

    const trimName = name.trim();
    const trimPhone = phone.trim();
    const finalCity = city === "אחר" ? cityOther.trim() : city.trim();

    if (!trimName) { setError("יש להזין שם לקוח."); return; }
    if (!trimPhone) { setError("יש להזין מספר טלפון."); return; }
    if (!finalCity) { setError("יש לבחור עיר."); return; }

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

    const badIdx = prepared.findIndex((c) => !c.full_name);
    if (badIdx >= 0) { setError(`איש קשר ${badIdx + 1} חייב לכלול שם מלא.`); return; }

    const hasPrimary = prepared.some((c) => c.is_primary);
    const normalized = prepared.map((c, i) => ({
      ...c,
      is_primary: hasPrimary ? c.is_primary : i === 0,
    }));

    setSubmitting(true);
    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        customer?: Record<string, unknown>;
      };

      if (!res.ok || !json.customer) {
        setError(json.error ?? "יצירת לקוח נכשלה.");
        return;
      }

      const raw = json.customer;
      const customerId = typeof raw.id === "string" ? raw.id : "";

      const createdContacts: Record<string, unknown>[] = [];
      for (const [idx, contact] of normalized.entries()) {
        const contactRes = await fetch("/api/customer-contacts/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ customer_id: customerId, ...contact }),
        });
        const contactJson = (await contactRes.json().catch(() => ({}))) as {
          error?: string;
          contact?: Record<string, unknown>;
        };
        if (!contactRes.ok || !contactJson.contact) {
          const detail = contact.full_name || `#${idx + 1}`;
          if (typeof window !== "undefined") {
            window.alert(contactJson.error ?? `הלקוח נוצר, אבל איש הקשר ${detail} לא נוצר בהצלחה.`);
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

      onCreated(customer, createdContacts);
      reset();
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>הוספת לקוח חדש</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {!similarDismissed && similar.length > 0 ? (
          <div className="sticky top-0 z-10 -mx-6 bg-background px-6 pb-2 pt-1">
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

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={submitting} className="space-y-3">
            <Field label="שם לקוח *">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>

            <AdaptiveGrid variant="formTwo">
              <Field label="טלפון *">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="וואטסאפ">
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </Field>
            </AdaptiveGrid>

            <Field label="אימייל">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>

            <Field label="שם לחשבונית">
              <Input
                value={nameForInvoice}
                onChange={(e) => setNameForInvoice(e.target.value)}
                placeholder="אם שונה משם הלקוח"
              />
            </Field>

            <Field label="ח.פ / ת.ז">
              <Input value={regNumber} onChange={(e) => setRegNumber(e.target.value)} />
            </Field>

            <Field label="עיר *">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">בחר עיר...</option>
                {CREATE_CUSTOMER_CITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            {city === "אחר" ? (
              <Field label="עיר (הקלדה חופשית) *">
                <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} />
              </Field>
            ) : null}

            <Field label="כתובת">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresPrepayment}
                onChange={(e) => setRequiresPrepayment(e.target.checked)}
              />
              <span>לקוח ברשימת תשלום מראש</span>
            </label>

            <details
              className="rounded-md border border-dashed p-3"
              open={Boolean(notes || contacts.length > 0)}
            >
              <summary className="cursor-pointer text-sm font-medium">פרטים נוספים</summary>
              <div className="mt-3 space-y-3">
                <Field label="הערות">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </Field>

                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">אנשי קשר</div>
                      <div className="text-xs text-muted-foreground">
                        אפשר להוסיף אנשי קשר כבר ביצירת הלקוח.
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addContact}>
                      הוספת איש קשר
                    </Button>
                  </div>
                  {contacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">עדיין לא נוספו אנשי קשר.</p>
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
                          variant="ghost"
                          size="sm"
                          onClick={() => removeContact(index)}
                        >
                          הסרה
                        </Button>
                      </div>
                      <Field label="שם מלא *">
                        <Input
                          value={contact.full_name}
                          onChange={(e) => updateContact(index, { full_name: e.target.value })}
                        />
                      </Field>
                      <Field label="תפקיד">
                        <Input
                          value={contact.role}
                          onChange={(e) => updateContact(index, { role: e.target.value })}
                        />
                      </Field>
                      <AdaptiveGrid variant="formTwo">
                        <Field label="טלפון">
                          <Input
                            value={contact.phone}
                            onChange={(e) => updateContact(index, { phone: e.target.value })}
                          />
                        </Field>
                        <Field label="וואטסאפ">
                          <Input
                            value={contact.whatsapp}
                            onChange={(e) => updateContact(index, { whatsapp: e.target.value })}
                          />
                        </Field>
                      </AdaptiveGrid>
                      <Field label="אימייל">
                        <Input
                          value={contact.email}
                          onChange={(e) => updateContact(index, { email: e.target.value })}
                        />
                      </Field>
                      <Field label="הערות">
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
                </div>
              </div>
            </details>
          </fieldset>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "יוצר..." : "יצירת לקוח"}
            </Button>
          </DialogFooter>
          {submitting ? (
            <p className="text-xs text-muted-foreground">יוצר לקוח חדש, נא להמתין...</p>
          ) : null}
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
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
