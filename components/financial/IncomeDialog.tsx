"use client";

// "הכנסה חדשה" — the shared income-entry dialog. Lifted out of DashboardActions
// (where it was ~70 pieces of inline form state) so the dashboard quick actions
// AND the top-bar quick-create (+) menu render the exact same form. Owns all of
// its own state: mount it anywhere, hand it `open` + the link-target lists.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { toHebrewError } from "@/lib/error-messages";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { FormDialog } from "@/components/ui/form-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { CheckDetailsFields } from "@/components/payments/CheckDetailsFields";
import { DomainSelect } from "@/components/financial/DomainSelect";
import AccountSelect from "@/components/financial/AccountSelect";
import { TagPicker } from "@/components/tags/TagPicker";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { offlineFetch } from "@/lib/offline-queue";
import { type ExpenseBusinessDomain } from "@/lib/expenses";
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

type Row = Record<string, unknown>;

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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: IncomeProjectOption[];
  orders: IncomeEntityOption[];
  properties: IncomeEntityOption[];
  /** Pre-select the account the money lands in (opened from that account's page). */
  defaultAccountId?: string;
  onSaved?: () => void;
}) {
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

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const filteredProjects = useMemo(() => {
    const q = projectQuery.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(q) || project.customerName.toLowerCase().includes(q)
    );
  }, [projectQuery, projects]);

  function resetForm() {
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

  async function createIncome() {
    setError(null);
    const linkedProjectId = businessDomain === "logistics_projects" ? projectId : "";
    const linkedOrderId = businessDomain === "sales" ? orderId : "";
    const linkedPropertyId = businessDomain === "property_management" ? propertyId : "";

    const validationError = validateIncomeForm({
      incomeBusinessDomain: businessDomain,
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
          incomeBusinessDomain: businessDomain,
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
        onOpenChange(false);
        resetForm();
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

      onOpenChange(false);
      resetForm();
      onSaved?.();
      toast.success(HEBREW.incomeSaved);
    } catch (err: unknown) {
      setError(toHebrewError(err, HEBREW.saveErrorUnknown));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
      title={HEBREW.incomeNew}
      description={HEBREW.incomeDialogDescription}
      size="formXl"
      onSubmit={() => void createIncome()}
      submitLabel={HEBREW.saveIncome}
      busyLabel={HEBREW.saving}
      busy={submitting}
      error={error || undefined}
    >
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span>{HEBREW.domain} *</span>
              <DomainSelect
                value={businessDomain}
                onChange={(next) => {
                  const nextDomain = next as ExpenseBusinessDomain | "";
                  setBusinessDomain(nextDomain);
                  if (nextDomain !== "logistics_projects") {
                    setProjectId("");
                    setProjectQuery("");
                  }
                  if (nextDomain !== "sales") setOrderId("");
                  if (nextDomain !== "property_management") setPropertyId("");
                  if (nextDomain !== "general_business") setTagIds([]);
                }}
              />
            </label>

            {businessDomain === "logistics_projects" ? (
              <div className="space-y-2 text-sm">
                <span>{HEBREW.project} *</span>
                <Input
                  value={projectQuery}
                  onChange={(e) => setProjectQuery(e.target.value)}
                  placeholder="חיפוש..."
                />
                <div className="max-h-56 space-y-1 overflow-auto rounded-md border p-1">
                  {filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => {
                        setProjectId(project.id);
                        setProjectQuery(project.name);
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition-all duration-200 ${
                        project.id === projectId
                          ? "border-primary/20 bg-primary text-primary-foreground shadow-sm shadow-primary/25"
                          : "border-border bg-accent/40 text-accent-foreground hover:bg-accent"
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{project.name}</span>
                        {project.customerName ? (
                          <span
                            className={`text-xs ${
                              project.id === projectId ? "text-primary-foreground/70" : "text-muted-foreground"
                            }`}
                          >
                            · {project.customerName}
                          </span>
                        ) : null}
                        {normalizeDateOnly(project.startDate) ? (
                          <span
                            className={`text-xs ${
                              project.id === projectId ? "text-primary-foreground/70" : "text-muted-foreground"
                            }`}
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
            ) : null}

            {businessDomain === "sales" ? (
              <label className="space-y-2 text-sm">
                <span>הזמנה</span>
                <NativeSelect value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  <option value="">ללא הזמנה</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.name}
                      {order.subtitle ? ` | ${order.subtitle}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}

            {businessDomain === "property_management" ? (
              <label className="space-y-2 text-sm">
                <span>נכס *</span>
                <NativeSelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                  <option value="">בחרו נכס</option>
                  {properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                      {property.subtitle ? ` | ${property.subtitle}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}

            {businessDomain ? (
              <>
                <AdaptiveGrid variant="formTwoLoose">
                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.amount} *</span>
                    <CurrencyInput
                      type="number"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span>{HEBREW.paymentMethod} *</span>
                    <NativeSelect
                      value={method}
                      onChange={(e) => {
                        const m = e.target.value;
                        setMethod(m);
                        setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                      }}
                    >
                      <option value=""></option>
                      <option value="bank_transfer">{HEBREW.bankTransfer}</option>
                      <option value="cash">{HEBREW.cash}</option>
                      <option value="check">{HEBREW.check}</option>
                      <option value="credit_card">{HEBREW.creditCard}</option>
                      <option value="other">{HEBREW.other}</option>
                    </NativeSelect>
                    {method === "check" ? (
                      <span className="block text-xs text-muted-foreground">
                        {"צ'ק יירשם כממתין לפירעון עד תאריך הפירעון."}
                      </span>
                    ) : null}
                  </label>
                  <AccountSelect
                    required
                    value={accountId}
                    onChange={setAccountId}
                    onLoaded={(list) => {
                      setAccountsList(list);
                      setAccountId((prev) => prev || defaultAccountForMethod(list, method));
                    }}
                  />
                </AdaptiveGrid>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.date} *</span>
                  <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
                </label>

                {method ? (
                  <AdaptiveGrid variant="formTwoLoose">
                    <label className="space-y-2 text-sm">
                      <span>
                        {method === "check" ? `${HEBREW.paymentDueDate} *` : "תאריך פירעון צפוי (אופציונלי)"}
                      </span>
                      <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                      {method !== "check" ? (
                        <span className="block text-[11px] text-muted-foreground">
                          לתשלומים עתידיים (למשל שוטף+30) — נרשמים כממתינים עד התאריך הזה.
                        </span>
                      ) : null}
                    </label>

                    <label className="space-y-2 text-sm">
                      <span>{HEBREW.reference}</span>
                      <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                    </label>
                  </AdaptiveGrid>
                ) : null}

                {method === "check" ? (
                  <CheckDetailsFields
                    checkNumber={checkNumber}
                    onCheckNumberChange={setCheckNumber}
                    photoFiles={checkPhotoFiles}
                    onPhotoFilesChange={setCheckPhotoFiles}
                    disabled={submitting}
                  />
                ) : null}

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresSplit}
                    onChange={(e) => setRequiresSplit(e.target.checked)}
                  />
                  <span>{HEBREW.includesVat}</span>
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.notes}</span>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>

                {businessDomain === "general_business" ? (
                  <TagPicker value={tagIds} onChange={setTagIds} />
                ) : null}

                <div className="space-y-2">
                  <div className="text-sm font-medium">קבצים מצורפים (אופציונלי)</div>
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
            ) : null}
          </div>
    </FormDialog>
  );
}

export default IncomeDialog;
