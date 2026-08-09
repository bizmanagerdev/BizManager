"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AddUserIcon, AiIcon, CardIcon, CheckIcon, CloseIcon, DocumentIcon, EditIcon, SearchIcon, UserIcon, WazeIcon } from "@/components/ui/icons";
import { StepWizard } from "@/components/ui/step-wizard";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { offlineFetch, saveDraft, loadDraft, clearDraft } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { resyncAlerts } from "@/lib/ui/alerts-refresh";
import { AddressLink } from "@/components/ui/address-link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DateInput } from "@/components/ui/date-input";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { CustomerForm, type CustomerRecord } from "@/components/customers/CustomerForm";
import {
  MovingEndpointFields,
  EMPTY_MOVING_ENDPOINT,
  elevatorToBool,
  boolToElevator,
  type MovingEndpointValue,
} from "@/components/projects/MovingAddressFields";
import { useCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { PAYMENT_TERMS_OPTIONS, computeDueDate } from "@/lib/paymentTerms";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";
import { omitUnknownPlace } from "@/lib/ui/cities";

type Row = Record<string, unknown>;
type Step = 1 | 2 | 3 | 4;

/** Serialisable in-progress form, persisted to localStorage so a create draft
 *  survives going offline / leaving the app / a reload (attachments excluded —
 *  File objects can't be serialised and must be re-attached). */
type ProjectDraft = {
  step: Step;
  customerId: string;
  name: string;
  projectType: string;
  status: string;
  agreedBasePrice: string;
  priceIncludesVat: boolean;
  noCharge: boolean;
  expensesSeparately: boolean;
  projectManagerId: string;
  startDate: string;
  endDate: string;
  paymentTerms: string;
  dueDate: string;
  notes: string;
  itemsToMove: string;
  origin: MovingEndpointValue;
  destination: MovingEndpointValue;
};

/** A customer as the wizard renders it. Both the initial list and the search
 *  results are funnelled through this shape so the UI stays consistent. */
export type ProjectCustomerOption = {
  id: string;
  name: string;
  nameForInvoice: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  contacts?: Array<{ full_name: string; phone: string | null; email: string | null }>;
};

export type ProjectManagerOption = { id: string; label: string };

/** Edit-mode prefill: the project being edited. */
export type InitialProject = {
  id: string;
  customer_id: string;
  name: string;
  project_type: string;
  status: string;
  agreed_base_price: number;
  price_includes_vat: boolean;
  no_charge?: boolean | null;
  expenses_billed_separately: boolean;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  payment_terms: string | null;
  due_date: string | null;
  notes: string | null;
  items_to_move: string[] | null;
  origin_address?: string | null;
  origin_floor?: string | null;
  origin_has_elevator?: boolean | null;
  destination_address?: string | null;
  destination_floor?: string | null;
  destination_has_elevator?: boolean | null;
};

const DEFAULT_PROJECT_TYPE_OPTIONS = ["logistics", "moving", "construction"];
const DEFAULT_STATUS_OPTIONS = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];

function statusLabel(status: string) {
  return status === "unknown" ? "לא ידוע" : getProjectStatusLabel(status);
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "moving":
      return "הובלה";
    case "construction":
      return "שיפוצים";
    default:
      return value;
  }
}

