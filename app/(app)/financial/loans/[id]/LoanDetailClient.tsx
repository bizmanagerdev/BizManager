"use client";

import type React from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AttachIcon, ChevronLeftIcon, PhoneIcon, ReceiptIcon, UserIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ContactLink } from "@/components/ui/contact-link";
import { SectionCard } from "@/components/ui/section-card";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import { type Loan, loanStatusLabel } from "@/lib/loans";
import { deleteLoan } from "../actions";
import { LoanDocumentsDialog, LoanFormDialog, LoanRepaymentsPanel } from "../LoanDialogs";
import { METHOD_OPTIONS, formatDate, formatIls, statusColor } from "../shared";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

function methodLabel(value: string | null) {
  if (!value) return null;
  return METHOD_OPTIONS.find((m) => m.value === value)?.label ?? value;
}

/** One read-only fact — label above, value below, matching StatBox's rhythm. */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

export default function LoanDetailClient({ loan }: { loan: Loan }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const counterparty =
    (loan.direction === "taken" ? loan.lender : loan.borrower)?.trim() || "ללא שם";
  const ourSide = (loan.direction === "taken" ? loan.borrower : loan.lender)?.trim() || null;

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteLoan(loan.id);
      if (res.ok) {
        toast.success("ההלוואה נמחקה.");
        router.push("/financial/loans");
      } else {
        toast.error(res.error);
        setDeleteOpen(false);
      }
    });
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="ניווט">
            <Link href="/financial/loans" className="hover:text-foreground hover:underline">
              הלוואות וחובות
            </Link>
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            <h1 className="truncate text-lg font-bold text-foreground">{counterparty}</h1>
          </nav>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={getStatusColorClasses("neutral")}>
              {loan.direction === "taken" ? "הלוואה שלקחתי" : "הלוואה שנתתי"}
            </Badge>
            <Badge className={getStatusColorClasses(statusColor(loan.derivedStatus))}>
              {loanStatusLabel(loan.derivedStatus)}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button type="button" variant="secondary" size="sm" onClick={() => setDocsOpen(true)}>
            <AttachIcon className="h-4 w-4" />
            מסמכים
          </Button>
          <EditButton onClick={() => setFormOpen(true)} label="עריכת הלוואה" />
          <DeleteButton onClick={() => setDeleteOpen(true)} label="מחיקת הלוואה" />
        </div>
      </div>

      <SectionCard icon={<UserIcon className="h-4 w-4" />} title="פרטי הלוואה">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <InfoRow
            label={loan.direction === "taken" ? "מלווה" : "לווה"}
            value={
              loan.counterparty_customer_id ? (
                <Link href={`/customers/${loan.counterparty_customer_id}`} className="text-primary hover:underline">
                  {counterparty}
                </Link>
              ) : (
                counterparty
              )
            }
          />
          {loan.counterparty_phone ? (
            <InfoRow
              label="טלפון"
              value={
                <ContactLink
                  kind="tel"
                  value={loan.counterparty_phone}
                  dir="ltr"
                  className="inline-flex items-center gap-1 hover:text-primary"
                >
                  <PhoneIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {loan.counterparty_phone}
                </ContactLink>
              }
            />
          ) : null}
          {ourSide ? (
            <InfoRow label={loan.direction === "taken" ? "לווה (הצד שלנו)" : "מלווה (הצד שלנו)"} value={ourSide} />
          ) : null}
          <InfoRow label="תאריך הלוואה" value={<span dir="ltr">{formatDate(loan.loan_date)}</span>} />
          {loan.due_date ? (
            <InfoRow label="תאריך פרעון" value={<span dir="ltr">{formatDate(loan.due_date)}</span>} />
          ) : null}
          {loan.interest_amount > 0 ? (
            <InfoRow label="ריבית" value={<span dir="ltr">{formatIls(loan.interest_amount)}</span>} />
          ) : null}
          {loan.loan_method ? <InfoRow label="אופן ההלוואה" value={methodLabel(loan.loan_method)} /> : null}
          {loan.repayment_method ? (
            <InfoRow label="אופן ההחזרה" value={methodLabel(loan.repayment_method)} />
          ) : null}
          {loan.documentation ? <InfoRow label="תיעוד ההלוואה" value={loan.documentation} /> : null}
        </div>
        {loan.notes ? (
          <div className="border-t border-border/60 pt-3">
            <div className="text-xs text-muted-foreground">הערות</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{loan.notes}</div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard icon={<ReceiptIcon className="h-4 w-4" />} title="החזרים ותוכנית תשלומים">
        <LoanRepaymentsPanel loan={loan} />
      </SectionCard>

      <LoanFormDialog open={formOpen} loan={loan} onOpenChange={setFormOpen} />
      <LoanDocumentsDialog loan={docsOpen ? loan : null} onOpenChange={(open) => !open && setDocsOpen(false)} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
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
