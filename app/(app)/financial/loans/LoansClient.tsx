"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AddIcon, AttachIcon, ChevronLeftIcon, ReceiptIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdaptiveGrid } from "@/components/layout/page-layout";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { type Loan, type LoansSummary, loanStatusLabel } from "@/lib/loans";
import { deleteLoan } from "./actions";
import { LoanDocumentsDialog, LoanFormDialog, RepaymentsDialog } from "./LoanDialogs";
import { StatBox, formatDate, formatIls, statusColor, todayIso } from "./shared";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

// ── Main ────────────────────────────────────────────────────────────────────
export default function LoansClient({ loans, summary }: { loans: Loan[]; summary: LoansSummary }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<"all" | "taken" | "given">("all");
  // Repaid / written-off loans are done business — keep them out of the list
  // until the user actually asks to see them.
  const [showResolved, setShowResolved] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [repayLoan, setRepayLoan] = useState<Loan | null>(null);
  const today = todayIso();

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

  const resolvedCount = useMemo(
    () => loans.filter((l) => l.derivedStatus === "repaid" || l.derivedStatus === "written_off").length,
    [loans]
  );

  const visible = useMemo(
    () =>
      loans
        .filter((l) => filter === "all" || l.direction === filter)
        .filter(
          (l) =>
            showResolved || (l.derivedStatus !== "repaid" && l.derivedStatus !== "written_off")
        ),
    [loans, filter, showResolved]
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

  const filters: Array<{ key: "all" | "taken" | "given"; label: string }> = [
    { key: "all", label: "הכל" },
    { key: "taken", label: "שלקחתי" },
    { key: "given", label: "שנתתי" },
  ];

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" onClick={openCreate}>
          <AddIcon className="h-4 w-4" />
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {resolvedCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant={showResolved ? "default" : "outline"}
            onClick={() => setShowResolved((prev) => !prev)}
          >
            {showResolved ? "הסתרת הלוואות שנפרעו" : `הצגת הלוואות שנפרעו (${resolvedCount})`}
          </Button>
        ) : null}
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
              // data-focus-id lets /financial/loans?focus=<id> land on this loan.
              <Card key={loan.id} data-focus-id={loan.id}>
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
                    {loan.nextInstallment ? (
                      <div className="text-sm">
                        <span
                          className={
                            "rounded-md border px-2 py-0.5 text-xs " +
                            getStatusColorClasses(
                              loan.nextInstallment.repayment_date < today ? "danger" : "warning"
                            )
                          }
                        >
                          {loan.nextInstallment.repayment_date < today ? "תשלום באיחור" : "התשלום הבא"}
                        </span>
                        <span className="text-muted-foreground">{" "}</span>
                        <span className="font-medium tabular-nums" dir="ltr">
                          {formatIls(loan.nextInstallment.amount)}
                        </span>
                        <span className="text-muted-foreground"> ב-</span>
                        <span className="font-medium tabular-nums" dir="ltr">
                          {formatDate(loan.nextInstallment.repayment_date)}
                        </span>
                        <span className="text-muted-foreground">
                          {" · "}
                          {loan.plannedInstallments.length} תשלומים מתוכננים
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button asChild size="sm">
                      <Link href={`/financial/loans/${loan.id}`}>
                        <ChevronLeftIcon className="h-4 w-4" />
                        פרטים
                      </Link>
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setRepayLoan(loan)}>
                      <ReceiptIcon className="h-4 w-4" />
                      החזרים
                      {loan.paidRepayments.length || loan.plannedInstallments.length
                        ? ` (${loan.paidRepayments.length}/${loan.paidRepayments.length + loan.plannedInstallments.length})`
                        : ""}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setDocsLoan(loan)}>
                      <AttachIcon className="h-4 w-4" />
                      מסמכים
                    </Button>
                    <EditButton onClick={() => openEdit(loan)} label="עריכה" />
                    <DeleteButton onClick={() => setDeleteTarget(loan)} label="מחיקת הלוואה" />
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