function termsLabelFor(value: string) {
  return PAYMENT_TERMS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function isMovingProjectType(value: string) {
  return value === "moving";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

function getString(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function itemsToMoveToText(items: string[] | null | undefined) {
  return (items ?? []).join("\n");
}

function textToItemsToMove(value: string) {
  const items = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

/** Map a raw customer row (initial list or /api/customers/search result) into the
 *  shape the wizard renders. Exported so call sites can reuse it for their lists. */
export function mapProjectCustomer(row: Row): ProjectCustomerOption | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const contacts = Array.isArray(row.contacts)
    ? (row.contacts as Array<Record<string, unknown>>).map((c) => ({
        full_name: typeof c.full_name === "string" ? c.full_name : "",
        phone: typeof c.phone === "string" ? c.phone : null,
        email: typeof c.email === "string" ? c.email : null,
      }))
    : undefined;
  const address = typeof row.address === "string" ? row.address : null;
  return {
    id,
    name: getString(row, ["name", "name_for_invoice", "label"]) ?? "לקוח",
    nameForInvoice: getString(row, ["name_for_invoice"]),
    phone: getString(row, ["phone", "mobile", "tel"]),
    whatsapp: getString(row, ["whatsapp"]),
    email: getString(row, ["email"]),
    address: omitUnknownPlace(address),
    city: omitUnknownPlace(getString(row, ["city"]) ?? extractCityFromAddress(address)),
    contacts,
  };
}

/** Attach a photo/document to a freshly-created project (same endpoint the
 *  /projects create dialog uses). */
async function uploadProjectDocument(projectId: string, file: File) {
  const form = new FormData();
  form.set("project_id", projectId);
  form.set("file", file);
  form.set("category", file.type.startsWith("image/") ? "project_photo" : "project_document");
  const res = await fetch("/api/projects/documents/upload", { method: "POST", body: form });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(toHebrewError(json?.error, "העלאת הקובץ נכשלה."));
  }
}

const WIZARD_STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "לקוח" },
  { n: 2, label: "פרטים" },
  { n: 3, label: "תשלום" },
  { n: 4, label: "סיכום" },
];

