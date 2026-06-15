"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdaptiveDialog,
  AdaptiveGrid,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CITY_OPTIONS } from "@/lib/ui/cities";

function splitAddressIntoCityAndStreet(address: string | null): { city: string; street: string } {
  if (!address) return { city: "", street: "" };
  const idx = address.indexOf("|");
  if (idx === -1) return { city: address.trim(), street: "" };
  return {
    city: address.slice(0, idx).trim(),
    street: address.slice(idx + 1).trim(),
  };
}

type Row = Record<string, unknown>;

const s = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};

export type EditCustomerInput = {
  id: string;
  name: string;
  name_for_invoice: string | null;
  registration_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  requires_prepayment: boolean;
  contacts?: Row[];
};

export type EditCustomerSavedPayload = {
  customer: Row;
  contacts: Row[];
};

type EditContactDraft = {
  key: string;
  id: string | null;
  full_name: string;
  role: string;
  phone: string;
  email: string;
  whatsapp: string;
  notes: string;
  is_primary: boolean;
  active: boolean;
  _deleted: boolean;
};

let editContactKeyCounter = 0;
function nextContactKey() {
  editContactKeyCounter += 1;
  return `c${editContactKeyCounter}`;
}

function contactRowToDraft(row: Row): EditContactDraft {
  return {
    key: nextContactKey(),
    id: typeof row.id === "string" && row.id ? row.id : null,
    full_name: s(row, "full_name"),
    role: s(row, "role"),
    phone: s(row, "phone"),
    email: s(row, "email"),
    whatsapp: s(row, "whatsapp"),
    notes: s(row, "notes"),
    is_primary: row.is_primary === true,
    active: row.active !== false,
    _deleted: false,
  };
}

function emptyContactDraft(makePrimary: boolean): EditContactDraft {
  return {
    key: nextContactKey(),
    id: null,
    full_name: "",
    role: "",
    phone: "",
    email: "",
    whatsapp: "",
    notes: "",
    is_primary: makePrimary,
    active: true,
    _deleted: false,
  };
}

export interface EditCustomerDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  customer: EditCustomerInput | null;
  onSaved: (payload: EditCustomerSavedPayload) => void;
}

