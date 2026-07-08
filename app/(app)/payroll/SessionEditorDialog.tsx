"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import SalaryProtected from "@/components/payroll/SalaryProtected";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import {
  WORK_SESSION_BUSINESS_DOMAINS,
  isExpenseBusinessDomain,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import AccountSelect from "@/components/financial/AccountSelect";
import type { Account } from "@/lib/accounts";
import {
  normalizePayrollWorkerType,
  payrollWorkerTypeAllowsSessions,
  shouldShowSessionHours,
  shouldShowSessionPrice,
} from "@/lib/payroll-worker-type";
import {
  getCurrentSalaryAgreement,
  calculateSessionLaborCost,
  formatCurrency,
  formatDate,
  formatMinutes,
  minutesBetween,
  toNumber,
  type SalaryAgreementRow,
} from "@/lib/payroll";
import type {
  SalaryCenterProjectOption,
  SalaryCenterUserRow,
  SessionPublicRow,
} from "@/lib/payroll-center";
import { toHebrewError } from "@/lib/error-messages";
import type { SessionFormState, SplitPartDraft } from "./SalaryCenter.types";
import { Field, selectClassName, toDateTimeLocalValue } from "./SalaryCenterUi";

function createSessionSplitPart(
  domain: ExpenseBusinessDomain,
  overrides?: Partial<Omit<SplitPartDraft, "id" | "domain">>
): SplitPartDraft {
  return {
    id: `split-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endTime: overrides?.endTime ?? "",
    domain,
    projectId: overrides?.projectId ?? "",
    propertyId: overrides?.propertyId ?? "",
    amount: overrides?.amount ?? "",
    billToCustomer: overrides?.billToCustomer ?? false,
    billAmount: overrides?.billAmount ?? "",
    billAmountDirty: overrides?.billAmountDirty ?? false,
  };
}

// Boundary in the middle of two datetime-local values (used to seed default split points).
function midpointDateTimeLocal(startLocal: string, endLocal: string): string {
  const startMs = new Date(startLocal).getTime();
  const endMs = new Date(endLocal).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "";
  return toDateTimeLocalValue(new Date(startMs + Math.floor((endMs - startMs) / 2)));
}

// "YYYY-MM-DDTHH:MM" → "HH:MM" for read-only display of a split boundary.
function splitTimeLabel(local: string): string {
  return local && local.length >= 16 ? local.slice(11, 16) : "—";
}

type SessionEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialForm: SessionFormState;
  workers: SalaryCenterUserRow[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
  agreementsByUserId: Map<string, SalaryAgreementRow[]>;
  salaryUnlocked: boolean;
  hasPasswordConfigured: boolean;
  canViewSalary: boolean;
  onUnlockSuccess: () => void;
  onSaved: (message: string) => void | Promise<void>;
  editExtras?: ReactNode;
};

export default function SessionEditorDialog({
  open,
  onOpenChange,
  mode,
  initialForm,
  workers,
  projectOptions,
  propertyOptions,
  agreementsByUserId,
  salaryUnlocked,
  hasPasswordConfigured,
  canViewSalary,
  onUnlockSuccess,
  onSaved,
  editExtras,
}: SessionEditorDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [sessionForm, setSessionForm] = useState<SessionFormState>(initialForm);
  const [sessionMode, setSessionMode] = useState<"create" | "edit">(mode);
  const [sessionSplitParts, setSessionSplitParts] = useState<SplitPartDraft[]>([]);
  const [sessionSplitEnabled, setSessionSplitEnabled] = useState(false);
  const [sessionError, setSessionError] = useState("");
  // True once the user hand-edits the single (non-split) customer charge, which stops it from
  // auto-tracking the shift's labor cost.
  const [billAmountDirty, setBillAmountDirty] = useState(false);
  // Which bank/cash account a "mark paid" payment leaves from (see accounts layer).
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);

  const usersById = useMemo(() => new Map(workers.map((user) => [user.id, user])), [workers]);

  // Reset the internal form from the parent-supplied initialForm whenever the dialog opens.
  useEffect(() => {
    if (!open) {
      // Scrub the "touched" flag on close so a reopened dialog (e.g. adding two shifts in a row)
      // can never inherit it and freeze a stale customer amount instead of re-syncing to the cost.
      setBillAmountDirty(false);
      return;
    }
    setSessionMode(mode);
    setSessionError("");
    setSessionSplitParts([]);
    setSessionSplitEnabled(false);
    setPaymentAccountId("");
    // Preserve an already-saved customer charge (edit mode) instead of overwriting it with the cost;
    // a fresh shift starts un-touched so the amount tracks the cost until the user edits it.
    setBillAmountDirty(Boolean(initialForm.is_billable_to_customer && initialForm.bill_to_customer_amount.trim()));
    setSessionForm(initialForm);
    // initialForm/mode are the "open request" snapshot — re-run only on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function postJson(path: string, payload: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("אין חיבור לשרת. נסו שוב.");
    }
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(toHebrewError(json.error ?? response.statusText));
    }
    return json;
  }

  function runAction(action: () => Promise<void>, options?: { onError?: (message: string) => void }) {
    startTransition(async () => {
      try {
        await action();
      } catch (actionError: unknown) {
        const message = toHebrewError(actionError);
        if (options?.onError) {
          options.onError(message);
        } else {
          setSessionError(message);
        }
      }
    });
  }

  function saveSession() {
    setSessionError("");
    // Contractor (session_only) sessions have no hourly rule to derive cost from, so a price is
    // mandatory. When splitting, each part carries its own amount, so the single price isn't shown.
    const selectedWorkerType = normalizePayrollWorkerType(
      usersById.get(sessionForm.user_id)?.payroll_worker_type ?? null,
      usersById.get(sessionForm.user_id)?.pay_tracking_mode ?? "session"
    );
    if (selectedWorkerType === "session_only" && !sessionSplitEnabled && !sessionForm.labor_cost.trim()) {
      setSessionError("יש להזין מחיר לעובד קבלן.");
      return;
    }
    // When marking a payment, record which account it came from (if any accounts are configured).
    const willMarkPaid = sessionForm.mark_paid_now && selectedWorkerType === "session_only";
    if (willMarkPaid && accountsList.length > 0 && !paymentAccountId) {
      setSessionError("יש לבחור חשבון לתשלום.");
      return;
    }
    runAction(async () => {
      const path =
        sessionMode === "create" ? "/api/payroll/sessions/create" : "/api/payroll/sessions/update";
      const clockInIso = new Date(sessionForm.clock_in).toISOString();
      const clockOutIso = sessionForm.clock_out ? new Date(sessionForm.clock_out).toISOString() : null;
      const laborCostInput = sessionForm.labor_cost.trim();
      const originalLaborCost = sessionForm.original_labor_cost.trim();
      const sessionTimingChanged =
        sessionMode === "edit" &&
        (sessionForm.user_id !== sessionForm.original_user_id ||
          clockInIso !== sessionForm.original_clock_in ||
          (clockOutIso ?? "") !== sessionForm.original_clock_out);
      const shouldRecalculateLaborCost =
        clockOutIso !== null &&
        (
          (sessionMode === "create" && !laborCostInput) ||
          (sessionMode === "edit" &&
            ((!laborCostInput && !originalLaborCost) ||
              !laborCostInput ||
              (sessionTimingChanged && laborCostInput === originalLaborCost)))
        );

      const response = await postJson(path, {
        session_id: sessionForm.session_id || undefined,
        user_id: sessionForm.user_id,
        business_domain: sessionForm.business_domain,
        project_id: sessionForm.project_id || null,
        property_id: sessionForm.property_id || null,
        notes: sessionForm.notes || null,
        clock_in: clockInIso,
        clock_out: clockOutIso,
        labor_cost: shouldRecalculateLaborCost ? null : laborCostInput || null,
        recalculate_labor_cost: shouldRecalculateLaborCost,
        is_billable_to_customer: sessionForm.is_billable_to_customer,
        bill_to_customer_amount: sessionForm.is_billable_to_customer ? sessionForm.bill_to_customer_amount : null,
        billing_status: sessionForm.billing_status,
      });

      const savedSession =
        response && typeof response === "object" && "session" in response
          ? (response.session as SessionPublicRow | null | undefined)
          : null;

      // Hand off to edit mode right after a successful create, so if a later step (split/payment)
      // fails and the user retries, the retry UPDATES this same session instead of creating a
      // duplicate shift.
      if (sessionMode === "create" && savedSession?.id) {
        setSessionForm((current) => ({
          ...current,
          session_id: savedSession.id,
          original_user_id: savedSession.user_id ?? current.user_id,
          original_clock_in: savedSession.clock_in ?? clockInIso,
          original_clock_out: savedSession.clock_out ?? (clockOutIso ?? ""),
          original_labor_cost: savedSession.labor_cost != null ? String(savedSession.labor_cost) : "",
        }));
        setSessionMode("edit");
      }

      const markPaid = Boolean(
        sessionForm.mark_paid_now &&
          savedSession?.id &&
          savedSession.user_id &&
          normalizePayrollWorkerType(
            usersById.get(savedSession.user_id)?.payroll_worker_type ?? null,
            usersById.get(savedSession.user_id)?.pay_tracking_mode ?? "session"
          ) === "session_only"
      );

      // If splitting, slice the saved session into parts. For a contractor (money) split with
      // "mark paid", the payment is recorded in the SAME request and rolled back together with the
      // split if it fails — so you can never end up split-but-unpaid.
      const didSplit = sessionSplitEnabled && sessionSplitParts.length >= 2 && Boolean(savedSession?.id);
      if (didSplit && savedSession?.id) {
        const minutesByPart = isMoneySplit ? [] : computeSessionSplitMinutes();
        await postJson("/api/payroll/sessions/split", {
          session_id: savedSession.id,
          parts: sessionSplitParts.map((part, index) => ({
            amount: isMoneySplit ? Number(part.amount) : undefined,
            minutes: isMoneySplit ? undefined : minutesByPart[index],
            business_domain: part.domain,
            project_id: part.projectId || null,
            property_id: part.propertyId || null,
            is_billable_to_customer: part.billToCustomer,
            bill_to_customer_amount: part.billToCustomer ? Number(part.billAmount) : null,
          })),
          payment:
            markPaid && isMoneySplit
              ? {
                  mark_paid: true,
                  amount: sessionForm.paid_amount_now.trim() ? Number(sessionForm.paid_amount_now) : null,
                  account_id: paymentAccountId || null,
                }
              : undefined,
        });
      }

      // Non-split mark-paid: a single payment allocated to the one saved session.
      if (markPaid && !didSplit && savedSession?.id && savedSession.user_id) {
        const paymentDateSource = savedSession.clock_out || savedSession.clock_in || new Date().toISOString();
        const derivedEarnedAmount =
          typeof savedSession?.labor_cost === "number" || typeof savedSession?.labor_cost === "string"
            ? toNumber(savedSession.labor_cost)
            : laborCostInput
              ? Number(laborCostInput)
              : null;
        const requestedPaidAmount = sessionForm.paid_amount_now.trim()
          ? Number(sessionForm.paid_amount_now)
          : derivedEarnedAmount;
        if (!Number.isFinite(requestedPaidAmount) || requestedPaidAmount === null || requestedPaidAmount <= 0) {
          throw new Error("יש להזין סכום ששולם עבור המשמרת.");
        }
        await postJson("/api/payroll/worker-payments", {
          user_id: savedSession.user_id,
          payment_date: paymentDateSource.slice(0, 10),
          amount: requestedPaidAmount,
          payment_method: null,
          account_id: paymentAccountId || null,
          reference_number: null,
          notes: `תשלום שסומן מתוך משמרת ${formatDate(paymentDateSource)}`,
          allocations: [{ source_type: "session", source_id: savedSession.id, amount: requestedPaidAmount }],
        });
      }

      onOpenChange(false);
      setSessionSplitParts([]);
      setSessionSplitEnabled(false);
      const paidSuffix = sessionForm.mark_paid_now ? " והתשלום נרשם" : "";
      const message =
        didSplit
          ? sessionMode === "create"
            ? `המשמרת נוספה ופוצלה לחלקים${paidSuffix}.`
            : `המשמרת עודכנה ופוצלה לחלקים${paidSuffix}.`
          : sessionMode === "create"
            ? `המשמרת נוספה${paidSuffix}.`
            : `המשמרת עודכנה${paidSuffix}.`;
      await onSaved(message);
    }, { onError: (message) => setSessionError(message) });
  }

  function updateSessionSplitPart(partId: string, changes: Partial<Omit<SplitPartDraft, "id">>) {
    setSessionSplitParts((current) =>
      current.map((part) => {
        if (part.id !== partId) return part;
        const next = { ...part, ...changes };
        if (changes.domain && changes.domain !== "logistics_projects") next.projectId = "";
        if (changes.domain && changes.domain !== "property_management") next.propertyId = "";
        return next;
      })
    );
  }

  function updateSessionSplitEndTime(partId: string, value: string) {
    setSessionSplitParts((current) =>
      current.map((part) => (part.id === partId ? { ...part, endTime: value } : part))
    );
  }

  // Session/contract workers (session_only) don't track hours, so their split divides the
  // MONEY (an amount per part) instead of the time. Computed from the form's selected worker
  // so the split helpers below can branch on it.
  const isMoneySplit =
    normalizePayrollWorkerType(
      usersById.get(sessionForm.user_id)?.payroll_worker_type ?? null,
      usersById.get(sessionForm.user_id)?.pay_tracking_mode ?? "session"
    ) === "session_only";

  // Build the default 2-part split from the current form. Time split divides at the midpoint;
  // money split seeds the first part with the price/billing already entered on the form.
  function buildInitialSplitParts(): SplitPartDraft[] {
    const domain = isExpenseBusinessDomain(sessionForm.business_domain)
      ? sessionForm.business_domain
      : "general_business";
    const sharedLink = { projectId: sessionForm.project_id ?? "", propertyId: sessionForm.property_id ?? "" };
    if (isMoneySplit) {
      return [
        createSessionSplitPart(domain, {
          ...sharedLink,
          amount: sessionForm.labor_cost ?? "",
          billToCustomer: sessionForm.is_billable_to_customer,
          // Leave the amount un-touched so it re-tracks this part's own cost (prorated by hours),
          // instead of freezing on whatever the single regular field happened to hold.
          billAmount: "",
        }),
        createSessionSplitPart(domain, sharedLink),
      ];
    }
    return [
      createSessionSplitPart(domain, {
        ...sharedLink,
        endTime: midpointDateTimeLocal(sessionForm.clock_in, sessionForm.clock_out),
        billToCustomer: sessionForm.is_billable_to_customer,
        // Leave the amount un-touched so it re-tracks this part's own cost (prorated by hours),
        // instead of freezing on whatever the single regular field happened to hold.
        billAmount: "",
      }),
      createSessionSplitPart(domain, sharedLink),
    ];
  }

  function toggleSessionSplit(enabled: boolean) {
    setSessionSplitEnabled(enabled);
    setSessionSplitParts(enabled ? buildInitialSplitParts() : []);
  }

  // Insert a new boundary part just before the trailing remainder part, defaulting its
  // end-time to the midpoint of whatever time is left.
  function addSessionSplitPart() {
    setSessionSplitParts((current) => {
      if (current.length >= 5) return current;
      const domain = isExpenseBusinessDomain(sessionForm.business_domain)
        ? sessionForm.business_domain
        : "general_business";
      // Money split parts have no time order — just append another amount line.
      if (isMoneySplit) {
        return [...current, createSessionSplitPart(domain)];
      }
      const prevBoundary = current.length >= 2 ? current[current.length - 2].endTime : sessionForm.clock_in;
      const newPart = createSessionSplitPart(domain, {
        endTime: midpointDateTimeLocal(prevBoundary || sessionForm.clock_in, sessionForm.clock_out),
      });
      const next = [...current];
      next.splice(next.length - 1, 0, newPart);
      return next;
    });
  }

  function removeSessionSplitPart(partId: string) {
    setSessionSplitParts((current) => (current.length <= 2 ? current : current.filter((part) => part.id !== partId)));
  }

  // Minutes per part derived from the form span + each part's end-time boundary.
  // Boundaries: [shift start, part0.endTime, part1.endTime, …, shift end].
  function computeSessionSplitMinutes(): number[] {
    const boundaries = [
      sessionForm.clock_in,
      ...sessionSplitParts.slice(0, -1).map((part) => part.endTime),
      sessionForm.clock_out,
    ];
    return sessionSplitParts.map((_, index) => minutesBetween(boundaries[index], boundaries[index + 1]));
  }

  function renderCompactSessionLinkField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: SalaryCenterProjectOption[]
  ) {
    return (
      <label className="space-y-1 text-right">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <select
          className="h-9 w-44 rounded-md border border-input bg-background px-3 text-right text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{"בחירה"}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const sessionDialogWorker = useMemo(
    () => (sessionForm.user_id ? usersById.get(sessionForm.user_id) ?? null : null),
    [sessionForm.user_id, usersById]
  );
  const sessionDialogWorkerType = useMemo(
    () =>
      sessionDialogWorker
        ? normalizePayrollWorkerType(sessionDialogWorker.payroll_worker_type, sessionDialogWorker.pay_tracking_mode)
        : null,
    [sessionDialogWorker]
  );
  const sessionDialogWorkedMinutes = useMemo(() => {
    const start = new Date(sessionForm.clock_in).getTime();
    const end = new Date(sessionForm.clock_out).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.round((end - start) / 60000);
  }, [sessionForm.clock_in, sessionForm.clock_out]);
  const sessionDialogDurationHours = useMemo(() => {
    if (sessionDialogWorkedMinutes <= 0) return "";
    const hours = sessionDialogWorkedMinutes / 60;
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
  }, [sessionDialogWorkedMinutes]);
  const sessionDialogAgreement = useMemo(() => {
    if (!sessionForm.user_id || !sessionForm.clock_in) return null;
    return getCurrentSalaryAgreement(
      agreementsByUserId.get(sessionForm.user_id) ?? [],
      new Date(sessionForm.clock_in)
    );
  }, [agreementsByUserId, sessionForm.clock_in, sessionForm.user_id]);
  const sessionDialogSuggestedAmount = useMemo(() => {
    if (sessionForm.labor_cost.trim()) {
      const parsed = Number(sessionForm.labor_cost);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (sessionDialogWorkedMinutes <= 0) return null;
    return calculateSessionLaborCost(sessionDialogAgreement, sessionDialogWorkedMinutes);
  }, [sessionDialogAgreement, sessionDialogWorkedMinutes, sessionForm.labor_cost]);
  // Each part's start/end clock boundaries + minutes, derived from the form span.
  // Part 0 starts at the shift's start; each later part starts where the previous one ended;
  // the last part always runs to the shift's end.
  const sessionDialogSplitPreview = useMemo(() => {
    if (!sessionForm.clock_in || !sessionForm.clock_out) return [];
    return sessionSplitParts.map((part, index) => {
      const isLast = index === sessionSplitParts.length - 1;
      const startLocal = index === 0 ? sessionForm.clock_in : sessionSplitParts[index - 1].endTime;
      const endLocal = isLast ? sessionForm.clock_out : part.endTime;
      const minutes = startLocal && endLocal ? minutesBetween(startLocal, endLocal) : 0;
      return { ...part, startLocal, endLocal, minutes, isLast };
    });
  }, [sessionForm.clock_in, sessionForm.clock_out, sessionSplitParts]);
  const sessionDialogSplitError = useMemo(() => {
    if (!sessionSplitEnabled) return "";
    if (isMoneySplit) {
      if (sessionSplitParts.length < 2) return "צריך לפחות שני חלקים.";
      if (sessionSplitParts.length > 5) return "אפשר לפצל לכל היותר לחמישה חלקים.";
      for (let index = 0; index < sessionSplitParts.length; index += 1) {
        const part = sessionSplitParts[index];
        const amount = Number(part.amount);
        if (!part.amount.trim() || !Number.isFinite(amount) || amount <= 0) {
          return `יש להזין סכום תקין לחלק ${index + 1}.`;
        }
        if (part.domain === "logistics_projects" && !part.projectId) return `יש לבחור פרויקט בחלק ${index + 1}.`;
        if (part.domain === "property_management" && !part.propertyId) return `יש לבחור נכס בחלק ${index + 1}.`;
        if (part.billToCustomer) {
          const billAmount = Number(part.billAmount);
          if (!part.billAmount.trim() || !Number.isFinite(billAmount) || billAmount <= 0) {
            return `יש להזין סכום חיוב ללקוח בחלק ${index + 1}.`;
          }
        }
      }
      return "";
    }
    const shiftStartMs = new Date(sessionForm.clock_in).getTime();
    const shiftEndMs = new Date(sessionForm.clock_out).getTime();
    if (!sessionForm.clock_out || !Number.isFinite(shiftEndMs) || shiftEndMs <= shiftStartMs) {
      return "צריך משמרת עם שעת התחלה וסיום כדי לפצל.";
    }
    if (sessionSplitParts.length < 2) return "צריך לפחות שני חלקים.";
    if (sessionSplitParts.length > 5) return "אפשר לפצל לכל היותר לחמישה חלקים.";
    let prevMs = shiftStartMs;
    for (let index = 0; index < sessionSplitParts.length; index += 1) {
      const part = sessionSplitParts[index];
      const isLast = index === sessionSplitParts.length - 1;
      if (!isLast) {
        const boundaryMs = new Date(part.endTime).getTime();
        if (!part.endTime || !Number.isFinite(boundaryMs)) return `יש להזין שעת יציאה לחלק ${index + 1}.`;
        if (boundaryMs <= prevMs) return `שעת היציאה של חלק ${index + 1} חייבת להיות אחרי תחילת החלק.`;
        if (boundaryMs >= shiftEndMs) return `שעת היציאה של חלק ${index + 1} חייבת להיות לפני סוף המשמרת.`;
        prevMs = boundaryMs;
      } else if (shiftEndMs - prevMs <= 0) {
        return "לא נשאר זמן לחלק האחרון.";
      }
      if (part.domain === "logistics_projects" && !part.projectId) return `יש לבחור פרויקט בחלק ${index + 1}.`;
      if (part.domain === "property_management" && !part.propertyId) return `יש לבחור נכס בחלק ${index + 1}.`;
      if (part.billToCustomer) {
        const billAmount = Number(part.billAmount);
        if (!part.billAmount.trim() || !Number.isFinite(billAmount) || billAmount <= 0) {
          return `יש להזין סכום חיוב ללקוח בחלק ${index + 1}.`;
        }
      }
    }
    return "";
  }, [isMoneySplit, sessionForm.clock_in, sessionForm.clock_out, sessionSplitEnabled, sessionSplitParts]);

  useEffect(() => {
    if (!sessionForm.mark_paid_now || sessionDialogSuggestedAmount === null) return;
    setSessionForm((current) => {
      if (current.paid_amount_now.trim()) return current;
      return {
        ...current,
        paid_amount_now: String(Number(sessionDialogSuggestedAmount.toFixed(2))),
      };
    });
  }, [sessionDialogSuggestedAmount, sessionForm.mark_paid_now]);

  // Keep the single (non-split) customer charge tracking the shift's labor cost — recomputing when
  // hours/price change — until the user hand-edits it (billAmountDirty), after which their number
  // stands. This is what makes it "sync" instead of freezing on the first value.
  useEffect(() => {
    if (sessionSplitEnabled || !sessionForm.is_billable_to_customer || billAmountDirty || sessionDialogSuggestedAmount === null) {
      return;
    }
    const synced = String(Number(sessionDialogSuggestedAmount.toFixed(2)));
    setSessionForm((current) =>
      current.bill_to_customer_amount === synced ? current : { ...current, bill_to_customer_amount: synced }
    );
  }, [sessionDialogSuggestedAmount, sessionForm.is_billable_to_customer, sessionSplitEnabled, billAmountDirty]);

  // Same idea per split part: money split → the part's own amount; time split → its prorated share
  // of the shift's labor cost. Each part re-tracks until the user hand-edits it (part.billAmountDirty).
  useEffect(() => {
    if (!sessionSplitEnabled) return;
    setSessionSplitParts((current) => {
      if (current.length === 0) return current;
      const minutes = isMoneySplit
        ? []
        : (() => {
            const boundaries = [
              sessionForm.clock_in,
              ...current.slice(0, -1).map((part) => part.endTime),
              sessionForm.clock_out,
            ];
            return current.map((_, index) => minutesBetween(boundaries[index], boundaries[index + 1]));
          })();
      const totalMinutes = isMoneySplit ? 0 : minutes.reduce((sum, m) => sum + m, 0);
      let changed = false;
      const next = current.map((part, index) => {
        if (!part.billToCustomer || part.billAmountDirty) return part;
        let synced = "";
        if (isMoneySplit) {
          synced = part.amount.trim() && Number(part.amount) > 0 ? part.amount : "";
        } else if (sessionDialogSuggestedAmount !== null && totalMinutes > 0 && minutes[index] > 0) {
          synced = String(Number(((sessionDialogSuggestedAmount * minutes[index]) / totalMinutes).toFixed(2)));
        }
        if (!synced || synced === part.billAmount) return part;
        changed = true;
        return { ...part, billAmount: synced };
      });
      return changed ? next : current;
    });
  }, [
    isMoneySplit,
    sessionDialogSuggestedAmount,
    sessionForm.clock_in,
    sessionForm.clock_out,
    sessionSplitEnabled,
    sessionSplitParts,
  ]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        if (!next) {
          setSessionSplitParts([]);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        dir="rtl"
        className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto overflow-x-hidden text-right"
      >
        <DialogHeader className="text-right">
          <DialogTitle>{sessionMode === "create" ? "הוספת משמרת" : "עריכת משמרת"}</DialogTitle>
          <DialogDescription>
            {"מנהלים ומשרד יכולים ליצור ולעדכן משמרות לשני סוגי העובדים, כל עוד התקופה לא נעולה."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label="עובד">
            <select
              value={sessionForm.user_id}
              onChange={(event) => {
                const nextUserId = event.target.value;
                // A new worker is a new cost context — clear the worker-specific price and customer
                // charge so nothing stale from the previous worker lingers. They re-sync once the new
                // price/hours are entered (hourly workers recompute from their own rate immediately).
                setBillAmountDirty(false);
                setSessionSplitParts((parts) =>
                  parts.map((part) => ({ ...part, amount: "", billAmount: "", billAmountDirty: false }))
                );
                setSessionForm((current) => ({
                  ...current,
                  user_id: nextUserId,
                  labor_cost: "",
                  bill_to_customer_amount: "",
                }));
              }}
              className={selectClassName}
            >
              <option value="">{"בחירה"}</option>
              {workers
                .filter(
                  (user) =>
                    (user.role === "worker" || user.role === "worker_no_access") &&
                    payrollWorkerTypeAllowsSessions(
                      normalizePayrollWorkerType(user.payroll_worker_type, user.pay_tracking_mode)
                    )
                )
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name ?? user.email ?? "עובד"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="תחום">
            <DomainSelect
              domains={WORK_SESSION_BUSINESS_DOMAINS}
              value={sessionForm.business_domain}
              onChange={(value) =>
                setSessionForm((current) => ({
                  ...current,
                  business_domain: value,
                  project_id: value === "logistics_projects" ? current.project_id : "",
                  property_id: value === "property_management" ? current.property_id : "",
                }))
              }
            />
          </Field>
          {sessionForm.business_domain === "logistics_projects" ? (
            <Field label="פרויקט">
              <select
                value={sessionForm.project_id}
                onChange={(event) => setSessionForm((current) => ({ ...current, project_id: event.target.value }))}
                className={selectClassName}
              >
                <option value="">{"בחירה"}</option>
                {projectOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {sessionForm.business_domain === "property_management" ? (
            <Field label="נכס">
              <select
                value={sessionForm.property_id}
                onChange={(event) => setSessionForm((current) => ({ ...current, property_id: event.target.value }))}
                className={selectClassName}
              >
                <option value="">{"בחירה"}</option>
                {propertyOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {shouldShowSessionHours(sessionDialogWorkerType) ? (
            <div className="md:col-span-2 grid gap-3 md:grid-cols-3">
              <Field label="כניסה">
                <DateTimeInput
                  value={sessionForm.clock_in}
                  onChange={(event) => setSessionForm((current) => ({ ...current, clock_in: event.target.value }))}
                />
              </Field>
              <Field label="סה״כ שעות">
                <Input
                  inputMode="decimal"
                  value={sessionDialogDurationHours}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (!nextValue.trim()) {
                      setSessionForm((current) => ({ ...current, clock_out: "" }));
                      return;
                    }
                    const parsedHours = Number(nextValue);
                    const start = new Date(sessionForm.clock_in).getTime();
                    if (!Number.isFinite(parsedHours) || parsedHours <= 0 || !Number.isFinite(start)) return;
                    const nextClockOut = new Date(start + parsedHours * 60 * 60 * 1000);
                    if (Number.isNaN(nextClockOut.getTime())) return;
                    setSessionForm((current) => ({ ...current, clock_out: toDateTimeLocalValue(nextClockOut) }));
                  }}
                  placeholder="למשל 8"
                />
              </Field>
              <Field label="יציאה">
                <DateTimeInput
                  value={sessionForm.clock_out}
                  onChange={(event) => setSessionForm((current) => ({ ...current, clock_out: event.target.value }))}
                />
              </Field>
            </div>
          ) : (
            <Field label="תאריך">
              <DateInput
                value={(() => {
                  const m = /^(\d{4}-\d{2}-\d{2})/.exec(sessionForm.clock_in);
                  return m ? m[1] : new Date().toISOString().slice(0, 10);
                })()}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!next) return;
                  setSessionForm((current) => ({
                    ...current,
                    clock_in: `${next}T09:00`,
                    clock_out: `${next}T10:00`,
                  }));
                }}
              />
            </Field>
          )}
          {/* When money-split is on, each part defines its own price + customer billing,
              so the single session-level price / bill fields are hidden. */}
          {sessionSplitEnabled && isMoneySplit ? null : shouldShowSessionPrice(sessionDialogWorkerType) ? (
            <SalaryProtected
              unlocked={salaryUnlocked}
              hasPasswordConfigured={hasPasswordConfigured}
              canUnlock={canViewSalary}
              onUnlockSuccess={onUnlockSuccess}
            >
              <Field label={sessionDialogWorkerType === "session_only" ? "מחיר (חובה)" : "מחיר"}>
                <CurrencyInput
                  inputMode="decimal"
                  value={sessionForm.labor_cost}
                  onChange={(event) =>
                    setSessionForm((current) => ({ ...current, labor_cost: event.target.value }))
                  }
                  placeholder={sessionDialogWorkerType === "session_only" ? "חובה" : "אופציונלי"}
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  {sessionDialogSuggestedAmount !== null
                    ? `סה״כ לתשלום עבור המשמרת: ${formatCurrency(sessionDialogSuggestedAmount)}`
                    : "הסכום שמגיע לעובד יוצג כאן אחרי הזנת שעות תקינות או עלות עבודה."}
                </div>
              </Field>
            </SalaryProtected>
          ) : (
            <Field label="עלות חישוב אוטומטי">
              <div className="text-xs text-muted-foreground">
                {sessionDialogSuggestedAmount !== null
                  ? `סה״כ לתשלום עבור המשמרת: ${formatCurrency(sessionDialogSuggestedAmount)}`
                  : "העלות תחושב אוטומטית לפי הסכם השכר לאחר שמירה."}
              </div>
            </Field>
          )}
          {sessionSplitEnabled ? null : (
            <>
              <Field label="חיוב לקוח">
                <select
                  value={sessionForm.is_billable_to_customer ? "yes" : "no"}
                  onChange={(event) => {
                    // Toggling billing resets "touched" so the amount re-syncs to the current cost.
                    setBillAmountDirty(false);
                    setSessionForm((current) => ({
                      ...current,
                      is_billable_to_customer: event.target.value === "yes",
                    }));
                  }}
                  className={selectClassName}
                >
                  <option value="no">{"לא"}</option>
                  <option value="yes">{"כן"}</option>
                </select>
              </Field>
              {sessionForm.is_billable_to_customer ? (
                <Field label="סכום לחיוב">
                  <CurrencyInput
                    inputMode="decimal"
                    value={sessionForm.bill_to_customer_amount}
                    onChange={(event) => {
                      setBillAmountDirty(true);
                      setSessionForm((current) => ({ ...current, bill_to_customer_amount: event.target.value }));
                    }}
                  />
                </Field>
              ) : null}
            </>
          )}
          {sessionDialogWorkerType === "session_only" ? (
            <SalaryProtected
              unlocked={salaryUnlocked}
              hasPasswordConfigured={hasPasswordConfigured}
              canUnlock={canViewSalary}
              onUnlockSuccess={onUnlockSuccess}
            >
              <Field label="שולם עכשיו">
                <select
                  value={sessionForm.mark_paid_now ? "yes" : "no"}
                  onChange={(event) =>
                    setSessionForm((current) => ({
                      ...current,
                      mark_paid_now: event.target.value === "yes",
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="no">{"לא"}</option>
                  <option value="yes">{"כן"}</option>
                </select>
              </Field>
              {sessionForm.mark_paid_now ? (
                <>
                  <Field label="כמה שולם">
                    <CurrencyInput
                      inputMode="decimal"
                      value={sessionForm.paid_amount_now}
                      onChange={(event) =>
                        setSessionForm((current) => ({ ...current, paid_amount_now: event.target.value }))
                      }
                      placeholder="אם ריק, יירשם הסכום המלא"
                    />
                    {sessionSplitEnabled ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {`סכום מלא לכל החלקים: ${formatCurrency(
                          sessionSplitParts.reduce((sum, part) => sum + (Number(part.amount) || 0), 0)
                        )}. סכום קטן יותר יחולק בין החלקים לפי הסדר.`}
                      </div>
                    ) : null}
                  </Field>
                  {/* Which bank/cash account this payment leaves from. Required when accounts exist. */}
                  <AccountSelect
                    required
                    value={paymentAccountId}
                    onChange={setPaymentAccountId}
                    onLoaded={setAccountsList}
                  />
                </>
              ) : null}
            </SalaryProtected>
          ) : null}
          <div className="md:col-span-2">
            <Field label="הערות">
              <Textarea
                rows={3}
                value={sessionForm.notes}
                onChange={(event) => setSessionForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </Field>
          </div>
          {sessionError ? (
            <div
              role="alert"
              className="md:col-span-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              {sessionError}
            </div>
          ) : null}
        </div>

        {sessionForm.clock_out && sessionDialogWorkerType && payrollWorkerTypeAllowsSessions(sessionDialogWorkerType) ? (
          <div className="space-y-3 border-t pt-4">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={sessionSplitEnabled}
                onChange={(event) => toggleSessionSplit(event.target.checked)}
              />
              <span className="font-medium">{"פיצול המשמרת לחלקים"}</span>
            </label>
            {sessionSplitEnabled ? (
              isMoneySplit ? (
              /* ── Money-based split (session/contract workers) ──────────── */
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {"חלקו את התשלום בין החלקים — לכל חלק סכום, שיוך, וחיוב לקוח נפרד."}
                  </p>
                  <span className="text-xs font-medium">
                    {`סה״כ: ${formatCurrency(sessionSplitParts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0))}`}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sessionSplitParts.length >= 5}
                    onClick={() => addSessionSplitPart()}
                  >
                    {"הוספת חלק"}
                  </Button>
                </div>
                <div className="space-y-3">
                  {sessionSplitParts.map((part, index) => (
                    <div key={part.id} className="space-y-3 rounded-xl border bg-background/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">{`חלק ${index + 1}`}</div>
                        {sessionSplitParts.length > 2 ? (
                          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeSessionSplitPart(part.id)}>
                            {"הסרה"}
                          </Button>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-end justify-end gap-2">
                        <label className="space-y-1 text-right">
                          <span className="block text-xs text-muted-foreground">{"סכום לעובד"}</span>
                          <CurrencyInput
                            inputMode="decimal"
                            className="h-9 w-32"
                            value={part.amount}
                            onChange={(event) => updateSessionSplitPart(part.id, { amount: event.target.value })}
                          />
                        </label>
                        <label className="space-y-1 text-right">
                          <span className="block text-xs text-muted-foreground">{"תחום"}</span>
                          <DomainSelect
                            domains={WORK_SESSION_BUSINESS_DOMAINS}
                            className="w-40 text-right"
                            value={part.domain}
                            onChange={(value) => updateSessionSplitPart(part.id, { domain: value as ExpenseBusinessDomain })}
                          />
                        </label>
                        {part.domain === "logistics_projects"
                          ? renderCompactSessionLinkField(
                              "פרויקט",
                              part.projectId,
                              (value) => updateSessionSplitPart(part.id, { projectId: value }),
                              projectOptions
                            )
                          : null}
                        {part.domain === "property_management"
                          ? renderCompactSessionLinkField(
                              "נכס",
                              part.propertyId,
                              (value) => updateSessionSplitPart(part.id, { propertyId: value }),
                              propertyOptions
                            )
                          : null}
                      </div>
                      <label className="flex cursor-pointer items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={part.billToCustomer}
                          onChange={(event) =>
                            updateSessionSplitPart(part.id, {
                              billToCustomer: event.target.checked,
                              billAmount: event.target.checked ? part.billAmount : "",
                              billAmountDirty: false,
                            })
                          }
                        />
                        <span>{"חיוב לקוח"}</span>
                      </label>
                      {part.billToCustomer ? (
                        <label className="space-y-1 text-right">
                          <span className="block text-xs text-muted-foreground">{"סכום לחיוב לקוח"}</span>
                          <CurrencyInput
                            inputMode="decimal"
                            className="h-9 w-32"
                            value={part.billAmount}
                            onChange={(event) =>
                              updateSessionSplitPart(part.id, { billAmount: event.target.value, billAmountDirty: true })
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
                {sessionDialogSplitError ? <div className="text-sm text-destructive">{sessionDialogSplitError}</div> : null}
              </>
              ) : (
              /* ── Time-based split (hourly workers) ─────────────────────── */
              <>
                <p className="text-xs text-muted-foreground">
                  {"כל חלק מתחיל בשעת היציאה של החלק הקודם. בחרו שעת יציאה לכל חלק — החלק האחרון נמשך עד סוף המשמרת."}
                </p>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={sessionSplitParts.length >= 5}
                    onClick={() => addSessionSplitPart()}
                  >
                    {"הוספת חלק"}
                  </Button>
                </div>
                <div className="space-y-3">
                  {sessionDialogSplitPreview.map((part, index) => {
                    const isLast = part.isLast;
                    return (
                      <div key={part.id} className="rounded-xl border bg-background/70 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium">{`חלק ${index + 1}`}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span>{formatMinutes(part.minutes)}</span>
                            {!isLast && sessionSplitParts.length > 2 ? (
                              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeSessionSplitPart(part.id)}>
                                {"הסרה"}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-end justify-end gap-2">
                          <label className="space-y-1 text-right">
                            <span className="block text-xs text-muted-foreground">{"כניסה"}</span>
                            <div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                              {splitTimeLabel(part.startLocal)}
                            </div>
                          </label>
                          <label className="space-y-1 text-right">
                            <span className="block text-xs text-muted-foreground">{"יציאה"}</span>
                            {!isLast ? (
                              <Input
                                type="datetime-local"
                                className="h-9 w-44 text-right"
                                min={part.startLocal || undefined}
                                max={sessionForm.clock_out || undefined}
                                value={sessionSplitParts[index]?.endTime ?? ""}
                                onChange={(event) => updateSessionSplitEndTime(part.id, event.target.value)}
                              />
                            ) : (
                              <div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                                {`עד סוף המשמרת (${splitTimeLabel(sessionForm.clock_out)})`}
                              </div>
                            )}
                          </label>
                          <label className="space-y-1 text-right">
                            <span className="block text-xs text-muted-foreground">{"תחום"}</span>
                            <DomainSelect
                              domains={WORK_SESSION_BUSINESS_DOMAINS}
                              className="w-40 text-right"
                              value={sessionSplitParts[index]?.domain ?? "general_business"}
                              onChange={(value) =>
                                updateSessionSplitPart(part.id, { domain: value as ExpenseBusinessDomain })
                              }
                            />
                          </label>
                          {sessionSplitParts[index]?.domain === "logistics_projects"
                            ? renderCompactSessionLinkField(
                                "פרויקט",
                                sessionSplitParts[index]?.projectId ?? "",
                                (value) => updateSessionSplitPart(part.id, { projectId: value }),
                                projectOptions
                              )
                            : null}
                          {sessionSplitParts[index]?.domain === "property_management"
                            ? renderCompactSessionLinkField(
                                "נכס",
                                sessionSplitParts[index]?.propertyId ?? "",
                                (value) => updateSessionSplitPart(part.id, { propertyId: value }),
                                propertyOptions
                              )
                            : null}
                        </div>
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={sessionSplitParts[index]?.billToCustomer ?? false}
                            onChange={(event) =>
                              updateSessionSplitPart(part.id, {
                                billToCustomer: event.target.checked,
                                billAmount: event.target.checked ? sessionSplitParts[index]?.billAmount ?? "" : "",
                                billAmountDirty: false,
                              })
                            }
                          />
                          <span>{"חיוב לקוח"}</span>
                        </label>
                        {sessionSplitParts[index]?.billToCustomer ? (
                          <label className="mt-2 block space-y-1 text-right">
                            <span className="block text-xs text-muted-foreground">{"סכום לחיוב לקוח"}</span>
                            <CurrencyInput
                              inputMode="decimal"
                              className="h-9 w-32"
                              value={sessionSplitParts[index]?.billAmount ?? ""}
                              onChange={(event) =>
                                updateSessionSplitPart(part.id, { billAmount: event.target.value, billAmountDirty: true })
                              }
                            />
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {sessionDialogSplitError ? <div className="text-sm text-destructive">{sessionDialogSplitError}</div> : null}
              </>
              )
            ) : null}
          </div>
        ) : null}

        {sessionMode === "edit" ? editExtras : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {"ביטול"}
          </Button>
          <Button
            onClick={() => saveSession()}
            disabled={isPending || (sessionSplitEnabled && Boolean(sessionDialogSplitError))}
          >
            {"שמירה"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
