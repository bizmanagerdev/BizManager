"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { fetchCustomerCore } from "@/lib/customers/fetchCustomerCore";
import { fetchCustomerContactsDirect, fetchCustomerBranchesDirect, updateCustomerBranchDirect } from "@/lib/customers/branchesContacts";
import { TagIcon } from "@/components/ui/icons";
import { registerReversibleAction } from "@/lib/undo-engine";

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

// Snapshot of every field this dialog can write, captured as it's loaded
// (before the user edits anything) so a successful save can register a full
// undo — reverting the customer's own fields plus every contact/branch this
// save actually touched, using the exact same update routes save() itself
// uses, just with the pre-edit values.
type OriginalCustomerFields = {
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
  linked_user_id: string | null;
  linkLoaded: boolean;
  tag_ids: string[];
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
  const router = useRouter();
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  // Pre-edit snapshots for undo (see OriginalCustomerFields above) — not
  // React state, since they must never trigger a re-render and must survive
  // being read from inside the save() closure without going stale.
  const originalCustomerRef = useRef<OriginalCustomerFields | null>(null);
  const originalContactsRef = useRef<EditContactDraft[]>([]);
  const originalBranchesRef = useRef<EditBranchDraft[]>([]);

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

    originalCustomerRef.current = {
      name: customer.name ?? "",
      name_for_invoice: customer.name_for_invoice ?? null,
      registration_number: customer.registration_number ?? null,
      phone: customer.phone ?? null,
      whatsapp: typeof customer.whatsapp === "number" ? String(customer.whatsapp) : (customer.whatsapp ?? null),
      email: customer.email ?? null,
      address: customer.address ?? null,
      notes: customer.notes ?? null,
      active: customer.active,
      requires_prepayment: customer.requires_prepayment,
      linked_user_id: customer.linked_user_id ?? null,
      linkLoaded: customer.linked_user_id !== undefined,
      tag_ids: [],
    };
    originalContactsRef.current = (customer.contacts ?? []).map(contactRowToDraft);
    originalBranchesRef.current = [];

    if (!customer.id) return;
    void fetchExistingTagIds("customer", customer.id).then((ids) => {
      setTagIds(ids);
      if (originalCustomerRef.current) originalCustomerRef.current.tag_ids = ids;
    });
    // Authoritative worker link, whatever the caller happened to pass.
    void fetchCustomerCore(customer.id)
      .then((row) => {
        if (!row) return;
        const linked = (row as Row).linked_user_id;
        const linkedId = typeof linked === "string" ? linked : "";
        setLinkedUserId(linkedId);
        setLinkLoaded(true);
        if (originalCustomerRef.current) {
          originalCustomerRef.current.linked_user_id = linkedId || null;
          originalCustomerRef.current.linkLoaded = true;
        }
      })
      .catch(() => { /* ignore — the link stays out of the payload */ });
    setContactsLoading(true);
    void fetchCustomerContactsDirect(customer.id)
      .then((rows) => {
        const drafts = rows.map(contactRowToDraft);
        setContacts(drafts);
        originalContactsRef.current = drafts;
      })
      .catch(() => { /* ignore */ })
      .finally(() => setContactsLoading(false));
    setBranchesLoading(true);
    void fetchCustomerBranchesDirect(customer.id)
      .then((rows) => {
        const drafts = rows.map(branchRowToDraft);
        setBranches(drafts);
        originalBranchesRef.current = drafts;
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

      // Undo plan for this save — one op per contact/branch actually written,
      // built as we go so it exactly matches what was committed (not what was
      // attempted; an early return above stops before anything gets queued).
      const contactUndoOps: (
        | { kind: "un-create"; id: string }
        | {
            kind: "restore";
            id: string;
            original: {
              full_name: string;
              role: string | null;
              phone: string | null;
              email: string | null;
              whatsapp: string | null;
              notes: string | null;
              is_primary: boolean;
              active: boolean;
            };
          }
      )[] = [];
      const branchUndoOps: (
        | { kind: "un-create"; id: string }
        | { kind: "restore"; id: string; original: { name: string; address: string | null; phone: string | null; active: boolean } }
      )[] = [];

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
          const originalContact = originalContactsRef.current.find((c) => c.id === contact.id);
          if (originalContact) {
            contactUndoOps.push({
              kind: "restore",
              id: contact.id,
              original: {
                full_name: originalContact.full_name,
                role: originalContact.role || null,
                phone: originalContact.phone || null,
                email: originalContact.email || null,
                whatsapp: originalContact.whatsapp || null,
                notes: originalContact.notes || null,
                is_primary: originalContact.is_primary,
                active: originalContact.active,
              },
            });
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
          const originalContact = originalContactsRef.current.find((c) => c.id === contact.id);
          if (originalContact) {
            contactUndoOps.push({
              kind: "restore",
              id: contact.id,
              original: {
                full_name: originalContact.full_name,
                role: originalContact.role || null,
                phone: originalContact.phone || null,
                email: originalContact.email || null,
                whatsapp: originalContact.whatsapp || null,
                notes: originalContact.notes || null,
                is_primary: originalContact.is_primary,
                active: originalContact.active,
              },
            });
          }
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
          const newContactId = crJson.contact.id;
          if (typeof newContactId === "string") {
            contactUndoOps.push({ kind: "un-create", id: newContactId });
          }
        }
      }

      for (const branch of branches) {
        if (branch._deleted) {
          if (!branch.id) continue;
          const delResult = await updateCustomerBranchDirect(branch.id, { active: false });
          if (!delResult.ok) {
            return setErr(toHebrewError(delResult.error, `הסרת סניף נכשלה (${branch.name || branch.id}).`));
          }
          const originalBranch = originalBranchesRef.current.find((b) => b.id === branch.id);
          if (originalBranch) {
            branchUndoOps.push({
              kind: "restore",
              id: branch.id,
              original: {
                name: originalBranch.name,
                address: originalBranch.address || null,
                phone: originalBranch.phone || null,
                active: originalBranch.active,
              },
            });
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
          const upResult = await updateCustomerBranchDirect(branch.id, branchPayload);
          if (!upResult.ok) {
            return setErr(toHebrewError(upResult.error, `עדכון סניף נכשל (${branchPayload.name}).`));
          }
          const originalBranch = originalBranchesRef.current.find((b) => b.id === branch.id);
          if (originalBranch) {
            branchUndoOps.push({
              kind: "restore",
              id: branch.id,
              original: {
                name: originalBranch.name,
                address: originalBranch.address || null,
                phone: originalBranch.phone || null,
                active: originalBranch.active,
              },
            });
          }
        } else {
          const crRes = await fetch("/api/customer-branches/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ customer_id: customer.id, ...branchPayload }),
          });
          const crJson = (await crRes.json().catch(() => ({}))) as { error?: string; branch?: Row };
          if (!crRes.ok) {
            return setErr(toHebrewError(crJson.error, `יצירת סניף נכשלה (${branchPayload.name}).`));
          }
          const newBranchId = crJson.branch?.id;
          if (typeof newBranchId === "string") {
            branchUndoOps.push({ kind: "un-create", id: newBranchId });
          }
        }
      }

      onSaved({ customer: json.customer, contacts: savedContacts.filter((c) => c.active !== false) });
      onOpenChange(false);

      const originalFields = originalCustomerRef.current;
      const customerId = customer.id;
      registerReversibleAction({
        key: `customer-edit:${customerId}:${Date.now()}`,
        message: "פרטי הלקוח נשמרו",
        onUndo: async () => {
          if (originalFields) {
            const revertRes = await fetch("/api/customers/update", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: customerId,
                name: originalFields.name,
                name_for_invoice: originalFields.name_for_invoice,
                registration_number: originalFields.registration_number,
                phone: originalFields.phone,
                whatsapp: originalFields.whatsapp,
                email: originalFields.email,
                address: originalFields.address,
                notes: originalFields.notes,
                active: originalFields.active,
                requires_prepayment: originalFields.requires_prepayment,
                ...(originalFields.linkLoaded ? { linked_user_id: originalFields.linked_user_id } : {}),
                tag_ids: originalFields.tag_ids,
              }),
            });
            if (!revertRes.ok) {
              const revertJson = (await revertRes.json().catch(() => ({}))) as { error?: string };
              return { ok: false, error: toHebrewError(revertJson.error, "ביטול השינויים בלקוח נכשל.") };
            }
          }

          for (const op of contactUndoOps) {
            const body = op.kind === "un-create" ? { id: op.id, active: false, is_primary: false } : { id: op.id, ...op.original };
            const res = await fetch("/api/customer-contacts/update", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok) {
              const undoJson = (await res.json().catch(() => ({}))) as { error?: string };
              return { ok: false, error: toHebrewError(undoJson.error, "ביטול השינויים באנשי הקשר נכשל.") };
            }
          }

          for (const op of branchUndoOps) {
            const patch = op.kind === "un-create" ? { active: false } : op.original;
            const result = await updateCustomerBranchDirect(op.id, patch);
            if (!result.ok) {
              return { ok: false, error: toHebrewError(result.error, "ביטול השינויים בסניפים נכשל.") };
            }
          }

          router.refresh();
          return { ok: true };
        },
      });
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
