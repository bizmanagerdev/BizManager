"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import {
  fetchCustomerContactsDirect,
  fetchCustomerBranchesDirect,
  updateCustomerBranchDirect,
  type BranchPatch,
} from "@/lib/customers/branchesContacts";
import { TagIcon } from "@/components/ui/icons";
import { registerReversibleAction } from "@/lib/undo-engine";
import { enqueue, offlineFetch } from "@/lib/offline-queue";
import { invalidateCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";

/** No connection right now (the browser knows it) — the save waits in the app's queue. */
function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

// What the dialog says when it couldn't read the customer's contacts, branches
// or tags — opened with no connection, or a read that failed. The read answers
// an empty list either way, which used to wipe the contacts the dialog had been
// handed and let a save "keep" no tags at all.
const CONTACTS_NOT_REFRESHED = "לא ניתן היה לרענן את אנשי הקשר — מוצגים אלה שידועים. אפשר להוסיף חדשים.";
const CONTACTS_NOT_LOADED = "אין חיבור — אנשי הקשר לא נטענו. אפשר להוסיף חדשים, והם יישלחו כשיחזור החיבור.";
const BRANCHES_NOT_LOADED = "אין חיבור — הסניפים לא נטענו. אפשר להוסיף חדשים, והם יישלחו כשיחזור החיבור.";
const TAGS_NOT_LOADED = "אין חיבור — את התגיות אפשר לערוך כשיחזור החיבור.";
// Existing branches are written straight to the database, not through a route
// the app's queue can send later — so with no connection they can't wait.
const BRANCHES_NEED_CONNECTION =
  "אין חיבור — שינוי בסניפים קיימים נשמר רק עם חיבור. בטלו את השינוי בסניפים, או נסו שוב כשיחזור החיבור.";

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
  /**
   * Some of the save is waiting in the app's queue for the connection (it goes
   * out by itself). `customer` is then what was sent, not the server's answer.
   */
  queued?: boolean;
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

/** What save() writes for a contact — also how an edit is compared to the
 *  loaded original, so a contact nobody touched isn't written again. */
function contactPayload(contact: EditContactDraft) {
  return {
    full_name: contact.full_name.trim(),
    role: contact.role.trim() || null,
    phone: contact.phone.trim() || null,
    email: contact.email.trim() || null,
    whatsapp: contact.whatsapp.trim() || null,
    notes: contact.notes.trim() || null,
    is_primary: contact.active ? contact.is_primary : false,
    active: contact.active,
  };
}

function samePayload(a: Record<string, unknown>, b: Record<string, unknown>) {
  return Object.keys(a).every((key) => a[key] === b[key]);
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

/** What a save writes for a branch — also how an edit is compared to the loaded original. */
function branchPayload(branch: EditBranchDraft) {
  return {
    name: branch.name.trim(),
    address: branch.address.trim() || null,
    phone: branch.phone.trim() || null,
    active: branch.active,
  };
}

/** A draft as the contact row it stands for (the shape the route answers with). */
function contactDraftToRow(contact: EditContactDraft, customerId: string): Row {
  return { id: contact.id, customer_id: customerId, ...contactPayload(contact) };
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
  /**
   * The save was undone (the toast's "בטל"): the customer and contacts as they
   * were before it. A list patches its row in place with this; without it the
   * page is refreshed from the server.
   */
  onUndone?: (payload: EditCustomerSavedPayload) => void;
}

export function EditCustomerDialog({ open, onOpenChange, customer, onSaved, onUndone }: EditCustomerDialogProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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
  // The tag route replaces a customer's tags with whatever it's sent, so tags
  // that were never read must never be sent (they'd all be wiped).
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [tagsNote, setTagsNote] = useState("");

  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<EditContactDraft[]>([]);
  const [contactsNote, setContactsNote] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branches, setBranches] = useState<EditBranchDraft[]>([]);
  const [branchesNote, setBranchesNote] = useState("");

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
    const knownContacts = (customer.contacts ?? []).map(contactRowToDraft);
    setContacts(knownContacts);
    setContactsNote("");
    setBranches([]);
    setBranchesNote("");
    setTagIds([]);
    setTagsLoaded(false);
    setTagsNote("");

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
    originalContactsRef.current = knownContacts;
    originalBranchesRef.current = [];

    if (!customer.id) return;
    // No connection: nothing can be read. The contacts it was handed stay, and
    // it says what wasn't loaded — the save still works, and waits in the queue.
    if (isOffline()) {
      setContactsNote(knownContacts.length > 0 ? CONTACTS_NOT_REFRESHED : CONTACTS_NOT_LOADED);
      setBranchesNote(BRANCHES_NOT_LOADED);
      setTagsNote(TAGS_NOT_LOADED);
      return;
    }
    void fetchExistingTagIds("customer", customer.id).then((ids) => {
      setTagIds(ids);
      setTagsLoaded(true);
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
        // A failed read answers [] too. Contacts are switched off, never
        // deleted, so a customer it was handed contacts for still has them:
        // keep those rather than show (and save) an empty list.
        if (rows.length === 0 && knownContacts.length > 0) {
          setContactsNote(CONTACTS_NOT_REFRESHED);
          return;
        }
        const drafts = rows.map(contactRowToDraft);
        setContacts(drafts);
        originalContactsRef.current = drafts;
      })
      .catch(() => setContactsNote(knownContacts.length > 0 ? CONTACTS_NOT_REFRESHED : ""))
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

    const loadedTagIds = originalCustomerRef.current?.tag_ids ?? [];
    const tagsChanged =
      tagsLoaded &&
      (tagIds.length !== loadedTagIds.length || tagIds.some((tagId) => !loadedTagIds.includes(tagId)));

    const customerId = customer.id;
    const customerBody: Record<string, unknown> = {
      id: customerId,
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
      // Only when they changed: the route clears and re-inserts a customer's
      // tags whenever tag_ids is sent.
      ...(tagsChanged ? { tag_ids: tagIds } : {}),
    };

    // Existing branches that changed — written straight to the database, so
    // they go first, and only with a connection (see BRANCHES_NEED_CONNECTION).
    const branchUpdates: { id: string; patch: BranchPatch; failure: string }[] = [];
    const newBranches: EditBranchDraft[] = [];
    for (const branch of branches) {
      if (branch._deleted) {
        if (branch.id) {
          branchUpdates.push({ id: branch.id, patch: { active: false }, failure: `הסרת סניף נכשלה (${branch.name || branch.id}).` });
        }
        continue;
      }
      const payload = branchPayload(branch);
      if (!branch.id) {
        newBranches.push(branch);
        continue;
      }
      const loadedBranch = originalBranchesRef.current.find((b) => b.id === branch.id);
      if (loadedBranch && samePayload(payload, branchPayload(loadedBranch))) continue;
      branchUpdates.push({ id: branch.id, patch: payload, failure: `עדכון סניף נכשל (${payload.name}).` });
    }
    if (branchUpdates.length > 0 && isOffline()) return setErr(BRANCHES_NEED_CONNECTION);

    // Undo plan for this save — one op per contact/branch actually written,
    // built as we go so it exactly matches what was committed (not what was
    // attempted; an early return stops before anything gets queued).
    type ContactOriginal = {
      full_name: string;
      role: string | null;
      phone: string | null;
      email: string | null;
      whatsapp: string | null;
      notes: string | null;
      is_primary: boolean;
      active: boolean;
    };
    const contactUndoOps: ({ kind: "un-create"; id: string } | { kind: "restore"; id: string; original: ContactOriginal })[] = [];
    const branchUndoOps: (
      | { kind: "un-create"; id: string }
      | { kind: "restore"; id: string; original: { name: string; address: string | null; phone: string | null; active: boolean } }
    )[] = [];
    const restoreContact = (id: string) => {
      const original = originalContactsRef.current.find((c) => c.id === id);
      if (original) contactUndoOps.push({ kind: "restore", id, original: contactPayload(original) });
    };
    const restoreBranch = (id: string) => {
      const original = originalBranchesRef.current.find((b) => b.id === id);
      if (original) branchUndoOps.push({ kind: "restore", id, original: branchPayload(original) });
    };
    // New branches the server numbered — kept on their drafts if the save stops
    // part-way, so saving again doesn't create them twice.
    const createdBranchIds = new Map<string, string>();

    // The rest goes through the app's queue (offlineFetch), in this order: the
    // customer, then each contact that changed, then each new branch. A single
    // request isn't possible (separate routes), so once one of them has to wait
    // for the connection, every one after it waits too, right behind it — the
    // queue sends them in order, by itself, when the connection is back. The
    // list shows the change at once, marked as waiting.
    type PlannedWrite = {
      url: string;
      body: Record<string, unknown>;
      label: string;
      idempotent?: boolean;
      /** The words for a refusal. */
      failure: string;
      /** Record what the write did — `data` is null when it was queued. False: not the answer expected. */
      done: (data: Record<string, unknown> | null) => boolean;
    };
    let savedCustomer: Row | null = null;
    // In the drafts' order, as the caller gets them back.
    const contactSlots: (Row | null)[] = contacts.map(() => null);
    const writes: PlannedWrite[] = [
      {
        url: "/api/customers/update",
        body: customerBody,
        label: "עדכון לקוח",
        failure: "עדכון לקוח נכשל.",
        done: (data) => {
          if (!data) return true;
          if (!data.customer || typeof data.customer !== "object") return false;
          savedCustomer = data.customer as Row;
          return true;
        },
      },
    ];
    contacts.forEach((contact, index) => {
      if (contact._deleted) {
        if (!contact.id) return;
        const id = contact.id;
        writes.push({
          url: "/api/customer-contacts/update",
          body: { id, active: false, is_primary: false },
          label: "הסרת איש קשר",
          failure: `הסרת איש קשר נכשלה (${contact.full_name || id}).`,
          done: () => {
            restoreContact(id);
            return true;
          },
        });
        return;
      }
      const payload = contactPayload(contact);
      const loadedContact = contact.id ? originalContactsRef.current.find((c) => c.id === contact.id) : undefined;
      // Only contacts that actually changed are written — one request each, so
      // rewriting every one of a chain's rows on every save cost seconds. An
      // untouched contact still goes back to the caller as it was.
      if (contact.id && loadedContact && samePayload(payload, contactPayload(loadedContact))) {
        contactSlots[index] = contactDraftToRow(contact, customerId);
        return;
      }
      if (contact.id) {
        const id = contact.id;
        writes.push({
          url: "/api/customer-contacts/update",
          body: { id, ...payload },
          label: "עדכון איש קשר",
          failure: `עדכון איש קשר נכשל (${payload.full_name}).`,
          done: (data) => {
            if (data && !data.contact) return false;
            contactSlots[index] = (data?.contact as Row | undefined) ?? contactDraftToRow(contact, customerId);
            restoreContact(id);
            return true;
          },
        });
        return;
      }
      writes.push({
        url: "/api/customer-contacts/create",
        body: { customer_id: customerId, ...payload },
        label: "איש קשר חדש",
        idempotent: true,
        failure: `יצירת איש קשר נכשלה (${payload.full_name}).`,
        done: (data) => {
          if (data && !data.contact) return false;
          const created = (data?.contact as Row | undefined) ?? contactDraftToRow(contact, customerId);
          contactSlots[index] = created;
          if (typeof created.id === "string" && created.id) contactUndoOps.push({ kind: "un-create", id: created.id });
          return true;
        },
      });
    });
    for (const branch of newBranches) {
      const payload = branchPayload(branch);
      writes.push({
        url: "/api/customer-branches/create",
        body: { customer_id: customerId, ...payload },
        label: "סניף חדש",
        idempotent: true,
        failure: `יצירת סניף נכשלה (${payload.name}).`,
        done: (data) => {
          const newBranchId = (data?.branch as Row | undefined)?.id;
          if (typeof newBranchId === "string") {
            branchUndoOps.push({ kind: "un-create", id: newBranchId });
            createdBranchIds.set(branch.key, newBranchId);
          }
          return true;
        },
      });
    }

    const handBack = (queued: boolean): EditCustomerSavedPayload => ({
      // Queued before the server answered: what was sent stands in for its answer.
      customer: savedCustomer ?? { ...customerBody },
      contacts: contactSlots.filter((c): c is Row => c !== null && c.active !== false),
      queued,
    });

    setLoading(true);
    try {
      for (const update of branchUpdates) {
        const result = await updateCustomerBranchDirect(update.id, update.patch);
        if (!result.ok) return setErr(toHebrewError(result.error, update.failure));
        restoreBranch(update.id);
      }

      let queued = false;
      for (const [index, write] of writes.entries()) {
        if (queued) {
          enqueue({
            url: write.url,
            body: write.body,
            label: write.label,
            idempotencyKey: write.idempotent ? crypto.randomUUID() : undefined,
          });
          write.done(null);
          continue;
        }
        const result = await offlineFetch(write.url, write.body, write.label, { idempotent: write.idempotent });
        if (result.queued) {
          queued = true;
          write.done(null);
          continue;
        }
        const data = result.ok ? ((result.data ?? {}) as Record<string, unknown>) : null;
        if (!result.ok || !data || !write.done(data)) {
          const message = toHebrewError(result.ok ? undefined : result.error, write.failure);
          if (index === 0) return setErr(message);
          // The customer (and what came before this) is saved; this one was
          // refused. Say exactly that, keep the dialog open to fix it, and
          // treat what was written as the loaded state, so saving again
          // doesn't write it twice.
          setErr(`פרטי הלקוח נשמרו, אבל ${message}`);
          originalContactsRef.current = contacts
            .map((contact, i) => {
              const saved = contactSlots[i];
              return saved ? contactRowToDraft(saved) : contact.id ? originalContactsRef.current.find((c) => c.id === contact.id) : undefined;
            })
            .filter((draft): draft is EditContactDraft => Boolean(draft));
          setContacts((prev) =>
            prev.map((contact, i) => {
              const saved = contactSlots[i];
              return saved && !contact.id && typeof saved.id === "string" ? { ...contact, id: saved.id } : contact;
            })
          );
          if (createdBranchIds.size > 0) {
            const numbered = branches.map((b) => (createdBranchIds.has(b.key) ? { ...b, id: createdBranchIds.get(b.key) ?? null } : b));
            originalBranchesRef.current = [
              ...originalBranchesRef.current,
              ...numbered.filter((b) => createdBranchIds.has(b.key)),
            ];
            setBranches(numbered);
          }
          onSaved(handBack(false));
          return;
        }
      }

      onSaved(handBack(queued));
      onOpenChange(false);

      // Waiting for the connection: nothing reached the server yet to undo or
      // to search for — the queue's own notice says it's saved and on its way.
      if (queued) return;
      // Searchable by its new name / phone at once (the index is per session).
      invalidateCustomerSearchIndex();

      const originalFields = originalCustomerRef.current;
      const originalContacts = originalContactsRef.current;
      registerReversibleAction({
        key: `customer-edit:${customerId}:${Date.now()}`,
        message: "פרטי הלקוח נשמרו",
        onUndo: async () => {
          // Branches are written straight to the database: with no connection
          // the undo can't finish, so it doesn't start.
          if (branchUndoOps.length > 0 && isOffline()) return { ok: false, error: BRANCHES_NEED_CONNECTION };
          let undoQueued = false;
          const send = async (body: Record<string, unknown>, url: string, label: string, failure: string) => {
            const result = await offlineFetch(url, body, label);
            if (result.queued) {
              undoQueued = true;
              return null;
            }
            return result.ok ? null : toHebrewError(result.error, failure);
          };

          if (originalFields) {
            const failed = await send(
              {
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
                // Only if this save changed them — tags never read must not be sent.
                ...(tagsChanged ? { tag_ids: originalFields.tag_ids } : {}),
              },
              "/api/customers/update",
              "ביטול עדכון לקוח",
              "ביטול השינויים בלקוח נכשל."
            );
            if (failed) return { ok: false, error: failed };
          }

          for (const op of contactUndoOps) {
            const body = op.kind === "un-create" ? { id: op.id, active: false, is_primary: false } : { id: op.id, ...op.original };
            const failed = await send(body, "/api/customer-contacts/update", "ביטול עדכון איש קשר", "ביטול השינויים באנשי הקשר נכשל.");
            if (failed) return { ok: false, error: failed };
          }

          for (const op of branchUndoOps) {
            const patch = op.kind === "un-create" ? { active: false } : op.original;
            const result = await updateCustomerBranchDirect(op.id, patch);
            if (!result.ok) {
              return { ok: false, error: toHebrewError(result.error, "ביטול השינויים בסניפים נכשל.") };
            }
          }

          if (!undoQueued) invalidateCustomerSearchIndex();
          if (onUndone && originalFields) {
            // The row as it was — patched in place by the list, which stays
            // where it was scrolled (a refresh started it over from the top).
            onUndone({
              customer: {
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
              },
              contacts: originalContacts.filter((c) => c.active).map((c) => contactDraftToRow(c, customerId)),
              queued: undoQueued,
            });
          } else {
            startTransition(() => { router.refresh(); });
          }
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

            {tagsNote ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">תגיות / סיווג לקוח</div>
                <p className="text-xs text-muted-foreground">{tagsNote}</p>
              </div>
            ) : (
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
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">אנשי קשר</div>
                  <div className="text-xs text-muted-foreground">
                    {contactsLoading ? "טוען אנשי קשר..." : contactsNote || "אפשר להוסיף, לערוך או להסיר אנשי קשר."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addContact}>
                  הוספת איש קשר
                </Button>
              </div>
              {contacts.filter((c) => !c._deleted).length === 0 && !contactsLoading && !contactsNote ? (
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
                      : branchesNote || "לקוח שמזמין עבור כמה סניפים (למשל רשת) — כל סניף עם כתובת/טלפון משלו."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addBranch}>
                  הוספת סניף
                </Button>
              </div>
              {branches.filter((b) => !b._deleted).length === 0 && !branchesLoading && !branchesNote ? (
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
