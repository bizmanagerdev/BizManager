"use client";

import { useEffect, useMemo, useState } from "react";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { toHebrewError } from "@/lib/error-messages";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CITY_OPTIONS } from "@/lib/ui/cities";
import { invalidateCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { TagPicker, fetchExistingTagIds } from "@/components/tags/TagPicker";
import { WorkerLinkField } from "@/components/customers/WorkerLinkField";
import { TagIcon } from "@/components/ui/icons";

export type CustomerRecord = {
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
  /** Set when this customer is the same person as a worker (users row). */
  linked_user_id?: string | null;
};

export type CustomerFormResult = {
  customer: CustomerRecord;
  contacts: Record<string, unknown>[];
};

/** Edit-mode prefill. Only `id` is required — the rest is fetched if omitted. */
export type CustomerFormInitial = {
  id: string;
  name?: string | null;
  name_for_invoice?: string | null;
  registration_number?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
  requires_prepayment?: boolean;
  linked_user_id?: string | null;
};

type Row = Record<string, unknown>;

type SimilarContact = { full_name: string; phone: string | null; email: string | null; whatsapp: string | null };
type SimilarCustomer = CustomerRecord & { contacts?: SimilarContact[] };

type ContactDraft = {
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

let contactKeyCounter = 0;
function nextContactKey() {
  contactKeyCounter += 1;
  return `cf${contactKeyCounter}`;
}

const s = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};

function contactRowToDraft(row: Row): ContactDraft {
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

function emptyContactDraft(makePrimary: boolean): ContactDraft {
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

function splitAddress(address: string | null): { city: string; street: string } {
  if (!address) return { city: "", street: "" };
  const idx = address.indexOf("|");
  if (idx === -1) return { city: address.trim(), street: "" };
  return { city: address.slice(0, idx).trim(), street: address.slice(idx + 1).trim() };
}

export interface CustomerFormProps {
  mode: "create" | "edit";
  initial?: CustomerFormInitial | null;
  onSaved: (result: CustomerFormResult) => void;
  onCancel?: () => void;
  /** Create mode: pick an existing similar customer instead of creating a duplicate. */
  onUseExisting?: (result: CustomerFormResult) => void;
}

/**
 * Full customer form (all fields + contacts), rendered inline — no dialog chrome.
 * Used directly in the order wizard and wrapped by CreateCustomerDialog / EditCustomerDialog.
 */
export function CustomerForm({ mode, initial = null, onSaved, onCancel, onUseExisting }: CustomerFormProps) {
  const isEdit = mode === "edit";

  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [invoiceName, setInvoiceName] = useState(initial?.name_for_invoice ?? "");
  const [reg, setReg] = useState(initial?.registration_number ?? "");
  const [city, setCity] = useState("");
  const [cityOther, setCityOther] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [requiresPrepayment, setRequiresPrepayment] = useState(initial?.requires_prepayment ?? false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [linkedUserId, setLinkedUserId] = useState(initial?.linked_user_id ?? "");
  // Edit mode leaves `linked_user_id` out of the payload until the canonical
  // value has been read back — an omitted key leaves the column alone, so a
  // failed lookup can't silently unlink a worker.
  const [linkLoaded, setLinkLoaded] = useState(mode === "create" || initial?.linked_user_id !== undefined);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const [similar, setSimilar] = useState<SimilarCustomer[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarDismissed, setSimilarDismissed] = useState(false);

  // Edit mode: fetch the canonical record + contacts so the form is self-sufficient
  // even when the caller only knows the id.
  const initialId = initial?.id ?? "";
  useEffect(() => {
    if (!isEdit || !initialId) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const [custRes, contactsRes] = await Promise.all([
          fetch(`/api/customers/${initialId}`, { signal: controller.signal }),
          fetch(`/api/customer-contacts/list?customer_id=${encodeURIComponent(initialId)}`, { signal: controller.signal }),
        ]);
        if (custRes.ok) {
          const json = (await custRes.json().catch(() => ({}))) as { customer?: CustomerRecord };
          const c = json.customer;
          if (c) {
            setName(c.name ?? "");
            setInvoiceName(c.name_for_invoice ?? "");
            setReg(c.registration_number ?? "");
            setPhone(c.phone ?? "");
            setWhatsapp(typeof c.whatsapp === "number" ? String(c.whatsapp) : (c.whatsapp ?? ""));
            setEmail(c.email ?? "");
            const { city: parsedCity, street } = splitAddress(c.address ?? null);
            if (parsedCity && (CITY_OPTIONS as readonly string[]).includes(parsedCity)) {
              setCity(parsedCity);
              setCityOther("");
            } else if (parsedCity) {
              setCity("אחר");
              setCityOther(parsedCity);
            }
            setAddress(street);
            setNotes(c.notes ?? "");
            setActive(c.active !== false);
            setRequiresPrepayment(c.requires_prepayment === true);
            setLinkedUserId(c.linked_user_id ?? "");
            setLinkLoaded(true);
          }
        }
        if (contactsRes.ok) {
          const json = (await contactsRes.json().catch(() => ({}))) as { contacts?: Row[] };
          setContacts((json.contacts ?? []).map(contactRowToDraft));
        }
        const existingTags = await fetchExistingTagIds("customer", initialId);
        if (!controller.signal.aborted) setTagIds(existingTags);
      } catch {
        // ignore — aborted or network error
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [isEdit, initialId]);

  // Create mode: warn about similar existing customers.
  const contactSearchValues = contacts.flatMap((c) => [c.full_name, c.phone, c.whatsapp, c.email]);
  const contactSearchKey = contactSearchValues.join("|");
  const similarTerms = useMemo(() => {
    if (isEdit) return [];
    const unique = new Set<string>();
    for (const value of [name, invoiceName, reg, phone, whatsapp, email, address, ...contactSearchValues]) {
      const trimmed = value.trim();
      if (trimmed.length >= 2) unique.add(trimmed);
    }
    return Array.from(unique);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, name, invoiceName, reg, phone, whatsapp, email, address, contactSearchKey]);
  const similarTermsKey = similarTerms.join("|");

  useEffect(() => {
    if (isEdit || similarDismissed) return;
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
            fetch(`/api/customers/search?q=${encodeURIComponent(term)}&limit=10`, { signal: controller.signal })
              .then((res) => (res.ok ? (res.json() as Promise<{ customers?: SimilarCustomer[] }>) : null))
              .catch(() => null)
          )
        );
        if (controller.signal.aborted) return;
        const byId = new Map<string, SimilarCustomer>();
        for (const json of responses) {
          for (const c of json?.customers ?? []) {
            if (!byId.has(c.id)) byId.set(c.id, { ...c, contacts: c.contacts ? [...c.contacts] : undefined });
          }
        }
        setSimilar(Array.from(byId.values()).slice(0, 8));
      } catch {
        // ignore
      } finally {
        if (!controller.signal.aborted) setSimilarLoading(false);
      }
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, similarTermsKey, similarDismissed]);

  function addContact() {
    setContacts((prev) => {
      const hasPrimary = prev.some((c) => !c._deleted && c.is_primary);
      return [...prev, emptyContactDraft(!hasPrimary)];
    });
  }
  function updateContact(key: string, patch: Partial<ContactDraft>) {
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
  function removeContact(key: string) {
    setContacts((prev) =>
      prev
        .map((c) => (c.key === key ? { ...c, _deleted: true, is_primary: false } : c))
        .filter((c) => c.id !== null || !c._deleted)
    );
  }

  function applyExistingCustomer(match: SimilarCustomer) {
    const result: CustomerFormResult = { customer: { ...match }, contacts: [] };
    (onUseExisting ?? onSaved)(result);
  }

  async function submit() {
    if (submitting) return;
    setError(null);

    const trimName = name.trim();
    const trimPhone = phone.trim();
    const finalCity = city === "אחר" ? cityOther.trim() : city.trim();
    const street = address.trim();

    if (!trimName) return setError("יש להזין שם לקוח.");
    if (!isEdit) {
      if (!trimPhone) return setError("יש להזין מספר טלפון.");
      if (!finalCity) return setError("יש לבחור עיר.");
    }

    const visible = contacts.filter((c) => !c._deleted);
    const missing = visible.find((c) => !c.full_name.trim());
    if (missing) return setError("יש למלא שם מלא בכל איש קשר.");
    const activePrimaries = visible.filter((c) => c.is_primary && c.active);
    if (activePrimaries.length > 1) return setError("ניתן לסמן רק איש קשר ראשי אחד.");

    setSubmitting(true);
    try {
      let customerId = initial?.id ?? "";
      let savedCustomer: CustomerRecord | null = null;

      if (isEdit) {
        const combinedAddress = finalCity ? (street ? `${finalCity} | ${street}` : finalCity) : street || null;
        const res = await fetch("/api/customers/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: customerId,
            name: trimName,
            name_for_invoice: invoiceName.trim() || null,
            registration_number: reg.trim() || null,
            phone: trimPhone || null,
            whatsapp: whatsapp.trim() || null,
            email: email.trim() || null,
            city: finalCity || null,
            address: combinedAddress,
            notes: notes.trim() || null,
            active,
            requires_prepayment: requiresPrepayment,
            ...(linkLoaded ? { linked_user_id: linkedUserId || null } : {}),
            tag_ids: tagIds,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; customer?: CustomerRecord };
        if (!res.ok || !json.customer) return setError(toHebrewError(json.error, "עדכון לקוח נכשל."));
        savedCustomer = json.customer;
        customerId = json.customer.id;
      } else {
        const res = await fetch("/api/customers/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: trimName,
            name_for_invoice: invoiceName.trim() || null,
            registration_number: reg.trim() || null,
            phone: trimPhone || null,
            whatsapp: whatsapp.trim() || null,
            email: email.trim() || null,
            city: finalCity,
            address: street || null,
            notes: notes.trim() || null,
            requires_prepayment: requiresPrepayment,
            linked_user_id: linkedUserId || null,
            tag_ids: tagIds,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; customer?: CustomerRecord };
        if (!res.ok || !json.customer) return setError(toHebrewError(json.error, "יצירת לקוח נכשלה."));
        savedCustomer = json.customer;
        customerId = json.customer.id;
      }

      // Persist contacts (create / update / soft-delete).
      const savedContacts: Row[] = [];
      for (const contact of contacts) {
        if (contact._deleted) {
          if (!contact.id) continue;
          await fetch("/api/customer-contacts/update", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: contact.id, active: false, is_primary: false }),
          });
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
        const endpoint = contact.id ? "/api/customer-contacts/update" : "/api/customer-contacts/create";
        const body = contact.id ? { id: contact.id, ...payload } : { customer_id: customerId, ...payload };
        const cRes = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const cJson = (await cRes.json().catch(() => ({}))) as { error?: string; contact?: Row };
        if (cRes.ok && cJson.contact) savedContacts.push(cJson.contact);
      }

      invalidateCustomerSearchIndex();
      onSaved({ customer: savedCustomer, contacts: savedContacts.filter((c) => c.active !== false) });
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה"));
    } finally {
      setSubmitting(false);
    }
  }

  const visibleContacts = contacts.filter((c) => !c._deleted);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!isEdit && !similarDismissed && similar.length > 0 ? (
        <div className="space-y-2 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <div className="flex items-center justify-between gap-2">
            <div className="font-medium">נמצאו לקוחות דומים — אולי לא צריך ליצור חדש?</div>
            <button
              type="button"
              className="text-xs underline opacity-80 hover:opacity-100"
              onClick={() => setSimilarDismissed(true)}
            >
              התעלם והמשך
            </button>
          </div>
          <ul className="space-y-1">
            {similar.map((match) => (
              <li key={match.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{match.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      match.phone,
                      match.whatsapp && match.whatsapp !== match.phone ? `וואטסאפ: ${match.whatsapp}` : null,
                      match.email,
                      match.address,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" disabled={submitting} onClick={() => applyExistingCustomer(match)}>
                  שימוש בלקוח זה
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!isEdit && similar.length === 0 && similarLoading ? (
        <div className="text-xs text-muted-foreground">בודק אם קיים לקוח דומה...</div>
      ) : null}

      <fieldset disabled={submitting || loading} className="space-y-3">
        <Field label="שם לקוח *">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <AdaptiveGrid variant="formTwo">
          <Field label={isEdit ? "טלפון" : "טלפון *"}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="וואטסאפ">
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </Field>
        </AdaptiveGrid>

        <WorkerLinkField
          value={linkedUserId}
          onChange={setLinkedUserId}
          phones={[phone, whatsapp]}
          disabled={!linkLoaded}
        />

        <Field label="אימייל">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="שם לחשבונית">
          <Input value={invoiceName} onChange={(e) => setInvoiceName(e.target.value)} placeholder="אם שונה משם הלקוח" />
        </Field>

        <Field label="ח.פ / ת.ז">
          <Input value={reg} onChange={(e) => setReg(e.target.value)} />
        </Field>

        <Field label={isEdit ? "עיר" : "עיר *"}>
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
          <Field label="עיר (הקלדה חופשית) *">
            <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} />
          </Field>
        ) : null}

        <Field label="כתובת">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="רחוב ומספר" />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={requiresPrepayment} onChange={(e) => setRequiresPrepayment(e.target.checked)} />
          <span>לקוח ברשימת תשלום מראש</span>
        </label>

        {isEdit ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>לקוח פעיל</span>
          </label>
        ) : null}

        {/* Always visible (not tucked in the collapsible) so tagging an existing
            customer is one obvious step in the edit form. */}
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

        <details className="rounded-md border border-dashed p-3" open={Boolean(notes || visibleContacts.length > 0)}>
          <summary className="cursor-pointer text-sm font-medium">פרטים נוספים ואנשי קשר</summary>
          <div className="mt-3 space-y-3">
            <Field label="הערות">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </Field>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">אנשי קשר</div>
                  <div className="text-xs text-muted-foreground">
                    {loading ? "טוען אנשי קשר..." : "אפשר להוסיף, לערוך או להסיר אנשי קשר."}
                  </div>
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={addContact}>
                  הוספת איש קשר
                </Button>
              </div>
              {visibleContacts.length === 0 && !loading ? (
                <p className="text-xs text-muted-foreground">עדיין לא נוספו אנשי קשר.</p>
              ) : null}
              {visibleContacts.map((contact, index) => (
                <div key={contact.key} className="space-y-3 rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">איש קשר {index + 1}</div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => removeContact(contact.key)}>
                      הסרה
                    </Button>
                  </div>
                  <Field label="שם מלא *">
                    <Input value={contact.full_name} onChange={(e) => updateContact(contact.key, { full_name: e.target.value })} />
                  </Field>
                  <Field label="תפקיד">
                    <Input value={contact.role} onChange={(e) => updateContact(contact.key, { role: e.target.value })} />
                  </Field>
                  <AdaptiveGrid variant="formTwo">
                    <Field label="טלפון">
                      <Input value={contact.phone} onChange={(e) => updateContact(contact.key, { phone: e.target.value })} />
                    </Field>
                    <Field label="וואטסאפ">
                      <Input value={contact.whatsapp} onChange={(e) => updateContact(contact.key, { whatsapp: e.target.value })} />
                    </Field>
                  </AdaptiveGrid>
                  <Field label="אימייל">
                    <Input value={contact.email} onChange={(e) => updateContact(contact.key, { email: e.target.value })} />
                  </Field>
                  <Field label="הערות">
                    <Textarea value={contact.notes} onChange={(e) => updateContact(contact.key, { notes: e.target.value })} rows={2} />
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
          </div>
        </details>
      </fieldset>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            ביטול
          </Button>
        ) : null}
        <Button type="submit" disabled={submitting || loading}>
          {submitting ? (isEdit ? "שומר..." : "יוצר...") : isEdit ? "שמירת שינויים" : "יצירת לקוח"}
        </Button>
      </div>
    </form>
  );
}
