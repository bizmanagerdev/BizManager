"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Receipt, Ban, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import AccountSelect from "@/components/financial/AccountSelect";
import { defaultAccountForMethod, type Account } from "@/lib/accounts";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomerPicker, type PickedCustomer } from "@/components/customers/CustomerPicker";
import { toHebrewError } from "@/lib/error-messages";
import { offlineUpload } from "@/lib/offline-upload";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import {
  type Loan,
  type LoanDirection,
  type LoanStatus,
  type LoansSummary,
  loanStatusLabel,
} from "@/lib/loans";
import {
  addRepayment,
  createLoan,
  deleteLoan,
  deleteRepayment,
  setLoanWrittenOff,
  updateLoan,
  type LoanInput,
} from "./actions";

// The business owner — auto-filled on "our" side of every loan.
const BUSINESS_OWNER_NAME = "יעקב הלר";

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-right";

const METHOD_OPTIONS = [
  { value: "", label: "—" },
  { value: "cash", label: "מזומן" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "check", label: "צ׳ק" },
  { value: "bit", label: "ביט" },
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "other", label: "אחר" },
];

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function statusColor(status: LoanStatus) {
  switch (status) {
    case "repaid":
      return "success" as const;
    case "partially_repaid":
      return "info" as const;
    case "written_off":
      return "neutral" as const;
    default:
      return "warning" as const;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

type FormState = {
  direction: LoanDirection;
  // The external party (a customer); which label it carries depends on direction.
  counterpartyCustomer: PickedCustomer | null;
  // Our side of the deal (defaults to the business owner).
  ourSide: string;
  loan_date: string;
  amount: string;
  due_date: string;
  interest_amount: string;
  loan_method: string;
  repayment_method: string;
  business_domain: string;
  account_id: string;
  documentation: string;
  notes: string;
};

function loanToForm(loan: Loan | null): FormState {
  const direction = loan?.direction ?? "taken";
  // taken (we borrowed): counterparty is the lender (מלווה), our side is the borrower (לווה).
  // given (we lent):     counterparty is the borrower (לווה), our side is the lender (מלווה).
  const counterpartyName = loan ? (direction === "taken" ? loan.lender : loan.borrower) : null;
  const ourSideName = loan ? (direction === "taken" ? loan.borrower : loan.lender) : null;
  return {
    direction,
    counterpartyCustomer:
      loan && (loan.counterparty_customer_id || counterpartyName)
        ? { id: loan.counterparty_customer_id ?? "", name: counterpartyName ?? "", phone: null }
        : null,
    ourSide: ourSideName ?? BUSINESS_OWNER_NAME,
    loan_date: loan?.loan_date ?? todayIso(),
    amount: loan ? String(loan.amount) : "",
    due_date: loan?.due_date ?? "",
    interest_amount: loan && loan.interest_amount ? String(loan.interest_amount) : "",
    loan_method: loan?.loan_method ?? "",
    repayment_method: loan?.repayment_method ?? "",
    business_domain: loan?.business_domain ?? "general_business",
    account_id: loan?.account_id ?? "",
    documentation: loan?.documentation ?? "",
    notes: loan?.notes ?? "",
  };
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "debt" | "asset" }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "mt-0.5 text-xl font-semibold tabular-nums " +
          (tone === "debt" ? "text-destructive" : tone === "asset" ? "text-success" : "")
        }
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// ── Loan create / edit dialog ──────────────────────────────────────────────
function LoanFormDialog({
  open,
  loan,
  onOpenChange,
}: {
  open: boolean;
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => loanToForm(loan));
  const [loanAccountsList, setLoanAccountsList] = useState<Account[]>([]);
  const [pending, startTransition] = useTransition();
  // Re-seed the form whenever the dialog opens for a different loan.
  const [seedKey, setSeedKey] = useState<string>("");
  const key = `${open ? "open" : "closed"}:${loan?.id ?? "new"}`;
  if (open && key !== seedKey) {
    setSeedKey(key);
    setForm(loanToForm(loan));
  }

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submit() {
    const taken = form.direction === "taken";
    const counterpartyName = form.counterpartyCustomer?.name.trim() ?? "";
    const ourSide = form.ourSide.trim() || BUSINESS_OWNER_NAME;
    const payload: LoanInput = {
      direction: form.direction,
      // taken: counterparty = lender (מלווה), us = borrower (לווה). given: the reverse.
      lender: taken ? counterpartyName : ourSide,
      borrower: taken ? ourSide : counterpartyName,
      counterparty_customer_id: form.counterpartyCustomer?.id || null,
      loan_date: form.loan_date,
      loan_method: form.loan_method,
      repayment_method: form.repayment_method,
      documentation: form.documentation,
      amount: Number(form.amount) || 0,
      due_date: form.due_date,
      interest_amount: Number(form.interest_amount) || 0,
      business_domain: form.business_domain,
      account_id: form.account_id || null,
      notes: form.notes,
    };
    if (!payload.loan_date) {
      toast.error("חובה לבחור תאריך הלוואה.");
      return;
    }
    if (!(payload.amount > 0)) {
      toast.error("חובה להזין סכום הלוואה.");
      return;
    }
    if (!counterpartyName) {
      toast.error(taken ? "חובה לבחור ממי לקחת את ההלוואה." : "חובה לבחור למי נתת את ההלוואה.");
      return;
    }
    if (loanAccountsList.length > 0 && !payload.account_id) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    startTransition(async () => {
      const res = loan ? await updateLoan(loan.id, payload) : await createLoan(payload);
      if (res.ok) {
        toast.success(loan ? "ההלוואה עודכנה." : "ההלוואה נוספה.");
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const counterpartyHint =
    form.direction === "taken"
      ? `לקחת הלוואה — בחר/י ממי (מלווה). הצד שלנו (${BUSINESS_OWNER_NAME}) הוא הלווה.`
      : `נתת הלוואה — בחר/י למי (לווה). הצד שלנו (${BUSINESS_OWNER_NAME}) הוא המלווה.`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="form2xl">
        <DialogHeader>
          <DialogTitle>{loan ? "עריכת הלוואה" : "הלוואה חדשה"}</DialogTitle>
          <DialogDescription>{counterpartyHint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={form.direction === "taken" ? "default" : "secondary"}
              onClick={() => set("direction", "taken")}
            >
              הלוואה שלקחתי
            </Button>
            <Button
              type="button"
              variant={form.direction === "given" ? "default" : "secondary"}
              onClick={() => set("direction", "given")}
            >
              הלוואה שנתתי
            </Button>
          </div>

          <AdaptiveGrid variant="formTwo">
            <Field label={form.direction === "taken" ? "מלווה — ממי לקחתי (לקוח)" : "לווה — למי נתתי (לקוח)"}>
              <CustomerPicker
                key={seedKey || "loan-customer"}
                value={form.counterpartyCustomer}
                onChange={(customer) => set("counterpartyCustomer", customer)}
              />
            </Field>
            <Field label={form.direction === "taken" ? "לווה (הצד שלנו)" : "מלווה (הצד שלנו)"}>
              <Input value={form.ourSide} onChange={(e) => set("ourSide", e.target.value)} />
            </Field>
            <Field label="תאריך הלוואה">
              <Input type="date" value={form.loan_date} onChange={(e) => set("loan_date", e.target.value)} />
            </Field>
            <Field label="סכום ההלוואה">
              <CurrencyInput
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </Field>
            <Field label="תאריך פרעון">
              <Input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </Field>
            <Field label="ריבית (אם יש)">
              <CurrencyInput
                value={form.interest_amount}
                onChange={(e) => set("interest_amount", e.target.value)}
              />
            </Field>
            <Field label="אופן ההלוואה">
              <select
                className={SELECT_CLASS}
                value={form.loan_method}
                onChange={(e) => {
                  const m = e.target.value;
                  setForm((current) => ({
                    ...current,
                    loan_method: m,
                    account_id: current.account_id || defaultAccountForMethod(loanAccountsList, m),
                  }));
                }}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <AccountSelect
              required
              value={form.account_id}
              onChange={(accountId) => set("account_id", accountId)}
              onLoaded={(list) => {
                setLoanAccountsList(list);
                setForm((current) => ({
                  ...current,
                  account_id: current.account_id || defaultAccountForMethod(list, current.loan_method),
                }));
              }}
            />
            <Field label="אופן ההחזרה">
              <select
                className={SELECT_CLASS}
                value={form.repayment_method}
                onChange={(e) => set("repayment_method", e.target.value)}
              >
                {METHOD_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="תחום">
              <DomainSelect
                value={form.business_domain}
                onChange={(value) => set("business_domain", value)}
              />
            </Field>
            <Field label="תיעוד ההלוואה">
              <Input
                value={form.documentation}
                onChange={(e) => set("documentation", e.target.value)}
              />
            </Field>
          </AdaptiveGrid>

          <Field label="הערות">
            <textarea
              className="min-h-[72px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              ביטול
            </Button>
            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? "שומר..." : loan ? "שמירה" : "הוספה"}
            </Button>
          </div>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}

// ── Repayment log dialog ───────────────────────────────────────────────────
function RepaymentsDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [interest, setInterest] = useState("");
  const [method, setMethod] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountsList, setAccountsList] = useState<Account[]>([]);
  const [notes, setNotes] = useState("");

  function add() {
    if (!loan) return;
    const amt = Number(amount) || 0;
    if (!date) {
      toast.error("חובה לבחור תאריך החזר.");
      return;
    }
    if (!(amt > 0)) {
      toast.error("חובה להזין סכום החזר.");
      return;
    }
    if (accountsList.length > 0 && !accountId) {
      toast.error("יש לבחור חשבון לתנועה.");
      return;
    }
    startTransition(async () => {
      const res = await addRepayment(loan.id, {
        repayment_date: date,
        amount: amt,
        interest_amount: Number(interest) || 0,
        method,
        account_id: accountId || null,
        notes,
      });
      if (res.ok) {
        toast.success("ההחזר נרשם.");
        setAmount("");
        setInterest("");
        setAccountId("");
        setNotes("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function removeRepayment(id: string) {
    if (!loan) return;
    startTransition(async () => {
      const res = await deleteRepayment(id, loan.id);
      if (res.ok) {
        toast.success("ההחזר נמחק.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={Boolean(loan)} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>החזרים</DialogTitle>
          <DialogDescription>
            {loan
              ? `${loan.direction === "taken" ? "החזר שלי למלווה" : "החזר מהלווה"} · יתרה לתשלום: ${formatIls(loan.outstanding)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {loan ? (
          <div className="space-y-4">
            <AdaptiveGrid variant="customerStats">
              <StatBox label="סכום ההלוואה" value={formatIls(loan.amount)} />
              <StatBox label="נפרע (קרן)" value={formatIls(loan.repaidPrincipal)} />
              <StatBox
                label="יתרה"
                value={formatIls(loan.outstanding)}
                tone={loan.direction === "taken" ? "debt" : "asset"}
              />
            </AdaptiveGrid>

            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <div className="text-sm font-semibold">החזר חדש</div>
              <AdaptiveGrid variant="formTwo">
                <Field label="תאריך">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="סכום">
                  <CurrencyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="מתוכו ריבית (אם יש)">
                  <CurrencyInput value={interest} onChange={(e) => setInterest(e.target.value)} />
                </Field>
                <Field label="אופן">
                  <select
                    className={SELECT_CLASS}
                    value={method}
                    onChange={(e) => {
                      const m = e.target.value;
                      setMethod(m);
                      setAccountId((prev) => prev || defaultAccountForMethod(accountsList, m));
                    }}
                  >
                    {METHOD_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
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
              <Input
                placeholder="הערה (לא חובה)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div className="flex justify-end">
                <Button type="button" onClick={add} disabled={pending}>
                  {pending ? "רושם..." : "הוסף החזר"}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">היסטוריית החזרים</div>
              {loan.repayments.length === 0 ? (
                <div className="text-sm text-muted-foreground">עדיין לא נרשמו החזרים.</div>
              ) : (
                loan.repayments
                  .slice()
                  .sort((a, b) => b.repayment_date.localeCompare(a.repayment_date))
                  .map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span dir="ltr" className="font-medium tabular-nums">
                          {formatDate(r.repayment_date)}
                        </span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {formatIls(r.amount)}
                          {r.interest_amount > 0 ? ` (מתוכו ריבית ${formatIls(r.interest_amount)})` : ""}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="destructive-outline"
                        size="icon-sm"
                        onClick={() => removeRepayment(r.id)}
                        disabled={pending}
                        aria-label="מחק החזר"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
              )}
            </div>
          </div>
        ) : null}
      </AdaptiveDialog>
    </Dialog>
  );
}

// ── Documents dialog ───────────────────────────────────────────────────────
type LoanDoc = {
  id: string;
  fileName: string;
  documentType: string | null;
  uploadedAt: string | null;
  url: string | null;
};

function LoanDocumentsDialog({
  loan,
  onOpenChange,
}: {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}) {
  const loanId = loan?.id ?? null;
  const [docs, setDocs] = useState<LoanDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadDocs = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/financial/loans/documents/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loan_id: id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; documents?: LoanDoc[] };
      if (res.ok) setDocs(json.documents ?? []);
      else setError(toHebrewError(json.error, "טעינת המסמכים נכשלה."));
    } catch (e) {
      setError(toHebrewError(e, "שגיאה בטעינת המסמכים."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loanId) {
      void loadDocs(loanId);
    } else {
      setDocs([]);
      setFiles([]);
      setError("");
    }
  }, [loanId, loadDocs]);

  async function upload() {
    if (!loanId || busy) return;
    if (files.length === 0) {
      setError("יש לבחור קובץ להעלאה.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let uploaded = 0;
      // uploaded + queued files are both "done" (removed from the pending list); a
      // queued upload was saved on the device and replays on reconnect
      // (ConnectionToasts announces it).
      let done = 0;
      for (const file of files) {
        const result = await offlineUpload("/api/financial/loans/documents/upload", {
          fields: { loan_id: loanId },
          file,
          label: file.name,
        });
        if (result.queued) {
          done += 1;
        } else if (result.ok) {
          uploaded += 1;
          done += 1;
        } else {
          setError(result.error || `העלאת ${file.name} נכשלה.`);
          break;
        }
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "המסמך הועלה." : `${uploaded} מסמכים הועלו.`);
        await loadDocs(loanId);
      }
      setFiles(files.slice(done));
    } finally {
      setBusy(false);
    }
  }

  async function removeDoc(id: string) {
    if (!loanId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/documents/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document_id: id }),
      });
      if (res.ok) {
        toast.success("המסמך נמחק.");
        await loadDocs(loanId);
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(toHebrewError(json.error, "מחיקת המסמך נכשלה."));
      }
    } finally {
      setBusy(false);
    }
  }

  const counterparty = loan
    ? (loan.direction === "taken" ? loan.lender : loan.borrower)?.trim() || "הלוואה"
    : "";

  return (
    <Dialog open={Boolean(loan)} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>מסמכים</DialogTitle>
          <DialogDescription>{counterparty}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <FileUploadActions
            files={files}
            onFilesSelected={setFiles}
            multiple
            disabled={busy}
            chooseLabel="בחירת קבצים"
          />
          {files.length > 0 ? (
            <div className="flex justify-end">
              <Button type="button" onClick={() => void upload()} disabled={busy}>
                {busy ? "מעלה..." : "העלאה"}
              </Button>
            </div>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="space-y-2">
            <div className="text-sm font-semibold">קבצים מצורפים</div>
            {loading ? (
              <div className="text-sm text-muted-foreground">טוען...</div>
            ) : docs.length === 0 ? (
              <div className="text-sm text-muted-foreground">אין מסמכים מצורפים עדיין.</div>
            ) : (
              docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <div className="min-w-0 truncate">
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary hover:underline"
                      >
                        {doc.fileName}
                      </a>
                    ) : (
                      <span className="font-medium">{doc.fileName}</span>
                    )}
                    {doc.uploadedAt ? (
                      <span className="text-muted-foreground"> · {formatDate(doc.uploadedAt)}</span>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    size="icon-sm"
                    onClick={() => void removeDoc(doc.id)}
                    disabled={busy}
                    aria-label="מחק מסמך"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </AdaptiveDialog>
    </Dialog>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function LoansClient({ loans, summary }: { loans: Loan[]; summary: LoansSummary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"all" | "taken" | "given">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [repayLoan, setRepayLoan] = useState<Loan | null>(null);

  // Deep link: /financial/loans?repay=<loanId> (e.g. from the collections חייבים
  // list) opens that loan's repayment dialog so the repayment can be recorded here.
  const repayParam = searchParams?.get("repay") ?? "";
  useEffect(() => {
    if (!repayParam) return;
    const target = loans.find((l) => l.id === repayParam);
    // Syncing dialog state to a URL deep-link param — a legitimate effect-driven
    // setState (opens the repayment dialog when arrived at via ?repay=<id>).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (target) setRepayLoan(target);
  }, [repayParam, loans]);
  const [docsLoan, setDocsLoan] = useState<Loan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(
    () => (filter === "all" ? loans : loans.filter((l) => l.direction === filter)),
    [loans, filter]
  );

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(loan: Loan) {
    setEditing(loan);
    setFormOpen(true);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const res = await deleteLoan(deleteTarget.id);
      if (res.ok) {
        toast.success("ההלוואה נמחקה.");
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  function toggleWrittenOff(loan: Loan) {
    startTransition(async () => {
      const res = await setLoanWrittenOff(loan.id, loan.derivedStatus !== "written_off");
      if (res.ok) {
        toast.success(loan.derivedStatus !== "written_off" ? "ההלוואה סומנה כנמחקת." : "הסימון בוטל.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const filters: Array<{ key: "all" | "taken" | "given"; label: string }> = [
    { key: "all", label: "הכל" },
    { key: "taken", label: "שלקחתי" },
    { key: "given", label: "שנתתי" },
  ];

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          הלוואה חדשה
        </Button>
      </div>

      <AdaptiveGrid variant="customerStats">
        <StatBox label="חוב הלוואות (שלקחתי)" value={formatIls(summary.borrowedOutstanding)} tone="debt" />
        <StatBox label="הלוואות שנתתי (חייבים לי)" value={formatIls(summary.lentOutstanding)} tone="asset" />
        <StatBox
          label="מאזן הלוואות (נטו)"
          value={formatIls(summary.netPosition)}
          tone={summary.netPosition >= 0 ? "asset" : "debt"}
        />
      </AdaptiveGrid>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.key}
            type="button"
            size="sm"
            variant={filter === f.key ? "default" : "secondary"}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            אין הלוואות להצגה. לחץ על &quot;הלוואה חדשה&quot; כדי להתחיל.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((loan) => {
            const counterparty =
              (loan.direction === "taken" ? loan.lender : loan.borrower)?.trim() || "ללא שם";
            return (
              <Card key={loan.id}>
                <CardContent className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {loan.counterparty_customer_id ? (
                        <Link
                          href={`/customers/${loan.counterparty_customer_id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {counterparty}
                        </Link>
                      ) : (
                        <span className="font-semibold">{counterparty}</span>
                      )}
                      {loan.counterparty_phone ? (
                        <a
                          href={`tel:${loan.counterparty_phone}`}
                          dir="ltr"
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {loan.counterparty_phone}
                        </a>
                      ) : null}
                      <span className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses("neutral")}>
                        {loan.direction === "taken" ? "שלקחתי" : "שנתתי"}
                      </span>
                      <span
                        className={"rounded-md border px-2 py-0.5 text-xs " + getStatusColorClasses(statusColor(loan.derivedStatus))}
                      >
                        {loanStatusLabel(loan.derivedStatus)}
                      </span>
                      <span className="text-xs text-muted-foreground">{getBusinessDomainLabel(loan.business_domain)}</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span dir="ltr">{formatDate(loan.loan_date)}</span>
                      {loan.due_date ? <span> · פרעון {formatDate(loan.due_date)}</span> : null}
                      {loan.documentation ? <span> · {loan.documentation}</span> : null}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted-foreground">סכום </span>
                      <span className="font-medium" dir="ltr">{formatIls(loan.amount)}</span>
                      <span className="text-muted-foreground"> · נפרע </span>
                      <span className="font-medium" dir="ltr">{formatIls(loan.repaidPrincipal)}</span>
                      <span className="text-muted-foreground"> · יתרה </span>
                      <span
                        className={"font-semibold " + (loan.direction === "taken" ? "text-destructive" : "text-success")}
                        dir="ltr"
                      >
                        {formatIls(loan.outstanding)}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => setRepayLoan(loan)}>
                      <Receipt className="h-4 w-4" />
                      החזרים{loan.repayments.length ? ` (${loan.repayments.length})` : ""}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setDocsLoan(loan)}>
                      <Paperclip className="h-4 w-4" />
                      מסמכים
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(loan)}>
                      <Pencil className="h-4 w-4" />
                      עריכה
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      onClick={() => toggleWrittenOff(loan)}
                      disabled={pending}
                      aria-label="סמן כנמחקת"
                      title={loan.derivedStatus === "written_off" ? "בטל מחיקה" : "סמן כנמחקת (מחילה)"}
                    >
                      <Ban className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive-outline"
                      size="icon-sm"
                      onClick={() => setDeleteTarget(loan)}
                      aria-label="מחק הלוואה"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <LoanFormDialog open={formOpen} loan={editing} onOpenChange={setFormOpen} />
      <RepaymentsDialog
        loan={repayLoan}
        onOpenChange={(open) => {
          if (open) return;
          setRepayLoan(null);
          // Strip ?repay= so the dialog doesn't reopen on the next render/refresh.
          if (repayParam) router.replace("/financial/loans");
        }}
      />
      <LoanDocumentsDialog loan={docsLoan} onOpenChange={(open) => !open && setDocsLoan(null)} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="מחיקת הלוואה"
        description="ההלוואה וכל ההחזרים שלה יימחקו. לא ניתן לשחזר."
        confirmLabel="מחיקה"
        destructive
        loading={pending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
