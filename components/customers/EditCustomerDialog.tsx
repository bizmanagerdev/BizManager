"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdaptiveGrid,
} from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { FormDialog } from "@/components/ui/form-dialog";
import { CITY_OPTIONS } from "@/lib/ui/cities";
import { TagPicker, fetchExistingTagIds } from "@/components/tags/TagPicker";
import { WorkerLinkField } from "@/components/customers/WorkerLinkField";
import { TagIcon } from "@/components/ui/icons";

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
  /** The users row that is the same person as this customer (worker who buys from us). */
  linked_user_id?: string | null;
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

// A customer that orders for several of its own locations (e.g. a chain) can
// carry multiple branches, each with its own delivery address/phone — same
// one-to-many-off-customers pattern as contacts above.
type EditBranchDraft = {
  key: string;
  id: string | null;
  name: string;
  address: string;
  phone: string;
  active: boolean;
  _deleted: boolean;
};

let editBranchKeyCounter = 0;
function nextBranchKey() {
  editBranchKeyCounter += 1;
  return `b${editBranchKeyCounter}`;
}

function branchRowToDraft(row: Row): EditBranchDraft {
  return {
    key: nextBranchKey(),
    id: typeof row.id === "string" && row.id ? row.id : null,
    name: s(row, "name"),
    address: s(row, "address"),
    phone: s(row, "phone"),
    active: row.active !== false,
    _deleted: false,
  };
}