export default function NewProjectClient({
  customers,
  managers,
  currentUserId,
  defaultProjectManagerId,
  mode = "create",
  initialProject = null,
  initialStatus,
  initialCustomerId,
  defaultStartDate,
  draftKey,
  projectTypeOptions = DEFAULT_PROJECT_TYPE_OPTIONS,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  onCancel,
  onSubmitted,
  onActionLockedChange,
}: {
  customers: ProjectCustomerOption[];
  managers: ProjectManagerOption[];
  currentUserId?: string;
  defaultProjectManagerId?: string;
  mode?: "create" | "edit";
  initialProject?: InitialProject | null;
  /** Create mode: open with this status preselected (e.g. "quote"). */
  initialStatus?: string;
  /** Create mode: open with this customer already selected. */
  initialCustomerId?: string;
  /** Create mode: open with this start date (e.g. a calendar day). */
  defaultStartDate?: string;
  /** Create mode: persist the in-progress form under this localStorage key so it
   *  survives going offline / leaving the app / a reload. Omit to disable. */
  draftKey?: string;
  projectTypeOptions?: string[];
  statusOptions?: string[];
  onCancel: () => void;
  /** Called with the saved project row after a successful create/update. */
  onSubmitted: (project: Row) => void;
  onActionLockedChange?: (locked: boolean) => void;
}) {
  const isEditMode = mode === "edit" && initialProject !== null;

  // Restore an in-progress create draft (offline / app-left / reload). Loaded
  // once on mount; never in edit mode (a stale draft must not clobber the row).
  // Safe in a useState initializer because the wizard only ever mounts client-side
  // (both call sites render it conditionally when their dialog opens).
  const canDraft = Boolean(draftKey) && !isEditMode;
  const [restoredDraft] = useState<ProjectDraft | null>(() =>
    canDraft ? loadDraft<ProjectDraft>(draftKey!) : null
  );

  const [step, setStep] = useState<Step>(restoredDraft?.step ?? 1);
  // The middle section scrolls (top/bottom bars are pinned); reset it on step change.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [step]);

  // ---- Customer selection ------------------------------------------------------
  const preselectedCustomerId = initialProject?.customer_id ?? initialCustomerId ?? restoredDraft?.customerId ?? "";
  const [customerId, setCustomerId] = useState(preselectedCustomerId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerTab, setCustomerTab] = useState<"existing" | "new">("existing");
  const [editingCustomer, setEditingCustomer] = useState(false);
  // Mobile master→detail, same as the order wizard: after a customer is picked
  // the results list collapses so the detail/edit card is not buried under a
  // long list. lg keeps both columns visible.
  const [mobileListCollapsed, setMobileListCollapsed] = useState(false);
  // Hold the chosen customer independently of the search list so searching again
  // doesn't drop the selection.
  const [pickedCustomer, setPickedCustomer] = useState<ProjectCustomerOption | null>(
    preselectedCustomerId ? customers.find((c) => c.id === preselectedCustomerId) ?? null : null
  );
  const [customerOptions, setCustomerOptions] = useState<ProjectCustomerOption[]>(customers);
  const [customerSearchError, setCustomerSearchError] = useState<string | null>(null);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const { search: searchCustomerIndex, loading: customerIndexLoading } = useCustomerSearchIndex();

  useEffect(() => {
    setCustomerOptions(customers);
  }, [customers]);

  // Instant in-memory search over the cached customer index — no per-keystroke
  // network round-trip. Falls back to the server-seeded list while it loads.
  useEffect(() => {
    setCustomerSearchError(null);
    if (customerIndexLoading) {
      setCustomerSearchLoading(true);
      if (!customerQuery.trim()) setCustomerOptions(customers);
      return;
    }
    setCustomerSearchLoading(false);
    const results = searchCustomerIndex(customerQuery, 50)
      .map((entry) => mapProjectCustomer(entry as Row))
      .filter((row): row is ProjectCustomerOption => Boolean(row));
    setCustomerOptions(results.length === 0 && !customerQuery.trim() ? customers : results);
  }, [customerQuery, searchCustomerIndex, customerIndexLoading, customers]);

  const filteredCustomers = useMemo(() => customerOptions.slice(0, 50), [customerOptions]);
  const selectedCustomer =
    pickedCustomer && pickedCustomer.id === customerId
      ? pickedCustomer
      : customerOptions.find((c) => c.id === customerId) ?? null;

  // ---- Project details ---------------------------------------------------------
  const initialDue = initialProject?.due_date ? initialProject.due_date.slice(0, 10) : null;
  const [name, setName] = useState(initialProject?.name ?? restoredDraft?.name ?? "");
  const [projectType, setProjectType] = useState(
    initialProject?.project_type ?? restoredDraft?.projectType ?? ""
  );
  const [status, setStatus] = useState(
    initialProject?.status ?? restoredDraft?.status ?? initialStatus ?? statusOptions[0]
  );
  const [agreedBasePrice, setAgreedBasePrice] = useState(
    initialProject
      ? initialProject.agreed_base_price
        ? String(initialProject.agreed_base_price)
        : ""
      : restoredDraft?.agreedBasePrice ?? ""
  );
  const [priceIncludesVat, setPriceIncludesVat] = useState(
    initialProject?.price_includes_vat ?? restoredDraft?.priceIncludesVat ?? false
  );
  const [noCharge, setNoCharge] = useState(
    initialProject?.no_charge ?? restoredDraft?.noCharge ?? false
  );
  const [expensesSeparately, setExpensesSeparately] = useState(
    initialProject?.expenses_billed_separately ?? restoredDraft?.expensesSeparately ?? false
  );
  const [projectManagerId, setProjectManagerId] = useState(
    initialProject?.project_manager_id ?? restoredDraft?.projectManagerId ?? defaultProjectManagerId ?? currentUserId ?? ""
  );
  const [startDate, setStartDate] = useState(
    initialProject?.start_date ?? defaultStartDate ?? restoredDraft?.startDate ?? todayIso()
  );
  const [endDate, setEndDate] = useState(
    initialProject?.end_date ?? restoredDraft?.endDate ?? (isEditMode ? "" : todayIso())
  );
  const [paymentTerms, setPaymentTerms] = useState(
    initialProject?.payment_terms ?? restoredDraft?.paymentTerms ?? "immediate"
  );
  const [dueDate, setDueDate] = useState(
    initialDue ??
      restoredDraft?.dueDate ??
      computeDueDate(initialProject?.start_date ?? restoredDraft?.startDate ?? todayIso(), initialProject?.payment_terms ?? restoredDraft?.paymentTerms ?? "immediate") ??
      ""
  );
  const [notes, setNotes] = useState(initialProject?.notes ?? restoredDraft?.notes ?? "");
  const [itemsToMove, setItemsToMove] = useState(
    initialProject ? itemsToMoveToText(initialProject.items_to_move) : restoredDraft?.itemsToMove ?? ""
  );
  const [origin, setOrigin] = useState<MovingEndpointValue>(
    initialProject
      ? {
          address: initialProject.origin_address ?? "",
          floor: initialProject.origin_floor ?? "",
          hasElevator: boolToElevator(initialProject.origin_has_elevator),
        }
      : restoredDraft?.origin ?? EMPTY_MOVING_ENDPOINT
  );
  const [destination, setDestination] = useState<MovingEndpointValue>(
    initialProject
      ? {
          address: initialProject.destination_address ?? "",
          floor: initialProject.destination_floor ?? "",
          hasElevator: boolToElevator(initialProject.destination_has_elevator),
        }
      : restoredDraft?.destination ?? EMPTY_MOVING_ENDPOINT
  );
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Autosave the in-progress create form so it survives offline / leaving the app
  // / a reload. Runs on every change; the wizard only mounts while its dialog is
  // open, so there's no "is open" guard to add.
  useEffect(() => {
    if (!canDraft) return;
    saveDraft(draftKey!, {
      step,
      customerId,
      name,
      projectType,
      status,
      agreedBasePrice,
      priceIncludesVat,
      noCharge,
      expensesSeparately,
      projectManagerId,
      startDate,
      endDate,
      paymentTerms,
      dueDate,
      notes,
      itemsToMove,
      origin,
      destination,
    } satisfies ProjectDraft);
  }, [
    canDraft,
    draftKey,
    step,
    customerId,
    name,
    projectType,
    status,
    agreedBasePrice,
    priceIncludesVat,
    noCharge,
    expensesSeparately,
    projectManagerId,
    startDate,
    endDate,
    paymentTerms,
    dueDate,
    notes,
    itemsToMove,
    origin,
    destination,
  ]);

  // ---- Submit ------------------------------------------------------------------
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionLocked = submitting;
  useEffect(() => {
    onActionLockedChange?.(submitting);
  }, [submitting, onActionLockedChange]);

  // ---- Step navigation ---------------------------------------------------------
  // While the inline create/edit customer form is open the user must save or
  // cancel first — otherwise the in-progress edit would be abandoned.
  const customerFormOpen = step === 1 && (editingCustomer || customerTab === "new");
  function stepUnlocked(n: Step) {
    if (n >= 2 && !customerId) return false;
    if (n >= 3 && !name.trim()) return false;
    return true;
  }
  const canClickStep = (n: Step) => {
    if (customerFormOpen && n > step) return false;
    return n <= step || stepUnlocked(n);
  };
  function goToStep(n: Step) {
    if (!stepUnlocked(n)) return;
    setStep(n);
    setEditingCustomer(false);
  }
  function goBack() {
    if (step === 1) return;
    goToStep((step - 1) as Step);
  }

  // Add or update a customer in the local list and select it (inline create/edit form).
  function handleCustomerSaved(customer: CustomerRecord) {
    const option: ProjectCustomerOption = {
      id: customer.id,
      name: customer.name,
      nameForInvoice: customer.name_for_invoice ?? null,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      city: extractCityFromAddress(customer.address),
    };
    setCustomerOptions((prev) => {
      if (prev.some((c) => c.id === option.id)) {
        return prev.map((c) => (c.id === option.id ? { ...option, contacts: c.contacts } : c));
      }
      return [option, ...prev];
    });
    setPickedCustomer((prev) => (prev && prev.id === option.id ? { ...option, contacts: prev.contacts } : option));
    setCustomerId(option.id);
    setCustomerQuery("");
    setEditingCustomer(false);
    setCustomerTab("existing");
  }

  async function submit() {
    if (submitting) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("שם פרויקט הוא שדה חובה.");
      return;
    }
    if (!customerId) {
      setError("לקוח הוא שדה חובה.");
      setStep(1);
      return;
    }
    const agreed = agreedBasePrice.trim() ? Number(agreedBasePrice) : 0;
    if (!Number.isFinite(agreed) || agreed < 0) {
      setError("מחיר בסיס אינו תקין.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        customer_id: customerId,
        name: trimmedName,
        project_type: projectType,
        status,
        agreed_base_price: noCharge ? 0 : agreed,
        actual_price: noCharge ? 0 : agreed,
        price_includes_vat: priceIncludesVat,
        no_charge: noCharge,
        expenses_billed_separately: expensesSeparately,
        project_manager_id: projectManagerId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        payment_terms: paymentTerms,
        due_date: dueDate || null,
        notes: notes.trim() || null,
        items_to_move: isMovingProjectType(projectType) ? textToItemsToMove(itemsToMove) : null,
        origin_address: isMovingProjectType(projectType) ? origin.address.trim() || null : null,
        origin_floor: isMovingProjectType(projectType) ? origin.floor.trim() || null : null,
        origin_has_elevator: isMovingProjectType(projectType) ? elevatorToBool(origin.hasElevator) : null,
        destination_address: isMovingProjectType(projectType) ? destination.address.trim() || null : null,
        destination_floor: isMovingProjectType(projectType) ? destination.floor.trim() || null : null,
        destination_has_elevator: isMovingProjectType(projectType)
          ? elevatorToBool(destination.hasElevator)
          : null,
      };

      const result = isEditMode
        ? await offlineFetch("/api/projects/update", { id: initialProject!.id, ...payload }, "עדכון פרויקט")
        : await offlineFetch("/api/projects/create", payload, "פרויקט חדש", { idempotent: true });

      if (result.queued) {
        // Saved on the device; will sync on reconnect. Attached files can't be
        // uploaded offline and would need re-attaching after sync.
        if (canDraft) clearDraft(draftKey!);
        onSubmitted({});
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, isEditMode ? "עדכון הפרויקט נכשל." : "יצירת הפרויקט נכשלה."));
        return;
      }
      const json = result.data as { project?: Row };
      if (!json.project) {
        setError(isEditMode ? "עדכון הפרויקט נכשל." : "יצירת הפרויקט נכשלה.");
        return;
      }

      const savedId = typeof json.project.id === "string" ? json.project.id : "";
      if (savedId && attachmentFiles.length > 0) {
        for (const file of attachmentFiles) {
          await uploadProjectDocument(savedId, file);
        }
      }

      if (canDraft) clearDraft(draftKey!);
      // Pricing a project (or marking it ללא חיוב) resolves the "closed unbilled"
      // alert — resync now so it clears on screen instead of waiting for the cron.
      void resyncAlerts();
      onSubmitted(json.project);
    } catch (e: unknown) {
      setError(toHebrewError(e, "שגיאה לא ידועה. נסו שוב."));
    } finally {
      setSubmitting(false);
    }
  }

  // Explicit dismiss (cancel button / the X) discards the saved draft so reopening
  // starts fresh. Passively leaving the app (reload / navigate / background) keeps
  // it — that's what the autosave is for.
  function handleCancel() {
    if (canDraft) clearDraft(draftKey!);
    onCancel();
  }

  return (
    <StepWizard
      steps={WIZARD_STEPS}
      current={step}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      onClose={handleCancel}
      onBack={step > 1 ? goBack : undefined}
      backDisabled={actionLocked}
      onNext={() => (step === 4 ? void submit() : goToStep((step + 1) as Step))}
      nextLabel={
        step === 4
          ? submitting
            ? isEditMode
              ? "שומר..."
              : "יוצר..."
            : isEditMode
              ? "שמירת שינויים"
              : "יצירת פרויקט"
          : undefined
      }
      nextDisabled={
        step === 4
          ? submitting
          : actionLocked || (step === 1 ? customerFormOpen || !customerId : !name.trim())
      }
      isLastStep={step === 4}
      error={error || undefined}
      bodyRef={bodyRef}
    >
        {customerSearchError ? (
          <p className="text-sm text-destructive">שגיאת חיפוש לקוחות: {customerSearchError}</p>
        ) : null}

      {/* ---------------------------------------------------------------- STEP 1 */}
      {step === 1 ? (
        <div className="space-y-4">
          <div className="inline-flex rounded-2xl border border-border/60 bg-background/70 p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setCustomerTab("existing")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                customerTab === "existing"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              לקוח קיים
            </button>
            <button
              type="button"
              onClick={() => setCustomerTab("new")}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                customerTab === "new"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              לקוח חדש
            </button>
          </div>

          {customerTab === "new" ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <AddUserIcon className="h-5 w-5 text-primary" /> לקוח חדש
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">בסיום הלקוח ייבחר אוטומטית לפרויקט.</p>
              </div>
              <div>
                <div className="mx-auto max-w-lg">
                  <CustomerForm
                    mode="create"
                    onCancel={() => setCustomerTab("existing")}
                    onSaved={({ customer }) => handleCustomerSaved(customer)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Search + list */}
              <div className="space-y-3">
                <div className="space-y-3">
                  <div className="relative">
                    {customerQuery ? (
                      <button
                        type="button"
                        onClick={() => setCustomerQuery("")}
                        aria-label="ניקוי חיפוש"
                        className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    ) : (
                      <SearchIcon className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    )}
                    <Input
                      value={customerQuery}
                      onChange={(e) => {
                        setCustomerQuery(e.target.value);
                        setMobileListCollapsed(false);
                      }}
                      placeholder="חיפוש..."
                      aria-label="חיפוש לקוח"
                      className="pe-9"
                    />
                  </div>
                  {customerSearchLoading ? (
                    <p className={cn("text-xs text-muted-foreground", mobileListCollapsed && "hidden lg:block")}>מחפש לקוחות...</p>
                  ) : null}

                  <div className={cn("max-h-[24rem] space-y-2 overflow-auto pe-1", mobileListCollapsed && "hidden lg:block")}>
                    {filteredCustomers.map((customer) => {
                      const isSelected = customer.id === customerId;
                      return (
                        <button
                          key={customer.id}
                          type="button"
                          disabled={actionLocked}
                          onClick={() => {
                            setCustomerId(customer.id);
                            setPickedCustomer(customer);
                            setCustomerQuery("");
                            setEditingCustomer(false);
                            if (typeof window !== "undefined" && window.innerWidth < 1024) {
                              setMobileListCollapsed(true);
                            }
                          }}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-right transition-all duration-200",
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border bg-background hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                            )}
                          >
                            {isSelected ? <CheckIcon className="h-3 w-3" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-foreground">{customer.name}</span>
                            {customer.phone || customer.city ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {[customer.phone, customer.city].filter(Boolean).join(" · ")}
                              </span>
                            ) : null}
                            {customer.nameForInvoice && customer.nameForInvoice !== customer.name ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                שם לחשבונית: {customer.nameForInvoice}
                              </span>
                            ) : null}
                            {(customer.contacts ?? []).length > 0 ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                איש קשר: {customer.contacts![0].full_name}
                                {customer.contacts![0].phone ? ` · ${customer.contacts![0].phone}` : ""}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}

                    {filteredCustomers.length === 0 ? (
                      <div className="space-y-2 rounded-xl border border-dashed p-4 text-sm">
                        <p className="text-muted-foreground">לא נמצאו לקוחות לחיפוש הזה.</p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setCustomerTab("new")}
                          disabled={actionLocked}
                        >
                          <AddUserIcon className="h-4 w-4" /> הוספת לקוח חדש
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Selected customer detail */}
              <div className="space-y-3">
                <div>
                  {selectedCustomer ? (
                    <div className="space-y-4 rounded-xl border border-border/70 bg-background p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold text-foreground">{selectedCustomer.name}</h3>
                          {selectedCustomer.contacts?.[0]?.full_name ? (
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">
                              {selectedCustomer.contacts[0].full_name}
                              {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                            </p>
                          ) : selectedCustomer.email ? (
                            <p className="mt-0.5 truncate text-sm text-muted-foreground">{selectedCustomer.email}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="success">נבחר</Badge>
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="h-8 w-8"
                            onClick={() => setEditingCustomer((v) => !v)}
                            disabled={actionLocked}
                            aria-label={editingCustomer ? "סגירת העריכה" : "עריכת פרטי הלקוח"}
                            title={editingCustomer ? "סגירת העריכה" : "עריכת פרטי הלקוח"}
                          >
                            {editingCustomer ? <CloseIcon className="h-4 w-4" /> : <EditIcon className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>

                      {editingCustomer ? (
                        <CustomerForm
                          key={selectedCustomer.id}
                          mode="edit"
                          initial={{ id: selectedCustomer.id }}
                          onCancel={() => setEditingCustomer(false)}
                          onSaved={({ customer }) => handleCustomerSaved(customer)}
                        />
                      ) : (
                        /* All fields shown (even empty); empty ones show a dash rather
                           than calling out "missing". */
                        <div className="space-y-1 border-t border-border/60 pt-2 text-sm">
                          {[
                            { label: "טלפון", value: selectedCustomer.phone, ltr: true },
                            { label: "וואטסאפ", value: selectedCustomer.whatsapp, ltr: true },
                            { label: "אימייל", value: selectedCustomer.email, ltr: true },
                            { label: "כתובת", value: omitUnknownPlace(selectedCustomer.address || selectedCustomer.city), ltr: false, isAddress: true },
                            { label: "שם לחשבונית", value: selectedCustomer.nameForInvoice, ltr: false },
                          ].map((row) => (
                            <p key={row.label} className="break-words leading-5">
                              <span className="text-muted-foreground">{row.label}: </span>
                              {row.value ? (
                                row.isAddress ? (
                                  <AddressLink
                                    address={row.value}
                                    className="inline-flex items-center gap-1 font-medium text-foreground"
                                  >
                                    <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                                    {row.value}
                                  </AddressLink>
                                ) : (
                                  <span dir={row.ltr ? "ltr" : undefined} className="font-medium text-foreground">
                                    {/* LRI…PDI forces LTR ordering for emails/phones in the RTL line */}
                                    {row.ltr ? `⁦${row.value}⁩` : row.value}
                                  </span>
                                )
                              ) : (
                                <span className="font-medium text-muted-foreground">—</span>
                              )}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <UserIcon className="h-6 w-6" />
                      </span>
                      <p className="text-sm font-medium text-foreground">בחרו לקוח מהרשימה</p>
                      <p className="text-sm text-muted-foreground">פרטי הלקוח יוצגו כאן וניתן יהיה לערוך אותם.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 2 */}
      {step === 2 ? (
        <fieldset disabled={submitting} className="contents">
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="font-medium">שם פרויקט *</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">סוג פרויקט *</span>
                <NativeSelect value={projectType} onChange={(e) => setProjectType(e.target.value)}>
                  {projectTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {projectTypeLabel(v)}
                    </option>
                  ))}
                </NativeSelect>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">סטטוס *</span>
                <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((v) => (
                    <option key={v} value={v}>
                      {statusLabel(v)}
                    </option>
                  ))}
                </NativeSelect>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">תאריך התחלה</span>
                <DateInput
                  value={startDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartDate(next);
                    // Most projects start and finish the same day, so mirror it —
                    // the end date stays editable afterwards.
                    setEndDate(next);
                    const computed = computeDueDate(next, paymentTerms);
                    if (computed) setDueDate(computed);
                  }}
                />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">תאריך סיום (אופציונלי)</span>
                <DateInput value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>

              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="font-medium">מנהל פרויקט</span>
                <NativeSelect
                  value={projectManagerId}
                  onChange={(e) => setProjectManagerId(e.target.value)}
                >
                  <option value="">ללא שיוך</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>

              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="font-medium">תיאור / הערות</span>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </label>

              {isMovingProjectType(projectType) ? (
                <div className="space-y-2 text-sm sm:col-span-2">
                  <span className="font-medium">כתובות ההובלה</span>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <MovingEndpointFields title="מוצא (מאיפה)" value={origin} onChange={setOrigin} />
                    <MovingEndpointFields title="יעד (לאן)" value={destination} onChange={setDestination} />
                  </div>
                </div>
              ) : null}

              {isMovingProjectType(projectType) ? (
                <div className="space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium">פריטים להעברה</span>
                  <Textarea
                    value={itemsToMove}
                    onChange={(e) => setItemsToMove(e.target.value)}
                    rows={5}
                    placeholder="כל פריט בשורה נפרדת"
                  />
                  <p className="text-xs text-muted-foreground">אפשר להשאיר ריק. כל שורה תישמר כפריט נפרד.</p>
                </div>
              ) : null}

              <div className="space-y-2 text-sm sm:col-span-2">
                <span className="font-medium">תמונות / מסמכים</span>
                <div className="flex flex-wrap items-center gap-2">
                  <FileUploadActions
                    files={attachmentFiles}
                    multiple
                    onFilesSelected={setAttachmentFiles}
                    chooseLabel={attachmentFiles.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                    chooseVariant="outline"
                    size="sm"
                  />
                  {attachmentFiles.length > 0 ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                      נקה בחירה
                    </Button>
                  ) : null}
                </div>
                {attachmentFiles.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    אפשר להעלות קבצים או לצלם תמונה ישירות מהמכשיר.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </fieldset>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 3 */}
      {step === 3 ? (
        <fieldset disabled={submitting} className="contents">
          <div className="grid gap-4">
            <div className="space-y-1.5 text-sm">
              <span className="font-medium">מחיר בסיס מוסכם</span>
              <CurrencyInput
                value={noCharge ? "0" : agreedBasePrice}
                onChange={(e) => setAgreedBasePrice(e.target.value)}
                disabled={noCharge}
              />
              <label className="flex items-start gap-2.5 pt-1 text-sm font-normal">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={priceIncludesVat}
                  disabled={noCharge}
                  onChange={(e) => setPriceIncludesVat(e.target.checked)}
                />
                <span>הוסף מע״מ מעל מחיר הבסיס (הלקוח משלם בסיס + מע״מ)</span>
              </label>
              <label className="flex items-start gap-2.5 pt-1 text-sm font-normal">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={noCharge}
                  onChange={(e) => {
                    setNoCharge(e.target.checked);
                    if (e.target.checked) setPriceIncludesVat(false);
                  }}
                />
                <span>ללא חיוב — תרומה / טובה / ללא תשלום (המחיר יישאר 0)</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">צורת תשלום</span>
                <NativeSelect
                  value={paymentTerms}
                  onChange={(e) => {
                    const t = e.target.value;
                    setPaymentTerms(t);
                    const computed = computeDueDate(startDate, t);
                    if (computed) setDueDate(computed);
                  }}
                >
                  {PAYMENT_TERMS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">תאריך פירעון</span>
                <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </label>
            </div>

            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={expensesSeparately}
                onChange={(e) => setExpensesSeparately(e.target.checked)}
              />
              <span>חיוב הוצאות בנפרד</span>
            </label>
          </div>
        </fieldset>
      ) : null}

      {/* ------------------------------------------------------------- STEP 4 */}
      {step === 4 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-md border border-secondary/35 bg-secondary/10 px-3 py-2.5 text-sm text-foreground">
            <AiIcon className="h-4 w-4 shrink-0 text-secondary" />
            <span>
              בדקו שהכל תקין ולחצו <span className="font-semibold">{isEditMode ? "שמירת שינויים" : "יצירת פרויקט"}</span>.
            </span>
          </div>

          <SummarySection icon={<UserIcon className="h-4 w-4" />} title="לקוח" onEdit={() => goToStep(1)} editDisabled={actionLocked}>
            <SummaryRow label="לקוח" value={pickedCustomer?.name ?? ""} />
            <SummaryRow label="טלפון" value={pickedCustomer?.phone ?? ""} />
          </SummarySection>

          <SummarySection icon={<DocumentIcon className="h-4 w-4" />} title="פרטי הפרויקט" onEdit={() => goToStep(2)} editDisabled={actionLocked}>
            <SummaryRow label="שם הפרויקט" value={name.trim()} />
            <SummaryRow label="סוג" value={projectTypeLabel(projectType)} />
            <SummaryRow label="סטטוס" value={statusLabel(status)} />
            <SummaryRow label="תאריך התחלה" value={startDate} />
            <SummaryRow label="תאריך סיום" value={endDate} />
            {notes.trim() ? <SummaryRow label="הערות" value={notes.trim()} /> : null}
          </SummarySection>

          <SummarySection icon={<CardIcon className="h-4 w-4" />} title="תשלום וחיוב" onEdit={() => goToStep(3)} editDisabled={actionLocked}>
            <SummaryRow
              label="מחיר מוסכם"
              value={noCharge ? "ללא חיוב" : agreedBasePrice ? `₪${agreedBasePrice}` : ""}
            />
            <SummaryRow label="המחיר כולל מע״מ" value={priceIncludesVat ? "כן" : "לא"} />
            <SummaryRow label="תנאי תשלום" value={termsLabelFor(paymentTerms)} />
            <SummaryRow label="תאריך פירעון" value={dueDate} />
            <SummaryRow label="חיוב הוצאות בנפרד" value={expensesSeparately ? "כן" : "לא"} />
          </SummarySection>
        </div>
      ) : null}

    </StepWizard>
  );
}
