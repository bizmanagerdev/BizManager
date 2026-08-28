"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invalidateCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { AddIcon, AiIcon, CardIcon, StoreIcon, UserIcon, UsersIcon } from "@/components/ui/icons";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, StepHeading } from "@/components/ui/option-row";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { WorkerLinkField } from "@/components/customers/WorkerLinkField";
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

// A customer that orders for several of its own locations (e.g. a chain) can
// carry multiple branches, each with its own delivery address/phone.
type BranchDraft = {
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

import { CITY_OPTIONS } from "@/lib/ui/cities";

export const CREATE_CUSTOMER_CITY_OPTIONS = CITY_OPTIONS;

type WizardStep =
  | "name"
  | "contact"
  | "email"
  | "city"
  | "cityOther"
  | "nameForInvoice"
  | "regNumber"
  | "address"
  | "prepayment"
  | "notes"
  | "contacts"
  | "branches"
  | "summary";

const STEP_LABEL: Record<WizardStep, string> = {
  name: "שם",
  contact: "פרטי קשר",
  email: "אימייל",
  city: "עיר",
  cityOther: "עיר",
  nameForInvoice: "חשבונית",
  regNumber: "ח.פ/ת.ז",
  address: "כתובת",
  prepayment: "תשלום מראש",
  notes: "הערות",
  contacts: "אנשי קשר",
  branches: "סניפים",
  summary: "סיכום",
};

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

function makeEmptyBranch(): BranchDraft {
  return { name: "", address: "", phone: "", active: true };
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
  const [cityQuery, setCityQuery] = useState("");
  const [stepId, setStepId] = useState<WizardStep>("name");
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
  const [linkedUserId, setLinkedUserId] = useState("");
  const [linkedUserName, setLinkedUserName] = useState("");
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [branches, setBranches] = useState<BranchDraft[]>([]);
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
    setStepId("name");
    setCityQuery("");
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
    setLinkedUserId("");
    setLinkedUserName("");
    setContacts([]);
    setBranches([]);
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

  function addBranch() {
    setBranches((prev) => [...prev, makeEmptyBranch()]);
  }

  function updateBranch(index: number, patch: Partial<BranchDraft>) {
    setBranches((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  function removeBranch(index: number) {
    setBranches((prev) => prev.filter((_, i) => i !== index));
  }

  const finalCity = city === "אחר" ? cityOther.trim() : city.trim();

  const stepIds = useMemo<WizardStep[]>(() => {
    const ids: WizardStep[] = ["name", "contact", "email", "city"];
    if (city === "אחר") ids.push("cityOther");
    ids.push("nameForInvoice", "regNumber", "address", "prepayment", "notes", "contacts", "branches", "summary");
    return ids;
  }, [city]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  const filteredCities = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (!q) return CREATE_CUSTOMER_CITY_OPTIONS;
    return CREATE_CUSTOMER_CITY_OPTIONS.filter((c) => c.toLowerCase().includes(q));
  }, [cityQuery]);

  const incompleteContactIndex = contacts.findIndex(
    (c) =>
      !c.full_name.trim() &&
      (c.role.trim() || c.phone.trim() || c.email.trim() || c.whatsapp.trim() || c.notes.trim())
  );
  const incompleteBranchIndex = branches.findIndex(
    (b) => !b.name.trim() && (b.address.trim() || b.phone.trim())
  );

  function isSatisfied(id: WizardStep): boolean {
    switch (id) {
      case "name":
        return Boolean(name.trim());
      case "contact":
        return Boolean(phone.trim());
      case "city":
        return Boolean(city);
      case "cityOther":
        return Boolean(cityOther.trim());
      case "contacts":
        return incompleteContactIndex < 0;
      case "branches":
        return incompleteBranchIndex < 0;
      case "email":
      case "nameForInvoice":
      case "regNumber":
      case "address":
      case "prepayment":
      case "notes":
      case "summary":
        return true;
    }
  }

  const flow = useStepFlow<WizardStep>({ stepId, setStepId, steps: stepIds, isSatisfied });
  const { stepIndex, isLastStep } = flow;

  function canClickStep(id: WizardStep): boolean {
    if (submitting) return false;
    return flow.canClickStep(id);
  }
  function advanceTo(id: WizardStep) {
    setError(null);
    flow.advanceTo(id);
  }
  function goToStep(id: WizardStep) {
    if (!canClickStep(id)) return;
    setError(null);
    setStepId(id);
  }
  function goBack() {
    setError(null);
    flow.goBack();
  }
  function goNext() {
    if (isLastStep) {
      void submit();
      return;
    }
    if (!isSatisfied(stepId)) {
      setError(
        stepId === "name"
          ? "יש להזין שם לקוח."
          : stepId === "contact"
            ? "יש להזין מספר טלפון."
            : stepId === "city"
              ? "יש לבחור עיר."
              : stepId === "cityOther"
                ? "יש לבחור עיר."
                : stepId === "branches"
                  ? `סניף ${incompleteBranchIndex + 1} חייב לכלול שם.`
                  : `איש קשר ${incompleteContactIndex + 1} חייב לכלול שם מלא.`
      );
      return;
    }
    setError(null);
    flow.goNext();
  }

  function pickCity(value: string) {
    setCity(value);
    advanceTo(value === "אחר" ? "cityOther" : "nameForInvoice");
  }

  async function submit() {
    if (submitting) return;
    setError(null);

    const trimName = name.trim();
    const trimPhone = phone.trim();

    if (!trimName) {
      setStepId("name");
      setError("יש להזין שם לקוח.");
      return;
    }
    if (!trimPhone) {
      setStepId("contact");
      setError("יש להזין מספר טלפון.");
      return;
    }
    if (!finalCity) {
      setStepId("city");
      setError("יש לבחור עיר.");
      return;
    }
    if (incompleteContactIndex >= 0) {
      setStepId("contacts");
      setError(`איש קשר ${incompleteContactIndex + 1} חייב לכלול שם מלא.`);
      return;
    }
    if (incompleteBranchIndex >= 0) {
      setStepId("branches");
      setError(`סניף ${incompleteBranchIndex + 1} חייב לכלול שם.`);
      return;
    }

    const preparedBranches = branches
      .map((b) => ({
        name: b.name.trim(),
        address: b.address.trim() || null,
        phone: b.phone.trim() || null,
        active: b.active,
      }))
      .filter((b) => b.name);

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
          linked_user_id: linkedUserId || null,
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
          // The customer itself saved — this is a partial failure, so it's a
          // toast, not a native alert box the user has to dismiss.
          toast.error(
            toHebrewError(
              contactResult.ok ? undefined : contactResult.error,
              `הלקוח נוצר, אבל איש הקשר ${detail} לא נוצר בהצלחה.`
            )
          );
          break;
        }
        createdContacts.push(contactJson.contact);
      }

      for (const [idx, branch] of preparedBranches.entries()) {
        const branchResult = await offlineFetch(
          "/api/customer-branches/create",
          { customer_id: customerId, ...branch },
          "סניף חדש",
          { idempotent: true }
        );
        if (branchResult.queued) continue;
        if (!branchResult.ok) {
          const detail = branch.name || `#${idx + 1}`;
          // The customer itself saved — this is a partial failure, so it's a
          // toast, not a native alert box the user has to dismiss.
          toast.error(toHebrewError(branchResult.error, `הלקוח נוצר, אבל הסניף ${detail} לא נוצר בהצלחה.`));
          break;
        }
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
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle="לקוח חדש"
      dialogDescription={description}
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={submitting}
      onBack={stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={submitting}
      onNext={goNext}
      nextLabel={isLastStep ? (submitting ? "יוצר..." : "יצירת לקוח") : undefined}
      nextDisabled={submitting || (!isLastStep && !isSatisfied(stepId))}
      isLastStep={isLastStep}
      submitOnEnter
      error={error ?? undefined}
      note={submitting ? "יוצר לקוח חדש, נא להמתין..." : undefined}
    >
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
            {stepId === "name" ? (
              <>
                <StepHeading title="מה שם הלקוח?" />
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </>
            ) : stepId === "contact" ? (
              <>
                <StepHeading title="פרטי טלפון" />
                <div className="space-y-3">
                  <Field label="טלפון" required>
                    <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoFocus />
                  </Field>
                  <Field label="וואטסאפ" hint="רשות, אם שונה מהטלפון">
                    <Input
                      value={whatsapp}
                      onChange={(e) => setWhatsapp(e.target.value)}
                      inputMode="tel"
                      placeholder="אם שונה מהטלפון"
                    />
                  </Field>
                  {/* Sits on the same step on purpose: this is where the "that
                      number belongs to a worker" catch has to happen, before a
                      second row for the same person exists. */}
                  <WorkerLinkField
                    value={linkedUserId}
                    onChange={(next, worker) => {
                      setLinkedUserId(next);
                      setLinkedUserName(worker?.label ?? "");
                    }}
                    phones={[phone, whatsapp]}
                    disabled={submitting}
                  />
                </div>
              </>
            ) : stepId === "email" ? (
              <>
                <StepHeading title="אימייל?" sub="לא חובה" />
                <Input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
              </>
            ) : stepId === "city" ? (
              <>
                <StepHeading title="באיזו עיר?" />
                <div className="grid gap-3">
                  <Input value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} placeholder="חיפוש עיר..." />
                  <div className="space-y-1">
                    {filteredCities.map((c) => (
                      <OptionRow key={c} label={c} selected={city === c} onClick={() => pickCity(c)} />
                    ))}
                    <OptionRow label="אחר" selected={city === "אחר"} onClick={() => pickCity("אחר")} />
                  </div>
                </div>
              </>
            ) : stepId === "cityOther" ? (
              <>
                <StepHeading title="שם העיר?" />
                <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} autoFocus />
              </>
            ) : stepId === "nameForInvoice" ? (
              <>
                <StepHeading title="שם לחשבונית?" sub="אם שונה משם הלקוח — לא חובה" />
                <Input autoFocus value={nameForInvoice} onChange={(e) => setNameForInvoice(e.target.value)} />
              </>
            ) : stepId === "regNumber" ? (
              <>
                <StepHeading title="ח.פ / ת.ז?" sub="לא חובה" />
                <Input autoFocus value={regNumber} onChange={(e) => setRegNumber(e.target.value)} inputMode="numeric" />
              </>
            ) : stepId === "address" ? (
              <>
                <StepHeading title="כתובת?" sub="לא חובה" />
                <Input
                  autoFocus
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="רחוב, מספר, שכונה"
                />
              </>
            ) : stepId === "prepayment" ? (
              <>
                <StepHeading title="לקוח ברשימת תשלום מראש?" sub="חיוב מתבצע לפני אספקה" />
                <div className="grid grid-cols-2 gap-2">
                  <OptionRow
                    label="כן"
                    selected={requiresPrepayment}
                    onClick={() => {
                      setRequiresPrepayment(true);
                      advanceTo("notes");
                    }}
                  />
                  <OptionRow
                    label="לא"
                    selected={!requiresPrepayment}
                    onClick={() => {
                      setRequiresPrepayment(false);
                      advanceTo("notes");
                    }}
                  />
                </div>
              </>
            ) : stepId === "notes" ? (
              <>
                <StepHeading title="הערות?" sub="לא חובה" />
                <div className="relative">
                  <Textarea
                    autoFocus
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="pe-11"
                  />
                  <DictateButton
                    onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                    className="absolute bottom-1 end-1 h-8 w-8"
                  />
                </div>
              </>
            ) : stepId === "contacts" ? (
              <div className="space-y-3">
                <StepHeading title="אנשי קשר נוספים?" sub="לא חובה" />

                {contacts.length === 0 ? (
                  <EmptyState>
                    עדיין לא נוספו אנשי קשר.
                  </EmptyState>
                ) : null}

                {contacts.map((contact, index) => (
                  <div
                    key={`new-contact-${index}`}
                    className="space-y-3 rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">איש קשר {index + 1}</div>
                      <DeleteButton label="הסרת איש קשר" onClick={() => removeContact(index)} />
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
                      <div className="relative">
                        <Textarea
                          value={contact.notes}
                          onChange={(e) => updateContact(index, { notes: e.target.value })}
                          rows={2}
                          className="pe-11"
                        />
                        <DictateButton
                          onTranscript={(text) =>
                            updateContact(index, { notes: appendDictatedText(contact.notes, text) })
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
                    <AddIcon className="h-4 w-4" />
                    הוספת איש קשר
                  </Button>
                </div>
              </div>
            ) : stepId === "branches" ? (
              <div className="space-y-3">
                <StepHeading
                  title="סניפים נוספים?"
                  sub="לא חובה — לקוח שמזמין עבור כמה סניפים (למשל רשת) יכול לקבל כמה, כל אחד עם כתובת/טלפון משלו."
                />

                {branches.length === 0 ? (
                  <EmptyState>
                    עדיין לא נוספו סניפים.
                  </EmptyState>
                ) : null}

                {branches.map((branch, index) => (
                  <div
                    key={`new-branch-${index}`}
                    className="space-y-3 rounded-md border bg-background p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">סניף {index + 1}</div>
                      <DeleteButton label="הסרת סניף" onClick={() => removeBranch(index)} />
                    </div>
                    <Field label="שם הסניף" required>
                      <Input
                        value={branch.name}
                        onChange={(e) => updateBranch(index, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="כתובת" hint="רשות">
                      <Input
                        value={branch.address}
                        onChange={(e) => updateBranch(index, { address: e.target.value })}
                      />
                    </Field>
                    <Field label="טלפון" hint="רשות">
                      <Input
                        value={branch.phone}
                        onChange={(e) => updateBranch(index, { phone: e.target.value })}
                        inputMode="tel"
                      />
                    </Field>
                  </div>
                ))}

                <div className="flex justify-end">
                  <Button type="button" variant="secondary" size="sm" onClick={addBranch}>
                    <AddIcon className="h-4 w-4" />
                    הוספת סניף
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <StepHeading title="לאשר וליצור?" />
                <div className="flex items-center gap-2 rounded-md border border-secondary/35 bg-secondary/10 px-3 py-2.5 text-sm text-foreground">
                  <AiIcon className="h-4 w-4 shrink-0 text-secondary" />
                  <span>
                    בדקו שהכל תקין ולחצו <span className="font-semibold">יצירת לקוח</span>.
                  </span>
                </div>

                <SummarySection icon={<UserIcon className="h-4 w-4" />} title="פרטי הלקוח" onEdit={() => goToStep("name")} editDisabled={submitting}>
                  <SummaryRow label="שם לקוח" value={name.trim()} />
                  <SummaryRow label="טלפון" value={phone.trim()} />
                  <SummaryRow label="וואטסאפ" value={whatsapp.trim()} />
                  <SummaryRow label="אימייל" value={email.trim()} />
                  <SummaryRow label="עיר" value={finalCity} />
                  {linkedUserId ? (
                    <SummaryRow label="עובד בעסק" value={linkedUserName || "מקושר"} />
                  ) : null}
                </SummarySection>

                <SummarySection icon={<CardIcon className="h-4 w-4" />} title="חיוב וכתובת" onEdit={() => goToStep("nameForInvoice")} editDisabled={submitting}>
                  <SummaryRow label="שם לחשבונית" value={nameForInvoice.trim()} />
                  <SummaryRow label="ח.פ / ת.ז" value={regNumber.trim()} />
                  <SummaryRow label="כתובת" value={address.trim()} />
                  <SummaryRow
                    label="תשלום מראש"
                    value={requiresPrepayment ? "כן — חיוב לפני אספקה" : "לא"}
                  />
                  {notes.trim() ? <SummaryRow label="הערות" value={notes.trim()} /> : null}
                </SummarySection>

                <SummarySection icon={<UsersIcon className="h-4 w-4" />} title="אנשי קשר" onEdit={() => goToStep("contacts")} editDisabled={submitting}>
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

                <SummarySection icon={<StoreIcon className="h-4 w-4" />} title="סניפים" onEdit={() => goToStep("branches")} editDisabled={submitting}>
                  {branches.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-muted-foreground">לא נוספו סניפים.</div>
                  ) : (
                    branches.map((b, i) => (
                      <SummaryRow
                        key={`summary-branch-${i}`}
                        label={`סניף ${i + 1}`}
                        value={[b.name.trim(), b.address.trim()].filter(Boolean).join(" · ")}
                      />
                    ))
                  )}
                </SummarySection>
              </div>
            )}
          </fieldset>
    </StepWizardDialog>
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
