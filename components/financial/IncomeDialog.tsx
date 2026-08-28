"use client";

// "הכנסה חדשה" — the shared income-entry dialog. Lifted out of DashboardActions
// (where it was ~70 pieces of inline form state) so the dashboard quick actions
// AND the top-bar quick-create (+) menu render the exact same form. Owns all of
// its own state: mount it anywhere, hand it `open` + the link-target lists.
//
// Fully one-question-per-stage now (2026-08-25, user request: "really step by
// step like the expense dialog... one action per stage") — every field that
// used to share a grouped step gets its own screen, matching ExpenseDialog's
// express mode: tap a domain, method, account or yes/no card and it advances by
// itself; only freeform inputs (amount, dates, text, files) keep a manual Next.
// The step LIST is a dynamic array of string ids (`IncomeStepId`), not a fixed
// count — which steps exist depends on the domain and payment method chosen,
// same reasoning as ExpenseDialog's `expressSteps`.

import { useMemo, useState, useEffect } from "react";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { OptionRow, DateQuickPicks, StepHeading } from "@/components/ui/option-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { getBusinessDomainIcon } from "@/components/financial/DomainSelect";
import { loadAccounts } from "@/components/financial/AccountSelect";
import { TagPicker } from "@/components/tags/TagPicker";
import { BankIcon, CardIcon, CashIcon } from "@/components/ui/icons";
import { defaultAccountForMethod, getAccountKindLabel, type Account } from "@/lib/accounts";
import { offlineFetch } from "@/lib/offline-queue";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";
import { type FinancialAttachment } from "@/lib/payments";
import { HEBREW } from "@/app/(app)/dashboard/DashboardActions.constants";
import {
  getString,
  getTodayDate,
  isImageAttachment,
  normalizeDateOnly,
  uploadFinancialAttachment,
} from "@/app/(app)/dashboard/DashboardActions.helpers";
import { buildIncomePayload, validateIncomeForm } from "@/app/(app)/dashboard/DashboardActions.forms";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { formatCurrency } from "@/lib/payroll";
import { cn } from "@/lib/utils";

type Row = Record<string, unknown>;
type IncomeStepId =
  | "domain"
  | "project"
  | "order"
  | "property"
  | "amount"
  | "method"
  | "account"
  | "date"
  | "dueDate"
  | "reference"
  | "check"
  | "vat"
  | "notes"
  | "tags"
  | "attachments"
  | "summary";

const STEP_LABEL: Record<IncomeStepId, string> = {
  domain: "תחום",
  project: "פרויקט",
  order: "הזמנה",
  property: "נכס",
  amount: "סכום",
  method: "תשלום",
  account: "חשבון",
  date: "תאריך",
  dueDate: "פירעון",
  reference: "אסמכתא",
  check: "צ'ק",
  vat: 'מע"מ',
  notes: "הערות",
  tags: "תגיות",
  attachments: "קבצים",
  summary: "סיכום",
};

const METHOD_OPTIONS = [
  { value: "bank_transfer", labelKey: "bankTransfer" },
  { value: "cash", labelKey: "cash" },
  { value: "check", labelKey: "check" },
  { value: "credit_card", labelKey: "creditCard" },
  { value: "other", labelKey: "other" },
] as const satisfies readonly { value: string; labelKey: keyof typeof HEBREW }[];

function accountKindIcon(kind: string | null | undefined) {
  if (kind === "bank") return BankIcon;
  if (kind === "card") return CardIcon;
  return CashIcon;
}

/** A project the income can be linked to. Structurally matches the dashboard's ProjectOption. */
export type IncomeProjectOption = {
  id: string;
  name: string;
  type?: string;
  customerName: string;
  startDate?: string;
};

/** An order / property the income can be linked to. */
export type IncomeEntityOption = { id: string; name: string; subtitle?: string };

