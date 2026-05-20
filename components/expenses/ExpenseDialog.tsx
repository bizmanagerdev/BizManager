"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { offlineFetch } from "@/lib/offline-queue";
import { cn } from "@/lib/utils";
import type { FinancialAttachment } from "@/lib/payments";

type PaymentStatus = "paid" | "partial" | "not_paid";

export type EditingExpenseData = {
  id: string;
  amount: number | string;
  category: string | null;
  description?: string | null;
  notes?: string | null;
  expense_date: string | null;
  business_domain: string | null;
  payment_status?: string | null;
  paid_amount?: number | string | null;
  payment_method?: string | null;
  project_id?: string | null;
  order_id?: string | null;
  property_id?: string | null;
  billed_to_customer?: boolean | null;
  included_in_base_price?: boolean | null;
  attachments?: FinancialAttachment[];
};

export type ExpenseDialogSavedData = {
  expenseId: string;
  expense: Record<string, unknown>;
  projectExpense: Record<string, unknown> | null;
  attachments: FinancialAttachment[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Edit mode — provide existing expense data
  editingExpense?: EditingExpenseData | null;
  // Label shown in the source info banner when editing
  editingSourceLabel?: string | null;

  // Lock to a specific source (project/order/property context)
  lockedProjectId?: string | null;
  lockedOrderId?: string | null;
  lockedPropertyId?: string | null;

  // Selectors shown when the source is not locked
  recurringProjects?: Array<{ id: string; label: string }>;
  recurringOrders?: Array<{ id: string; label: string }>;
  recurringProperties?: Array<{ id: string; label: string }>;

  // Attachment support
  showAttachments?: boolean;

  onSaved: (data: ExpenseDialogSavedData) => void | Promise<void>;
};

function normalizePaymentStatus(value: string | null | undefined): PaymentStatus {
  if (value === "paid" || value === "partial" || value === "not_paid") return value;
  return "not_paid";
}

function paymentStatusLabel(s: PaymentStatus) {
  if (s === "paid") return "שולם";
  if (s === "partial") return "חלקי";
  return "לא שולם";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function uploadAttachment(expenseId: string, file: File): Promise<FinancialAttachment | null> {
  const form = new FormData();
  form.set("entity_type", "expense");
  form.set("entity_id", expenseId);
  form.set("file", file);
  const res = await fetch("/api/financial-attachments/upload", { method: "POST", body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Upload failed");
  return (json?.attachment ?? null) as FinancialAttachment | null;
}

export function ExpenseDialog({
  open,
  onOpenChange,
  editingExpense,
  editingSourceLabel,
  lockedProjectId,
  lockedOrderId,
  lockedPropertyId,
  recurringProjects = [],
  recurringOrders = [],
  recurringProperties = [],
  showAttachments = false,
  onSaved,
}: Props) {
  const isEditing = Boolean(editingExpense);
  const [saving, setSaving] = useState(false);

  const [businessDomain, setBusinessDomain] = useState<ExpenseBusinessDomain>("general_business");
  const [projectId, setProjectId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("not_paid");
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [includedInBasePrice, setIncludedInBasePrice] = useState(false);
  const [billedToCustomer, setBilledToCustomer] = useState(false);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<FinancialAttachment[]>([]);

  const lockedDomain: ExpenseBusinessDomain | null = lockedProjectId
    ? "logistics_projects"
    : lockedOrderId
      ? "sales"
      : lockedPropertyId
        ? "property_management"
        : null;
  const isSourceLocked = Boolean(lockedProjectId || lockedOrderId || lockedPropertyId);
  const effectiveDomain = lockedDomain ?? businessDomain;
  const effectiveProjectId = lockedProjectId ?? (effectiveDomain === "logistics_projects" ? projectId : "");
  const effectiveOrderId = lockedOrderId ?? (effectiveDomain === "sales" ? orderId : "");
  const effectivePropertyId = lockedPropertyId ?? (effectiveDomain === "property_management" ? propertyId : "");
  const showBillingOptions = Boolean(effectiveProjectId);

  useEffect(() => {
    if (!open) return;
    if (editingExpense) {
      const raw = editingExpense.amount;
      setAmount(typeof raw === "number" ? String(raw) : raw ?? "");
      setExpenseDate(editingExpense.expense_date ?? todayIso());
      setPaymentStatus(normalizePaymentStatus(editingExpense.payment_status));
      const rawPaid = editingExpense.paid_amount;
      setPaidAmount(rawPaid != null ? String(rawPaid) : "");
      setPaymentMethod(typeof editingExpense.payment_method === "string" ? editingExpense.payment_method : "");
      setCategory(editingExpense.category ?? "");
      setDescription(editingExpense.description ?? "");
      setNotes(editingExpense.notes ?? "");
      setBilledToCustomer(Boolean(editingExpense.billed_to_customer));
      setIncludedInBasePrice(Boolean(editingExpense.included_in_base_price));
      const dom = editingExpense.business_domain;
      if (dom && (EXPENSE_BUSINESS_DOMAINS as readonly string[]).includes(dom)) {
        setBusinessDomain(dom as ExpenseBusinessDomain);
      }
      setExistingAttachments(
        Array.isArray(editingExpense.attachments) ? editingExpense.attachments : []
      );
    } else {
      setAmount("");
      setExpenseDate(todayIso());
      setPaymentStatus("not_paid");
      setPaidAmount("");
      setPaymentMethod("");
      setCategory("");
      setDescription("");
      setNotes("");
      setBusinessDomain(lockedDomain ?? "general_business");
      setProjectId("");
      setOrderId("");
      setPropertyId("");
      setIncludedInBasePrice(false);
      setBilledToCustomer(false);
      setExistingAttachments([]);
    }
    setAttachmentFiles([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async () => {
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }
    if (!expenseDate) {
      toast.error("יש לבחור תאריך");
      return;
    }
    if (!category.trim()) {
      toast.error("יש להזין קטגוריה");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        project_id: effectiveProjectId || null,
        order_id: effectiveOrderId || null,
        property_id: effectivePropertyId || null,
        business_domain: effectiveDomain,
        amount: amountNumber,
        category: category.trim(),
        expense_date: expenseDate,
        description: description.trim() || null,
        notes: notes.trim() || null,
        included_in_base_price: showBillingOptions ? includedInBasePrice : false,
        billed_to_customer: showBillingOptions ? billedToCustomer : false,
        payment_status: paymentStatus,
        paid_amount: paymentStatus === "partial" ? (Number(paidAmount) || null) : null,
        payment_method: (paymentStatus === "paid" || paymentStatus === "partial") ? (paymentMethod || null) : null,
      };

      let expenseId: string;
      let expenseData: Record<string, unknown>;
      let projectExpenseData: Record<string, unknown> | null = null;

      if (isEditing && editingExpense) {
        const res = await fetch("/api/expenses/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingExpense.id, ...payload }),
        });
        const json = (await res.json().catch(() => null)) as {
          error?: string;
          expense?: Record<string, unknown>;
          projectExpense?: Record<string, unknown>;
        } | null;
        if (!res.ok) {
          toast.error("שגיאה בעדכון ההוצאה", { description: json?.error ?? "" });
          return;
        }
        expenseData = json?.expense ?? {};
        expenseId = (expenseData.id as string) ?? editingExpense.id;
        projectExpenseData = json?.projectExpense ?? null;
        toast.success("ההוצאה עודכנה");
      } else {
        const result = await offlineFetch("/api/expenses/create", payload, "הוצאה חדשה");
        if (result.queued) {
          toast.info("אין חיבור — ההוצאה תישמר ותישלח כשיחזור החיבור");
          onOpenChange(false);
          onSaved({ expenseId: "", expense: {}, projectExpense: null, attachments: [] });
          return;
        }
        if (!result.ok) {
          toast.error("שגיאה ביצירת ההוצאה", { description: result.error ?? "" });
          return;
        }
        const json = result.data as {
          expense?: Record<string, unknown>;
          projectExpense?: Record<string, unknown>;
        } | null;
        expenseData = json?.expense ?? {};
        expenseId = (expenseData.id as string) ?? "";
        projectExpenseData = json?.projectExpense ?? null;
        toast.success("ההוצאה נוספה");
      }

      const uploadedAttachments: FinancialAttachment[] = [];
      if (showAttachments && expenseId) {
        for (const file of attachmentFiles) {
          const att = await uploadAttachment(expenseId, file);
          if (att) uploadedAttachments.push(att);
        }
      }

      const savedResult = onSaved({
        expenseId,
        expense: {
          ...expenseData,
          attachments: [...existingAttachments, ...uploadedAttachments],
        },
        projectExpense: projectExpenseData,
        attachments: [...existingAttachments, ...uploadedAttachments],
      });
      if (savedResult instanceof Promise) await savedResult;
      onOpenChange(false);
    } catch (error) {
      toast.error(isEditing ? "שגיאה בעדכון ההוצאה" : "שגיאה ביצירת ההוצאה", {
        description: error instanceof Error ? error.message : "",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{isEditing ? "עריכת הוצאה" : "הוספת הוצאה"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "עדכון פרטי הוצאה קיימת." : "יצירת הוצאה חדשה."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
        >
          {/* Source info / selectors */}
          {isSourceLocked ? (
            <div className="rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">
                {editingSourceLabel ?? (lockedProjectId ? "פרויקט" : lockedOrderId ? "הזמנה" : "נכס")}
              </div>
              <div>השיוך למקור נשמר כמו שהוא — ניתן לעדכן רק את פרטי ההוצאה.</div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium">תחום עסקי</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={businessDomain}
                  onChange={(e) => {
                    const next = e.target.value as ExpenseBusinessDomain;
                    setBusinessDomain(next);
                    setProjectId("");
                    setOrderId("");
                    setPropertyId("");
                  }}
                >
                  {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                    <option key={d} value={d}>{getBusinessDomainLabel(d)}</option>
                  ))}
                </select>
              </div>

              {!isEditing && effectiveDomain === "logistics_projects" && recurringProjects.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">פרויקט</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">ללא פרויקט</option>
                    {recurringProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {!isEditing && effectiveDomain === "sales" && recurringOrders.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">הזמנה</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                  >
                    <option value="">ללא הזמנה</option>
                    {recurringOrders.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {!isEditing && effectiveDomain === "property_management" && recurringProperties.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">נכס</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                  >
                    <option value="">ללא נכס</option>
                    {recurringProperties.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Amount + Date */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום</div>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך</div>
              <DateInput
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>

          {/* Payment Status — right below amount */}
          <div className="space-y-1">
            <div className="text-sm font-medium">סטטוס תשלום</div>
            <div className="grid grid-cols-3 gap-2">
              {(["not_paid", "partial", "paid"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPaymentStatus(s)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                    paymentStatus === s
                      ? s === "paid"
                        ? "border-success bg-success/10 text-success"
                        : s === "partial"
                          ? "border-warning bg-warning/10 text-warning"
                          : "border-destructive bg-destructive/10 text-destructive"
                      : "border-input bg-background text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {paymentStatusLabel(s)}
                </button>
              ))}
            </div>
          </div>

          {/* Payment method + paid amount */}
          {(paymentStatus === "paid" || paymentStatus === "partial") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">אמצעי תשלום</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="">בחר אמצעי</option>
                  <option value="bank_transfer">העברה בנקאית</option>
                  <option value="cash">מזומן</option>
                  <option value="check">צ&apos;ק</option>
                  <option value="credit_card">כרטיס אשראי</option>
                  <option value="other">אחר</option>
                </select>
              </div>
              {paymentStatus === "partial" && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">סכום ששולם</div>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          )}

          {/* Category */}
          <div className="space-y-1">
            <div className="text-sm font-medium">קטגוריה</div>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <div className="text-sm font-medium">תיאור</div>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Project billing options */}
          {showBillingOptions && (
            <div className="flex flex-col gap-2 rounded-xl border px-3 py-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includedInBasePrice}
                  onChange={(e) => setIncludedInBasePrice(e.target.checked)}
                />
                <span>כלול במחיר הבסיס</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={billedToCustomer}
                  onChange={(e) => setBilledToCustomer(e.target.checked)}
                />
                <span>לחיוב לקוח</span>
              </label>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {/* Attachments */}
          {showAttachments && (
            <div className="space-y-2">
              <div className="text-sm font-medium">קבצים מצורפים</div>
              <div className="flex items-center gap-2">
                <FileUploadActions
                  files={attachmentFiles}
                  multiple
                  onFilesSelected={setAttachmentFiles}
                  chooseLabel={
                    attachmentFiles.length > 0 || existingAttachments.length > 0
                      ? "הוסף קבצים"
                      : "העלה קבצים"
                  }
                  chooseVariant="outline"
                  size="sm"
                />
                {attachmentFiles.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setAttachmentFiles([])}
                  >
                    נקה
                  </Button>
                )}
              </div>
              {attachmentFiles.length > 0 && (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {attachmentFiles.map((f) => (
                    <div key={`${f.name}-${f.size}`}>{f.name}</div>
                  ))}
                </div>
              )}
              {existingAttachments.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">קבצים קיימים</div>
                  <div className="flex flex-wrap gap-2">
                    {existingAttachments.map((att) => (
                      <a
                        key={att.document_id}
                        href={att.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border px-2 py-1 text-xs text-primary hover:bg-accent"
                      >
                        {att.file_name ?? "קובץ"}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={saving || !amount.trim() || !expenseDate || !category.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                "שמירה"
              )}
            </Button>
          </DialogFooter>
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