function emptyBranchDraft(): EditBranchDraft {
  return {
    key: nextBranchKey(),
    id: null,
    name: "",
    address: "",
    phone: "",
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
  const [linkedUserId, setLinkedUserId] = useState("");
  // Callers that build EditCustomerInput from a list row don't carry the worker
  // link. Until it is known, `linked_user_id` is left OUT of the update payload
  // entirely — the route only touches the column when the key is present, so a
  // save that races the lookup can never silently unlink someone.
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);

  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<EditContactDraft[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branches, setBranches] = useState<EditBranchDraft[]>([]);

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
    setLinkedUserId(customer.linked_user_id ?? "");
    setLinkLoaded(customer.linked_user_id !== undefined);
    setContacts((customer.contacts ?? []).map(contactRowToDraft));
    setBranches([]);
    setTagIds([]);

    if (!customer.id) return;
    void fetchExistingTagIds("customer", customer.id).then(setTagIds);
    // Authoritative worker link, whatever the caller happened to pass.
    void fetch(`/api/customers/${encodeURIComponent(customer.id)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { customer?: Row };
        if (!json.customer) return;
        const linked = json.customer.linked_user_id;
        setLinkedUserId(typeof linked === "string" ? linked : "");
        setLinkLoaded(true);
      })
      .catch(() => { /* ignore — the link stays out of the payload */ });
    setContactsLoading(true);
    void fetch(`/api/customer-contacts/list?customer_id=${encodeURIComponent(customer.id)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { contacts?: Row[] };
        setContacts((json.contacts ?? []).map(contactRowToDraft));
      })
      .catch(() => { /* ignore */ })
      .finally(() => setContactsLoading(false));
    setBranchesLoading(true);
    void fetch(`/api/customer-branches/list?customer_id=${encodeURIComponent(customer.id)}`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { branches?: Row[] };
        setBranches((json.branches ?? []).map(branchRowToDraft));
      })
      .catch(() => { /* ignore */ })
      .finally(() => setBranchesLoading(false));
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

  function addBranch() {
    setBranches((prev) => [...prev, emptyBranchDraft()]);
  }

  function updateBranch(key: string, patch: Partial<EditBranchDraft>) {
    setBranches((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  function removeBranch(key: string) {
    setBranches((prev) =>
      prev
        .map((b) => (b.key === key ? { ...b, _deleted: true } : b))
        .filter((b) => b.id !== null || !b._deleted)
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

    const visibleBranches = branches.filter((b) => !b._deleted);
    const missingBranchName = visibleBranches.find((b) => !b.name.trim());
    if (missingBranchName) return setErr("יש למלא שם בכל סניף.");

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
          ...(linkLoaded ? { linked_user_id: linkedUserId || null } : {}),
          tag_ids: tagIds,
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

      for (const branch of branches) {
        if (branch._deleted) {
          if (!branch.id) continue;
          const delRes = await fetch("/api/customer-branches/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: branch.id, active: false }),
          });
          if (!delRes.ok) {
            const delJson = (await delRes.json().catch(() => ({}))) as { error?: string };
            return setErr(toHebrewError(delJson.error, `הסרת סניף נכשלה (${branch.name || branch.id}).`));
          }
          continue;
        }

        const branchPayload = {
          name: branch.name.trim(),
          address: branch.address.trim() || null,
          phone: branch.phone.trim() || null,
          active: branch.active,
        };

        if (branch.id) {
          const upRes = await fetch("/api/customer-branches/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: branch.id, ...branchPayload }),
          });
          if (!upRes.ok) {
            const upJson = (await upRes.json().catch(() => ({}))) as { error?: string };
            return setErr(toHebrewError(upJson.error, `עדכון סניף נכשל (${branchPayload.name}).`));
          }
        } else {
          const crRes = await fetch("/api/customer-branches/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ customer_id: customer.id, ...branchPayload }),
          });
          if (!crRes.ok) {
            const crJson = (await crRes.json().catch(() => ({}))) as { error?: string };
            return setErr(toHebrewError(crJson.error, `יצירת סניף נכשלה (${branchPayload.name}).`));
          }
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
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="עריכת לקוח"
      description="עדכון פרטי לקוח ופרטי חשבונית."
      onSubmit={() => void save()}
      submitLabel="שמירת שינויים"
      busyLabel="שומר..."
      busy={loading}
      error={err || undefined}
      bodyClassName="space-y-3"
    >
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
              <NativeSelect
                value={city}
                onChange={(e) => setCity(e.target.value)}
              >
                <option value="">בחר עיר...</option>
                {CITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </NativeSelect>
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
              <div className="relative">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="pe-11" />
                <DictateButton
                  onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                  className="absolute bottom-1 end-1 h-8 w-8"
                />
              </div>
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

            {/* Disabled until the current link is known, so a pick made mid-flight
                can't be overwritten by the lookup landing a moment later. */}
            <WorkerLinkField
              value={linkedUserId}
              onChange={setLinkedUserId}
              phones={[phone, whatsapp]}
              disabled={loading || !linkLoaded}
            />

            <TagPicker
              value={tagIds}
              onChange={setTagIds}
              kind="general"
              createKind="general"
              allowCreate
              icon={<TagIcon className="h-3.5 w-3.5" />}
              label="תגיות / סיווג לקוח"
              addLabel="הוספת תגית"
              emptyText="אין תגיות עדיין."
            />

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
                      <DeleteButton label="הסרת איש קשר" onClick={() => removeContact(contact.key)} />
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
                      <div className="relative">
                        <Textarea
                          value={contact.notes}
                          onChange={(e) => updateContact(contact.key, { notes: e.target.value })}
                          rows={2}
                          className="pe-11"
                        />
                        <DictateButton
                          onTranscript={(text) =>
                            updateContact(contact.key, { notes: appendDictatedText(contact.notes, text) })
                          }
                          className="absolute bottom-1 end-1 h-8 w-8"
                        />
                      </div>
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

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">סניפים</div>
                  <div className="text-xs text-muted-foreground">
                    {branchesLoading
                      ? "טוען סניפים..."
                      : "לקוח שמזמין עבור כמה סניפים (למשל רשת) — כל סניף עם כתובת/טלפון משלו."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addBranch}>
                  הוספת סניף
                </Button>
              </div>
              {branches.filter((b) => !b._deleted).length === 0 && !branchesLoading ? (
                <p className="text-xs text-muted-foreground">עדיין לא נוספו סניפים.</p>
              ) : null}
              {branches
                .filter((b) => !b._deleted)
                .map((branch, index) => (
                  <div key={branch.key} className="space-y-3 rounded-md border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">
                        {branch.id ? `סניף ${index + 1}` : `סניף חדש ${index + 1}`}
                      </div>
                      <DeleteButton label="הסרת סניף" onClick={() => removeBranch(branch.key)} />
                    </div>
                    <Field label="שם הסניף *">
                      <Input
                        value={branch.name}
                        onChange={(e) => updateBranch(branch.key, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="כתובת">
                      <Input
                        value={branch.address}
                        onChange={(e) => updateBranch(branch.key, { address: e.target.value })}
                      />
                    </Field>
                    <Field label="טלפון">
                      <Input
                        value={branch.phone}
                        onChange={(e) => updateBranch(branch.key, { phone: e.target.value })}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={branch.active}
                        onChange={(e) => updateBranch(branch.key, { active: e.target.checked })}
                      />
                      <span>פעיל</span>
                    </label>
                  </div>
                ))}
            </div>
    </FormDialog>
  );
}
