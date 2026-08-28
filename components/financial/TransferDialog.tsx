"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/ui/native-select";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { appendDictatedText } from "@/lib/dictation";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { FormDialog } from "@/components/ui/form-dialog";
import { type ExpenseBusinessDomain } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { toHebrewError } from "@/lib/error-messages";
import { PAYMENT_METHOD_OPTIONS } from "@/lib/payments";

type SourceOption = { id: string; label: string };

type PaymentMethod = "bank_transfer" | "cash" | "check" | "credit_card" | "other";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects?: SourceOption[];
  orders?: SourceOption[];
  properties?: SourceOption[];
  onSaved: () => void | Promise<void>;
};

type SideState = {
  businessDomain: ExpenseBusinessDomain | "";
  projectId: string;
  orderId: string;
  propertyId: string;
};

function createSideState(): SideState {
  return { businessDomain: "", projectId: "", orderId: "", propertyId: "" };
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Returns the source id required for the side's domain, or "" if none is required. */
function sideSourceId(side: SideState): string {
  if (side.businessDomain === "logistics_projects") return side.projectId;
  if (side.businessDomain === "sales") return side.orderId;
  if (side.businessDomain === "property_management") return side.propertyId;
  return "";
}

function sideNeedsSource(domain: ExpenseBusinessDomain | "") {
  return domain === "logistics_projects" || domain === "sales" || domain === "property_management";
}

function SideFields({
  side,
  setSide,
  projects,
  orders,
  properties,
}: {
  side: SideState;
  setSide: (next: SideState) => void;
  projects: SourceOption[];
  orders: SourceOption[];
  properties: SourceOption[];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">תחום עסקי *</div>
        <DomainSelect
          value={side.businessDomain}
          onChange={(value) =>
            setSide({
              ...createSideState(),
              businessDomain: value as ExpenseBusinessDomain | "",
            })
          }
        />
      </div>

      {side.businessDomain === "logistics_projects" ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">פרויקט *</div>
          <ProjectPicker
            projects={projects}
            value={side.projectId}
            onChange={(id) => setSide({ ...side, projectId: id })}
            emptyLabel="ללא פרויקט"
          />
        </div>
      ) : null}

      {side.businessDomain === "sales" ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">הזמנה *</div>
          <NativeSelect
            value={side.orderId}
            onChange={(e) => setSide({ ...side, orderId: e.target.value })}
          >
            <option value="">בחר הזמנה</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {side.businessDomain === "property_management" ? (
        <div className="space-y-1">
          <div className="text-sm font-medium">נכס *</div>
          <NativeSelect
            value={side.propertyId}
            onChange={(e) => setSide({ ...side, propertyId: e.target.value })}
          >
            <option value="">בחר נכס</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}

export function TransferDialog({
  open,
  onOpenChange,
  projects = [],
  orders = [],
  properties = [],
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [expenseSide, setExpenseSide] = useState<SideState>(createSideState);
  const [incomeSide, setIncomeSide] = useState<SideState>(createSideState);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [splitAmounts, setSplitAmounts] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("credit_card");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setExpenseSide(createSideState());
    setIncomeSide(createSideState());
    setCategory("");
    setAmount("");
    setSplitAmounts(false);
    setExpenseAmount("");
    setIncomeAmount("");
    setDate(todayIso());
    setPaymentMethod("credit_card");
    setDueDate("");
    setDescription("");
    setNotes("");
    setErrorMessage("");
  }, [open]);

  const fail = (message: string) => {
    setErrorMessage(message);
    toast.error(message);
  };

  const handleSubmit = async () => {
    setErrorMessage("");

    if (!expenseSide.businessDomain) return fail("יש לבחור תחום לצד ההוצאה.");
    if (!incomeSide.businessDomain) return fail("יש לבחור תחום לצד ההכנסה.");
    if (sideNeedsSource(expenseSide.businessDomain) && !sideSourceId(expenseSide)) {
      return fail("יש לבחור מקור לצד ההוצאה.");
    }
    if (sideNeedsSource(incomeSide.businessDomain) && !sideSourceId(incomeSide)) {
      return fail("יש לבחור מקור לצד ההכנסה.");
    }
    if (!category.trim()) return fail("יש להזין קטגוריה לצד ההוצאה.");
    if (!date) return fail("יש לבחור תאריך.");
    if (paymentMethod === "check" && !dueDate) return fail("יש להזין תאריך פירעון לצ'ק.");

    // Resolve each side's amount: shared full price unless split into separate amounts.
    const expenseAmountNumber = splitAmounts ? Number(expenseAmount) : Number(amount);
    const incomeAmountNumber = splitAmounts ? Number(incomeAmount) : Number(amount);
    if (!Number.isFinite(expenseAmountNumber) || expenseAmountNumber <= 0) {
      return fail("יש להזין סכום תקין לצד ההוצאה.");
    }
    if (!Number.isFinite(incomeAmountNumber) || incomeAmountNumber <= 0) {
      return fail("יש להזין סכום תקין לצד ההכנסה.");
    }

    setSaving(true);
    try {
      // 1) Expense side — money leaving (e.g. the home paid for it), marked as paid.
      const expenseRes = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_domain: expenseSide.businessDomain,
          project_id: expenseSide.businessDomain === "logistics_projects" ? expenseSide.projectId : null,
          order_id: expenseSide.businessDomain === "sales" ? expenseSide.orderId : null,
          property_id: expenseSide.businessDomain === "property_management" ? expenseSide.propertyId : null,
          amount: expenseAmountNumber,
          category: category.trim(),
          expense_date: date,
          description: description.trim() || null,
          notes: notes.trim() || null,
          included_in_base_price: false,
          billed_to_customer: false,
          payment_status: "paid",
          payment_method: paymentMethod,
        }),
      });
      const expenseJson = (await expenseRes.json().catch(() => null)) as { error?: string } | null;
      if (!expenseRes.ok) {
        return fail(toHebrewError(expenseJson?.error, "יצירת צד ההוצאה נכשלה."));
      }

      // 2) Income side — money arriving (e.g. the order got paid).
      const incomeRes = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_domain: incomeSide.businessDomain,
          project_id: incomeSide.businessDomain === "logistics_projects" ? incomeSide.projectId : null,
          order_id: incomeSide.businessDomain === "sales" ? incomeSide.orderId : null,
          property_id: incomeSide.businessDomain === "property_management" ? incomeSide.propertyId : null,
          amount_total: incomeAmountNumber,
          payment_date: date,
          due_date: dueDate.trim() || null,
          requires_split: false,
          payment_method: paymentMethod,
          reference_number: null,
          check_number: null,
          notes: notes.trim() || null,
        }),
      });
      const incomeJson = (await incomeRes.json().catch(() => null)) as { error?: string } | null;
      if (!incomeRes.ok) {
        // The expense already saved — make that explicit so nothing is silently half-done.
        return fail(
          `צד ההוצאה נשמר, אך צד ההכנסה נכשל: ${toHebrewError(incomeJson?.error, "יצירת צד ההכנסה נכשלה.")} — יש להוסיף את ההכנסה ידנית.`
        );
      }

      toast.success("ההעברה נשמרה — נוצרו הוצאה והכנסה.");
      const result = onSaved();
      if (result instanceof Promise) await result;
      onOpenChange(false);
    } catch (error) {
      fail(toHebrewError(error, "שמירת ההעברה נכשלה."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="העברה / שיוך כפול"
      description="רישום אירוע אחד כהוצאה לצד אחד וכהכנסה לצד אחר (למשל תשלום על הזמנה שהוא גם הוצאה לבית)."
      onSubmit={() => void handleSubmit()}
      submitLabel="שמירה"
      busyLabel="שומר..."
      busy={saving}
      error={errorMessage || undefined}
    >
          {/* Expense side */}
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <div className="mb-2 text-sm font-semibold text-destructive">צד הוצאה</div>
            <SideFields
              side={expenseSide}
              setSide={setExpenseSide}
              projects={projects}
              orders={orders}
              properties={properties}
            />
            <div className="mt-3 space-y-1">
              <div className="text-sm font-medium">קטגוריה *</div>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="למשל: רכש, חומרים"
              />
            </div>
          </div>

          {/* Income side */}
          <div className="rounded-xl border border-success/30 bg-success/5 p-3">
            <div className="mb-2 text-sm font-semibold text-success">צד הכנסה</div>
            <SideFields
              side={incomeSide}
              setSide={setIncomeSide}
              projects={projects}
              orders={orders}
              properties={properties}
            />
          </div>

          {/* Shared amount + date */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">סכום מלא *</div>
              <CurrencyInput
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={splitAmounts}
              />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">תאריך</div>
              <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 rounded-xl border px-3 py-3 text-sm">
            <input
              type="checkbox"
              checked={splitAmounts}
              onChange={(e) => {
                const next = e.target.checked;
                setSplitAmounts(next);
                if (next) {
                  // Pre-fill both sides with the full price; user edits whichever differs.
                  setExpenseAmount((cur) => cur || amount);
                  setIncomeAmount((cur) => cur || amount);
                }
              }}
            />
            <span>סכומים שונים לכל צד</span>
          </label>

          {splitAmounts ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-sm font-medium">סכום הוצאה *</div>
                <CurrencyInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">סכום הכנסה *</div>
                <CurrencyInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {/* Payment method + optional due date */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-medium">אמצעי תשלום</div>
              <NativeSelect
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {paymentMethod === "check" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">תאריך פירעון *</div>
                <DateInput value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            ) : null}
          </div>

          {/* Description + notes */}
          <div className="space-y-1">
            <div className="text-sm font-medium">תיאור</div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">הערות</div>
            <div className="relative">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="pe-11" />
              <DictateButton
                onTranscript={(text) => setNotes((prev) => appendDictatedText(prev, text))}
                className="absolute bottom-1 end-1 h-8 w-8"
              />
            </div>
          </div>

    </FormDialog>
  );
}