export function IncomeDialog({
  open,
  onOpenChange,
  projects,
  orders,
  properties,
  defaultAccountId,
  lockedPropertyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: IncomeProjectOption[];
  orders: IncomeEntityOption[];
  properties: IncomeEntityOption[];
  /** Pre-select the account the money lands in (opened from that account's page). */
  defaultAccountId?: string;
  /** Lock to a property (e.g. opened from a property's own page) — hides the
   *  domain + property pickers and forces business_domain=property_management. */
  lockedPropertyId?: string | null;
  onSaved?: () => void;
}) {
  const isSourceLocked = Boolean(lockedPropertyId);
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain | "">("");
  const [projectId, setProjectId] = useState("");
  const [projectQuery, setProjectQuery] = useState("");
  const [orderId, setOrderId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayDate());
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [requiresSplit, setRequiresSplit] = useState(false);
  const [reference, setReference] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [checkPhotoFiles, setCheckPhotoFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments] = useState<FinancialAttachment[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);

  // Opened from a specific account (the חשבונות page's +) — start on it. Applied
  // per open, since the dialog stays mounted between uses.
  useEffect(() => {
    if (open && defaultAccountId) setAccountId(defaultAccountId);
  }, [open, defaultAccountId]);

  // Preload accounts on open so the "account" step can render one tappable
  // card per account (same reasoning as ExpenseDialog's express mode).
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadAccounts().then((list) => {
      if (active) setAccountsList(list);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const effectiveDomain: ExpenseBusinessDomain | "" = lockedPropertyId ? "property_management" : businessDomain;
  const effectivePropertyId = lockedPropertyId ?? (effectiveDomain === "property_management" ? propertyId : "");

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) || project.customerName.toLowerCase().includes(q)
    );
  }, [projectQuery, projects]);

  // ── Dynamic step list — mirrors ExpenseDialog's expressSteps ───────────────
  // Locked (opened from a property page): domain/property are already decided,
  // so the flow starts straight on amount. Otherwise: domain first, then
  // whichever link picker that domain needs (or none), then one screen per
  // payment field, then the closing details.
  const stepIds = useMemo<IncomeStepId[]>(() => {
    const ids: IncomeStepId[] = [];
    if (!isSourceLocked) {
      ids.push("domain");
      if (businessDomain === "logistics_projects") ids.push("project");
      else if (businessDomain === "sales") ids.push("order");
      else if (businessDomain === "property_management") ids.push("property");
    }
    ids.push("amount", "method");
    if (accountsList.length > 0) ids.push("account");
    ids.push("date");
    if (method) {
      ids.push("dueDate", "reference");
      if (method === "check") ids.push("check");
    }
    ids.push("vat", "notes");
    if (businessDomain === "general_business") ids.push("tags");
    ids.push("attachments", "summary");
    return ids;
  }, [isSourceLocked, businessDomain, accountsList.length, method]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  const amountValid = Number.isFinite(Number(amount)) && Number(amount) > 0;

  // Display-only lookups for the final "summary" step.
  const summaryLinkLabel =
    effectiveDomain === "logistics_projects"
      ? projectById.get(projectId)?.name
      : effectiveDomain === "sales"
        ? (orders.find((o) => o.id === orderId)?.name ?? "ללא הזמנה")
        : effectiveDomain === "property_management"
          ? properties.find((p) => p.id === effectivePropertyId)?.name
          : undefined;
  const summaryMethodLabel = METHOD_OPTIONS.find((m) => m.value === method)?.labelKey;
  const summaryAccountName = accountsList.find((a) => a.id === accountId)?.name;

  function isSatisfied(id: IncomeStepId): boolean {
    switch (id) {
      case "domain":
        return Boolean(effectiveDomain);
      case "project":
        return Boolean(projectId);
      case "property":
        return Boolean(effectivePropertyId);
      case "amount":
        return amountValid;
      case "method":
        return Boolean(method);
      case "account":
        return Boolean(accountId);
      case "date":
        return Boolean(date);
      case "dueDate":
        return method !== "check" || Boolean(dueDate);
      case "order":
      case "reference":
      case "check":
      case "vat":
      case "notes":
      case "tags":
      case "attachments":
      case "summary":
        return true;
    }
  }

  const [stepId, setStepId] = useState<IncomeStepId>(isSourceLocked ? "amount" : "domain");
  const { stepIndex, isLastStep, canClickStep, goToStep, goBack, goNext, advanceTo } = useStepFlow<IncomeStepId>({
    stepId,
    setStepId,
    steps: stepIds,
    isSatisfied,
  });

  function resetForm() {
    setStepId(isSourceLocked ? "amount" : "domain");
    setError(null);
    setBusinessDomain("");
    setProjectId("");
    setProjectQuery("");
    setOrderId("");
    setPropertyId("");
    setAmount("");
    setDate(getTodayDate());
    setMethod("");
    setAccountId("");
    setDueDate("");
    setRequiresSplit(false);
    setReference("");
    setCheckNumber("");
    setCheckPhotoFiles([]);
    setNotes("");
    setAttachmentFiles([]);
    setTagIds([]);
  }

  function handleOpenChange(next: boolean) {
    // Never vanish mid-save — the user would have no idea whether it landed.
    if (!next && submitting) return;
    onOpenChange(next);
    if (!next) resetForm();
  }

  function pickDomain(domain: ExpenseBusinessDomain) {
    setBusinessDomain(domain);
    if (domain !== "logistics_projects") {
      setProjectId("");
      setProjectQuery("");
    }
    if (domain !== "sales") setOrderId("");
    if (domain !== "property_management") setPropertyId("");
    if (domain !== "general_business") setTagIds([]);
    advanceTo(
      domain === "logistics_projects"
        ? "project"
        : domain === "sales"
          ? "order"
          : domain === "property_management"
            ? "property"
            : "amount"
    );
  }

  function pickMethod(next: string) {
    setMethod(next);
    setAccountId((prev) => prev || defaultAccountForMethod(accountsList, next));
    advanceTo(accountsList.length > 0 ? "account" : "date");
  }

  async function createIncome() {
    setError(null);
    const linkedProjectId = effectiveDomain === "logistics_projects" ? projectId : "";
    const linkedOrderId = effectiveDomain === "sales" ? orderId : "";
    const linkedPropertyId = effectivePropertyId;

    const validationError = validateIncomeForm({
      incomeBusinessDomain: effectiveDomain,
      linkedProjectId,
      linkedPropertyId,
      incomeDate: date,
      incomeMethod: method,
      incomeDueDate: dueDate,
      incomeAmount: amount,
      accountsCount: accountsList.length,
      incomeAccountId: accountId,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    const amountValue = Number(amount);

    setSubmitting(true);
    try {
      const result = await offlineFetch(
        "/api/payments/create",
        buildIncomePayload({
          incomeBusinessDomain: effectiveDomain,
          linkedProjectId,
          linkedOrderId,
          linkedPropertyId,
          projectType: projectById.get(linkedProjectId)?.type ?? null,
          amount: amountValue,
          incomeDate: date,
          incomeDueDate: dueDate,
          incomeRequiresSplit: requiresSplit,
          incomeMethod: method,
          incomeAccountId: accountId,
          incomeReference: reference,
          incomeCheckNumber: checkNumber,
          incomeNotes: notes,
          incomeTagIds: tagIds,
        }),
        HEBREW.incomeNew,
        { idempotent: true }
      );
      if (result.queued) {
        handleOpenChange(false);
        return;
      }
      if (!result.ok) {
        setError(toHebrewError(result.error, HEBREW.incomeCreateFailed));
        return;
      }
      const json = result.data as { payment?: Row };
      if (!json.payment) {
        setError(HEBREW.incomeCreateFailed);
        return;
      }

      const paymentId = getString(json.payment, "id");
      for (const file of attachmentFiles) {
        if (!paymentId) break;
        await uploadFinancialAttachment("payment", paymentId, file);
      }
      if (method === "check" && paymentId && checkPhotoFiles.length > 0) {
        for (const file of checkPhotoFiles) {
          await uploadFinancialAttachment("payment", paymentId, file);
        }
      }

      handleOpenChange(false);
      onSaved?.();
      toast.success(HEBREW.incomeSaved);
    } catch (err: unknown) {
      setError(toHebrewError(err, HEBREW.saveErrorUnknown));
    } finally {
      setSubmitting(false);
    }
  }

  // Every step whose only interaction is tapping an option card auto-advances
  // itself — the wizard's own Next button is really just a fallback there.
  // Freeform steps (amount/date/text/files) need it to actually move on.

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle={HEBREW.incomeNew}
      dialogDescription={HEBREW.incomeDialogDescription}
      size="formXl"
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={submitting}
      onBack={stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={submitting}
      onNext={() => (isLastStep ? void createIncome() : goNext())}
      nextLabel={isLastStep ? (submitting ? HEBREW.saving : HEBREW.saveIncome) : undefined}
      nextDisabled={isLastStep ? submitting : !isSatisfied(stepId)}
      isLastStep={isLastStep}
      submitOnEnter
      error={error || undefined}
    >
      {stepId === "domain" ? (
        <>
          <StepHeading title="לאיזה תחום שייכת ההכנסה?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
            <OptionRow
              key={domain}
              icon={getBusinessDomainIcon(domain) ?? undefined}
              label={getBusinessDomainLabel(domain)}
              selected={businessDomain === domain}
              onClick={() => pickDomain(domain)}
            />
          ))}
          </div>
        </>
      ) : stepId === "project" ? (
        <>
          <StepHeading title="לאיזה פרויקט לשייך?" />
          <div className="grid gap-3">
          <Input
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
            placeholder="חיפוש פרויקט..."
          />
          <div className="space-y-1">
            {filteredProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setProjectId(project.id);
                  setProjectQuery(project.name);
                  advanceTo("amount");
                }}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-right text-sm transition-all duration-200",
                  project.id === projectId
                    ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                    : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{project.name}</span>
                  {project.customerName ? (
                    <span
                      className={cn(
                        "text-xs",
                        project.id === projectId ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}
                    >
                      · {project.customerName}
                    </span>
                  ) : null}
                  {normalizeDateOnly(project.startDate) ? (
                    <span
                      className={cn(
                        "text-xs",
                        project.id === projectId ? "text-primary-foreground/70" : "text-muted-foreground"
                      )}
                    >
                      · {normalizeDateOnly(project.startDate)}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
            {filteredProjects.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground">לא נמצאו פרויקטים לחיפוש הזה.</div>
            ) : null}
          </div>
          </div>
        </>
      ) : stepId === "order" ? (
        <>
          <StepHeading
            title="לאיזו הזמנה לשייך?"
            sub="אפשר גם בלי הזמנה"
          />
          <div className="grid gap-2">
          <OptionRow
            label="ללא הזמנה"
            selected={orderId === ""}
            onClick={() => {
              setOrderId("");
              advanceTo("amount");
            }}
          />
          {orders.map((order) => (
            <OptionRow
              key={order.id}
              label={order.name}
              sub={order.subtitle}
              selected={orderId === order.id}
              onClick={() => {
                setOrderId(order.id);
                advanceTo("amount");
              }}
            />
          ))}
          </div>
        </>
      ) : stepId === "property" ? (
        <>
          <StepHeading title="לאיזה נכס לשייך?" />
          <div className="grid gap-2">
          {properties.map((property) => (
            <OptionRow
              key={property.id}
              label={property.name}
              sub={property.subtitle}
              selected={propertyId === property.id}
              onClick={() => {
                setPropertyId(property.id);
                advanceTo("amount");
              }}
            />
          ))}
          {properties.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">אין נכסים זמינים — יש להוסיף נכס תחילה.</div>
          ) : null}
          </div>
        </>
      ) : stepId === "amount" ? (
        <>
          <StepHeading title="כמה ההכנסה?" />
          <label className="space-y-2 text-sm">
          <CurrencyInput
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          </label>
        </>
      ) : stepId === "method" ? (
        <>
          <StepHeading title="איך התקבל התשלום?" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {METHOD_OPTIONS.map((m) => (
            <OptionRow
              key={m.value}
              label={HEBREW[m.labelKey]}
              selected={method === m.value}
              onClick={() => pickMethod(m.value)}
            />
          ))}
          </div>
        </>
      ) : stepId === "account" ? (
        <>
          <StepHeading title="לאיזה חשבון?" />
          <div className="grid gap-2">
          {accountsList.map((a) => (
            <OptionRow
              key={a.id}
              icon={accountKindIcon(a.kind)}
              label={a.name}
              sub={getAccountKindLabel(a.kind)}
              selected={accountId === a.id}
              onClick={() => {
                setAccountId(a.id);
                advanceTo("date");
              }}
            />
          ))}
          </div>
        </>
      ) : stepId === "date" ? (
        <>
          <StepHeading title="מתי התקבל התשלום?" />
          <div>
          <label className="space-y-2 text-sm">
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <DateQuickPicks
            onPick={(d) => {
              setDate(d);
              advanceTo(stepIds[stepIndex("date") + 1]);
            }}
          />
          </div>
        </>
      ) : stepId === "dueDate" ? (
        <>
          <StepHeading
            title={method === "check" ? "מתי הצ'ק לפירעון?" : "תאריך פירעון צפוי?"}
            sub={method === "check" ? undefined : "אופציונלי"}
          />
          <label className="space-y-2 text-sm">
          <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          {method === "check" ? (
            <span className="block text-xs text-muted-foreground">
              {"צ'ק יירשם כממתין לפירעון עד תאריך הפירעון."}
            </span>
          ) : (
            <span className="block text-[11px] text-muted-foreground">
              לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
            </span>
          )}
          </label>
        </>
      ) : stepId === "reference" ? (
        <>
          <StepHeading title="מספר אסמכתא?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} autoFocus />
          </label>
        </>
      ) : stepId === "check" ? (
        <>
          <StepHeading title="פרטי הצ'ק" />
          <CheckDetailsFields
            checkNumber={checkNumber}
            onCheckNumberChange={setCheckNumber}
            photoFiles={checkPhotoFiles}
            onPhotoFilesChange={setCheckPhotoFiles}
            disabled={submitting}
          />
        </>
      ) : stepId === "vat" ? (
        <>
          <StepHeading title='ההכנסה כוללת מע"מ?' />
          <div className="grid grid-cols-2 gap-2">
          <OptionRow
            label="כן"
            selected={requiresSplit}
            onClick={() => {
              setRequiresSplit(true);
              advanceTo("notes");
            }}
          />
          <OptionRow
            label="לא"
            selected={!requiresSplit}
            onClick={() => {
              setRequiresSplit(false);
              advanceTo("notes");
            }}
          />
          </div>
        </>
      ) : stepId === "notes" ? (
        <>
          <StepHeading title="הערות פנימיות?" sub="לא חובה" />
          <label className="space-y-2 text-sm">
          <div className="relative">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              autoFocus
              className="pe-11"
            />
            <DictateButton
              onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
              className="absolute bottom-1 end-1 h-8 w-8"
            />
          </div>
          </label>
        </>
      ) : stepId === "tags" ? (
        <>
          <StepHeading title="לשייך תגיות?" sub="לא חובה" />
          <TagPicker value={tagIds} onChange={setTagIds} />
        </>
      ) : stepId === "attachments" ? (
        <>
          <StepHeading
            title="לצרף קבלה או אסמכתא?"
            sub="לא חובה"
          />
          <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileUploadActions
              files={attachmentFiles}
              multiple
              onFilesSelected={setAttachmentFiles}
              chooseLabel={
                attachmentFiles.length > 0 || existingAttachments.length > 0 ? "הוסף קבצים" : "העלה קבצים"
              }
              chooseVariant="outline"
              size="sm"
            />
            {attachmentFiles.length > 0 ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setAttachmentFiles([])}>
                נקה בחירה
              </Button>
            ) : null}
          </div>
          {existingAttachments.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">קבצים קיימים</div>
              <div className="flex flex-wrap gap-2">
                {existingAttachments.map((attachment) => (
                  <a
                    key={attachment.document_id}
                    href={attachment.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                  >
                    {attachment.file_name ?? "קובץ"}
                  </a>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {existingAttachments
                  .filter((attachment) => attachment.url && isImageAttachment(attachment))
                  .map((attachment) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${attachment.document_id}-preview`}
                      src={attachment.url ?? ""}
                      alt={attachment.file_name ?? "קובץ"}
                      className="h-20 w-20 rounded-lg border object-cover"
                    />
                  ))}
              </div>
            </div>
          ) : null}
          </div>
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולשמור?" />
          <SummarySection title="פרטי ההכנסה">
            <SummaryRow label={HEBREW.domain} value={getBusinessDomainLabel(effectiveDomain)} />
            {summaryLinkLabel !== undefined ? (
              <SummaryRow label={STEP_LABEL[effectiveDomain === "sales" ? "order" : effectiveDomain === "property_management" ? "property" : "project"]} value={summaryLinkLabel} />
            ) : null}
            <SummaryRow label={HEBREW.amount} value={formatCurrency(Number(amount) || 0)} />
            <SummaryRow label={HEBREW.paymentMethod} value={summaryMethodLabel ? HEBREW[summaryMethodLabel] : "—"} />
            <SummaryRow label="חשבון" value={summaryAccountName} />
            <SummaryRow label={HEBREW.date} value={normalizeDateOnly(date)} />
            {dueDate ? <SummaryRow label={HEBREW.paymentDueDate} value={normalizeDateOnly(dueDate)} /> : null}
            {reference.trim() ? <SummaryRow label={HEBREW.reference} value={reference} /> : null}
            {method === "check" && checkNumber.trim() ? <SummaryRow label="מספר צ'ק" value={checkNumber} /> : null}
            <SummaryRow label={HEBREW.includesVat} value={requiresSplit ? "כן" : "לא"} />
            {notes.trim() ? <SummaryRow label={HEBREW.notes} value={notes} /> : null}
            {tagIds.length > 0 ? <SummaryRow label="תגיות" value={tagIds.length} /> : null}
            {attachmentFiles.length > 0 ? <SummaryRow label="קבצים מצורפים" value={attachmentFiles.length} /> : null}
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}

export default IncomeDialog;