export function EditCustomerDialog({ open, onOpenChange, customer, onSaved }: EditCustomerDialogProps) {
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [invoiceName, setInvoiceName] = useState("");
  const [reg, setReg] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [cityOther, setCityOther] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [requiresPrepayment, setRequiresPrepayment] = useState(false);

  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<EditContactDraft[]>([]);

  useEffect(() => {
    if (!open || !customer) return;
    setErr("");
    setName(customer.name ?? "");
    setInvoiceName(customer.name_for_invoice ?? "");
    setReg(customer.registration_number ?? "");
    setPhone(customer.phone ?? "");
    setWhatsapp(typeof customer.whatsapp === "number" ? String(customer.whatsapp) : (customer.whatsapp ?? ""));
    setEmail(customer.email ?? "");
    const { city: parsedCity, street: parsedStreet } = splitAddressIntoCityAndStreet(customer.address ?? null);
    if (parsedCity && (CITY_OPTIONS as readonly string[]).includes(parsedCity)) {
      setCity(parsedCity);
      setCityOther("");
    } else if (parsedCity) {
      setCity("אחר");
      setCityOther(parsedCity);
    } else {
      setCity("");
      setCityOther("");
    }
    setAddress(parsedStreet);
    setNotes(customer.notes ?? "");
    setActive(customer.active);
    setRequiresPrepayment(customer.requires_prepayment);
    setContacts((customer.contacts ?? []).map(contactRowToDraft));

    if (!customer.id) return;
    setContactsLoading(true);
    void fetch(`/api/customer-contacts/list?customer_id=${encodeURIComponent(customer.id)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { contacts?: Row[] };
        setContacts((json.contacts ?? []).map(contactRowToDraft));
      })
      .catch(() => { /* ignore */ })
      .finally(() => setContactsLoading(false));
  }, [open, customer]);

  function updateContact(key: string, patch: Partial<EditContactDraft>) {
    setContacts((prev) =>
      prev.map((c) => {
        if (c.key !== key) {
          if (patch.is_primary === true) return { ...c, is_primary: false };
          return c;
        }
        const next = { ...c, ...patch };
        if (patch.active === false) next.is_primary = false;
        return next;
      })
    );
  }

  function addContact() {
    setContacts((prev) => {
      const hasPrimary = prev.some((c) => !c._deleted && c.is_primary);
      return [...prev, emptyContactDraft(!hasPrimary)];
    });
  }

  function removeContact(key: string) {
    setContacts((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, _deleted: true, is_primary: false } : c))
        .filter((c) => c.id !== null || !c._deleted)
    );
  }

  async function save() {
    if (loading || !customer) return;
    setErr("");
    if (!customer.id) return setErr("חסר מזהה לקוח.");
    if (!name.trim()) return setErr("יש למלא שם לקוח.");

    const visible = contacts.filter((c) => !c._deleted);
    const missing = visible.find((c) => !c.full_name.trim());
    if (missing) return setErr("יש למלא שם מלא בכל איש קשר.");
    const primaries = visible.filter((c) => c.is_primary && c.active);
    if (primaries.length > 1) return setErr("ניתן לסמן רק איש קשר ראשי אחד.");

    const finalCity = city === "אחר" ? cityOther.trim() : city.trim();
    const trimmedStreet = address.trim();
    const combinedAddress = finalCity
      ? trimmedStreet
        ? `${finalCity} | ${trimmedStreet}`
        : finalCity
      : trimmedStreet || null;

    setLoading(true);
    try {
      const res = await fetch("/api/customers/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: customer.id,
          name: name.trim(),
          name_for_invoice: invoiceName.trim() || null,
          registration_number: reg.trim() || null,
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          address: combinedAddress,
          notes: notes.trim() || null,
          active,
          requires_prepayment: requiresPrepayment,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; customer?: Row };
      if (!res.ok || !json.customer) {
        return setErr(toHebrewError(json.error, "עדכון לקוח נכשל."));
      }

      const savedContacts: Row[] = [];
      for (const contact of contacts) {
        if (contact._deleted) {
          if (!contact.id) continue;
          const delRes = await fetch("/api/customer-contacts/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: contact.id, active: false, is_primary: false }),
          });
          if (!delRes.ok) {
            const delJson = (await delRes.json().catch(() => ({}))) as { error?: string };
            return setErr(toHebrewError(delJson.error, `הסרת איש קשר נכשלה (${contact.full_name || contact.id}).`));
          }
          continue;
        }

        const payload = {
          full_name: contact.full_name.trim(),
          role: contact.role.trim() || null,
          phone: contact.phone.trim() || null,
          email: contact.email.trim() || null,
          whatsapp: contact.whatsapp.trim() || null,
          notes: contact.notes.trim() || null,
          is_primary: contact.active ? contact.is_primary : false,
          active: contact.active,
        };

        if (contact.id) {
          const upRes = await fetch("/api/customer-contacts/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: contact.id, ...payload }),
          });
          const upJson = (await upRes.json().catch(() => ({}))) as { error?: string; contact?: Row };
          if (!upRes.ok || !upJson.contact) {
            return setErr(toHebrewError(upJson.error, `עדכון איש קשר נכשל (${payload.full_name}).`));
          }
          savedContacts.push(upJson.contact);
        } else {
          const crRes = await fetch("/api/customer-contacts/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ customer_id: customer.id, ...payload }),
          });
          const crJson = (await crRes.json().catch(() => ({}))) as { error?: string; contact?: Row };
          if (!crRes.ok || !crJson.contact) {
            return setErr(toHebrewError(crJson.error, `יצירת איש קשר נכשלה (${payload.full_name}).`));
          }
          savedContacts.push(crJson.contact);
        }
      }

      toast.success("פרטי הלקוח נשמרו");
      onSaved({ customer: json.customer, contacts: savedContacts.filter((c) => c.active !== false) });
      onOpenChange(false);
    } catch (e: unknown) {
      setErr(toHebrewError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && loading) return;
        onOpenChange(next);
      }}
    >
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>עריכת לקוח</DialogTitle>
          <DialogDescription>עדכון פרטי לקוח ופרטי חשבונית.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={loading} className="space-y-3">
            <Field label="שם לקוח *">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <AdaptiveGrid variant="formTwo">
              <Field label="טלפון">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field label="וואטסאפ">
                <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
              </Field>
              <Field label="אימייל">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </AdaptiveGrid>
            <Field label="שם לחשבונית">
              <Input value={invoiceName} onChange={(e) => setInvoiceName(e.target.value)} placeholder="אם שונה משם הלקוח" />
            </Field>
            <Field label="ח.פ / ת.ז">
              <Input value={reg} onChange={(e) => setReg(e.target.value)} />
            </Field>
            <Field label="עיר">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">בחר עיר...</option>
                {CITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            {city === "אחר" ? (
              <Field label="עיר (הקלדה חופשית)">
                <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} />
              </Field>
            ) : null}
            <Field label="כתובת">
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="רחוב ומספר" />
            </Field>
            <Field label="הערות">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresPrepayment}
                onChange={(e) => setRequiresPrepayment(e.target.checked)}
              />
              <span>לקוח ברשימת תשלום מראש</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              <span>לקוח פעיל</span>
            </label>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">אנשי קשר</div>
                  <div className="text-xs text-muted-foreground">
                    {contactsLoading ? "טוען אנשי קשר..." : "אפשר להוסיף, לערוך או להסיר אנשי קשר."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addContact}>
                  הוספת איש קשר
                </Button>
              </div>
              {contacts.filter((c) => !c._deleted).length === 0 && !contactsLoading ? (
                <p className="text-xs text-muted-foreground">אין עדיין אנשי קשר.</p>
              ) : null}
              {contacts
                .filter((c) => !c._deleted)
                .map((contact, index) => (
                  <div key={contact.key} className="space-y-3 rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {contact.id ? `איש קשר ${index + 1}` : `איש קשר חדש ${index + 1}`}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeContact(contact.key)}
                      >
                        הסרה
                      </Button>
                    </div>
                    <Field label="שם מלא *">
                      <Input
                        value={contact.full_name}
                        onChange={(e) => updateContact(contact.key, { full_name: e.target.value })}
                      />
                    </Field>
                    <Field label="תפקיד">
                      <Input
                        value={contact.role}
                        onChange={(e) => updateContact(contact.key, { role: e.target.value })}
                      />
                    </Field>
                    <AdaptiveGrid variant="formTwo">
                      <Field label="טלפון">
                        <Input
                          value={contact.phone}
                          onChange={(e) => updateContact(contact.key, { phone: e.target.value })}
                        />
                      </Field>
                      <Field label="וואטסאפ">
                        <Input
                          value={contact.whatsapp}
                          onChange={(e) => updateContact(contact.key, { whatsapp: e.target.value })}
                        />
                      </Field>
                    </AdaptiveGrid>
                    <Field label="אימייל">
                      <Input
                        value={contact.email}
                        onChange={(e) => updateContact(contact.key, { email: e.target.value })}
                      />
                    </Field>
                    <Field label="הערות">
                      <Textarea
                        value={contact.notes}
                        onChange={(e) => updateContact(contact.key, { notes: e.target.value })}
                        rows={2}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={contact.is_primary}
                        onChange={(e) =>
                          updateContact(contact.key, {
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
                        onChange={(e) => updateContact(contact.key, { active: e.target.checked })}
                      />
                      <span>פעיל</span>
                    </label>
                  </div>
                ))}
            </div>
          </fieldset>
          {err ? <p className="text-sm text-destructive">{err}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              ביטול
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "שומר..." : "שמירת שינויים"}
            </Button>
          </DialogFooter>
          {loading ? <p className="text-xs text-muted-foreground">שומר, נא להמתין...</p> : null}
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
