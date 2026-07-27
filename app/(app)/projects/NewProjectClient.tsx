"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Pencil, Search, User, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { offlineFetch, saveDraft, loadDraft, clearDraft } from "@/lib/offline-queue";
import { toHebrewError } from "@/lib/error-messages";
import { resyncAlerts } from "@/lib/ui/alerts-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddressLink } from "@/components/ui/address-link";
import { WazeIcon } from "@/components/ui/waze-icon";
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

type Row = Record<string, unknown>;
type Step = 1 | 2 | 3;

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
    address,
    city: getString(row, ["city"]) ?? extractCityFromAddress(address),
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
];

const STEP_TITLES: Record<Step, string> = {
  1: "למי הפרויקט?",
  2: "פרטי הפרויקט",
  3: "תשלום וחיוב",
};

/** Top progress indicator: numbered steps with labels, connected by a track. RTL-aware. */
function WizardStepper({
  current,
  canClick,
  onStepClick,
}: {
  current: Step;
  canClick: (n: Step) => boolean;
  onStepClick: (n: Step) => void;
}) {
  return (
    <div className="flex items-start">
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
                  "w-14 text-center text-[10px] font-medium leading-tight",
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

function ValueField({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border/70 bg-background/70 px-4 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium leading-6 text-foreground">{value}</div>
    </div>
  );
}

const fieldClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";

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
    initialProject?.project_type ?? restoredDraft?.projectType ?? projectTypeOptions[0]
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

  const title = STEP_TITLES[step];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Pinned top bar: step progress + close (X moved here from the dialog corner) */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-background px-4 py-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          <WizardStepper current={step} canClick={canClickStep} onStepClick={goToStep} />
        </div>
        <button
          type="button"
          onClick={handleCancel}
          aria-label="סגירה"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Scrollable body — only this section scrolls; the bars stay pinned. */}
      <div ref={bodyRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>

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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-5 w-5 text-primary" /> לקוח חדש
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">בסיום הלקוח ייבחר אוטומטית לפרויקט.</p>
              </CardHeader>
              <CardContent>
                <div className="mx-auto max-w-lg">
                  <CustomerForm
                    mode="create"
                    onCancel={() => setCustomerTab("existing")}
                    onSaved={({ customer }) => handleCustomerSaved(customer)}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Search + list */}
              <Card>
                <CardContent className="space-y-3 pt-5">
                  <div className="relative">
                    {customerQuery ? (
                      <button
                        type="button"
                        onClick={() => setCustomerQuery("")}
                        aria-label="ניקוי חיפוש"
                        className="absolute end-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    )}
                    <Input
                      value={customerQuery}
                      onChange={(e) => setCustomerQuery(e.target.value)}
                      placeholder="חיפוש..."
                      aria-label="חיפוש לקוח"
                      className="pe-9"
                    />
                  </div>
                  {customerSearchLoading ? (
                    <p className="text-xs text-muted-foreground">מחפש לקוחות...</p>
                  ) : null}

                  <div className="max-h-[24rem] space-y-2 overflow-auto pe-1">
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
                            {isSelected ? <Check className="h-3 w-3" /> : null}
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
                          <UserPlus className="h-4 w-4" /> הוספת לקוח חדש
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>

              {/* Selected customer detail */}
              <Card>
                <CardContent className="pt-5">
                  {selectedCustomer ? (
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold text-foreground">{selectedCustomer.name}</h3>
                          {selectedCustomer.contacts?.[0]?.full_name ? (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {selectedCustomer.contacts[0].full_name}
                              {selectedCustomer.email ? ` · ${selectedCustomer.email}` : ""}
                            </p>
                          ) : selectedCustomer.email ? (
                            <p className="mt-0.5 text-sm text-muted-foreground">{selectedCustomer.email}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <Badge variant="success">נבחר</Badge>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingCustomer((v) => !v)}
                            disabled={actionLocked}
                          >
                            <Pencil className="h-3.5 w-3.5" /> {editingCustomer ? "סגירה" : "עריכה"}
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
                        <div className="grid gap-3 sm:grid-cols-2">
                          <ValueField label="טלפון" value={selectedCustomer.phone || "-"} />
                          <ValueField label="וואטסאפ" value={selectedCustomer.whatsapp || "-"} />
                          <ValueField label="אימייל" value={selectedCustomer.email || "-"} />
                          <ValueField
                            label="עיר / כתובת"
                            value={
                              selectedCustomer.address || selectedCustomer.city ? (
                                <AddressLink
                                  address={selectedCustomer.address || selectedCustomer.city}
                                  className="inline-flex items-center gap-1"
                                >
                                  <WazeIcon className="h-3.5 w-3.5 shrink-0" />
                                  {selectedCustomer.address || selectedCustomer.city}
                                </AddressLink>
                              ) : (
                                "-"
                              )
                            }
                          />
                          {selectedCustomer.nameForInvoice ? (
                            <ValueField label="שם לחשבונית" value={selectedCustomer.nameForInvoice} className="sm:col-span-2" />
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 text-center">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <User className="h-6 w-6" />
                      </span>
                      <p className="text-sm font-medium text-foreground">בחרו לקוח מהרשימה</p>
                      <p className="text-sm text-muted-foreground">פרטי הלקוח יוצגו כאן וניתן יהיה לערוך אותם.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      ) : null}

      {/* ---------------------------------------------------------------- STEP 2 */}
      {step === 2 ? (
        <fieldset disabled={submitting} className="contents">
          <div className="grid gap-4">
            {selectedCustomer ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm">
                <div className="text-xs text-muted-foreground">לקוח נבחר</div>
                <div className="mt-1 font-medium text-foreground">
                  {selectedCustomer.name}
                  {selectedCustomer.phone ? (
                    <span className="text-muted-foreground"> · {selectedCustomer.phone}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="font-medium">שם פרויקט *</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">סוג פרויקט *</span>
                <select className={fieldClass} value={projectType} onChange={(e) => setProjectType(e.target.value)}>
                  {projectTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {projectTypeLabel(v)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">סטטוס *</span>
                <select className={fieldClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions.map((v) => (
                    <option key={v} value={v}>
                      {statusLabel(v)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="font-medium">תאריך התחלה</span>
                <DateInput
                  value={startDate}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStartDate(next);
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
                <select
                  className={fieldClass}
                  value={projectManagerId}
                  onChange={(e) => setProjectManagerId(e.target.value)}
                >
                  <option value="">ללא שיוך</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1.5 text-sm sm:col-span-2">
                <span className="font-medium">תיאור / הערות</span>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
              </label>

              {isMovingProjectType(projectType) ? (
                <div className="space-y-2 text-sm sm:col-span-2">
                  <span className="font-medium">כתובות ההובלה</span>
                  <div className="grid gap-3 sm:grid-cols-2">
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
            {selectedCustomer ? (
              <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm">
                <div className="text-xs text-muted-foreground">לקוח נבחר</div>
                <div className="mt-1 font-medium text-foreground">
                  {selectedCustomer.name}
                  {selectedCustomer.phone ? (
                    <span className="text-muted-foreground"> · {selectedCustomer.phone}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm">
                <span className="font-medium">צורת תשלום</span>
                <select
                  className={fieldClass}
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
                </select>
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

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {/* Pinned bottom bar */}
      <div className="shrink-0 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          {step === 1 ? (
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={actionLocked} className="min-w-0">
              ביטול
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={goBack} disabled={actionLocked} className="min-w-0">
              חזרה
            </Button>
          )}

          {step === 3 ? (
            <Button type="button" onClick={() => void submit()} disabled={submitting} className="min-w-0 shrink">
              {submitting
                ? isEditMode
                  ? "שומר..."
                  : "יוצר..."
                : isEditMode
                  ? "שמירת שינויים"
                  : "יצירת פרויקט"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => goToStep((step + 1) as Step)}
              disabled={
                actionLocked ||
                (step === 1 ? customerFormOpen || !customerId : !name.trim())
              }
              className="min-w-0 shrink"
            >
              {step === 1 ? "המשך לפרטים" : "המשך לתשלום"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
