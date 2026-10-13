"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WizardStepper, type WizardStepDef } from "@/components/ui/step-wizard";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { CheckIcon, LinkIcon } from "@/components/ui/icons";
import type { CardSummary, StatementSteps as Steps } from "@/lib/financial/cardStatementMath";
import { PanelTitle, STATUS_CHIP as chip } from "@/components/financial/statement-ui";

// The statement page's three steps — שיוך והוצאות → חיוב בבנק → סיום — as a
// step bar with one panel under it for the step on screen. Before this the
// steps were three buttons opening dialogs, and nothing said which came next:
// in August the bank charge was skipped and the payments calendar listed every
// purchase instead of one line per card (owner, 2026-10-12).

export type StatementStepId = "assign" | "bank" | "done";

const STEP_DEFS: WizardStepDef<StatementStepId>[] = [
  { n: "assign", label: "שיוך והוצאות" },
  { n: "bank", label: "חיוב בבנק" },
  { n: "done", label: "סיום" },
];

const ils = (n: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function formatIsoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(-2)}` : iso || "—";
}

/** The step a statement opens on: the first one still open. */
export function firstOpenStep(steps: Steps, markedDone: boolean): StatementStepId {
  if (markedDone) return "done";
  if (!steps.assign.done) return "assign";
  if (!steps.bank.done) return "bank";
  return "done";
}

/** The statement's status in the words of its steps — the page header and the list share it. */
export function statementStatus(steps: Steps, markedDone: boolean): { label: string; tone: keyof typeof chip } {
  if (markedDone) return { label: "בוצע", tone: "ok" };
  if (!steps.assign.done) return { label: "ממתין לשיוך", tone: "warn" };
  if (!steps.bank.done) return { label: "ממתין לחיוב בנק", tone: "warn" };
  return { label: "מוכן לסיום", tone: "info" };
}

export function StatusChip({ steps, markedDone }: { steps: Steps; markedDone: boolean }) {
  const s = statementStatus(steps, markedDone);
  return <span className={chip[s.tone]}>{s.label}</span>;
}

/** "תואם" / "הפרש" for a card (or a whole statement) whose bank charge is recorded. */
export function DifferenceChip({ difference }: { difference: number | null }) {
  if (difference === null) return null;
  if (Math.abs(difference) < 0.005) return <span className={chip.ok}>תואם לשורות</span>;
  return (
    <span
      className={chip.warn}
      title={difference > 0 ? "הבנק לקח יותר מסכום השורות" : "הבנק לקח פחות מסכום השורות"}
    >
      הפרש {ils(Math.abs(difference))}
    </span>
  );
}

export function StatementSteps({
  steps,
  markedDone,
  activeStep,
  onStepChange,
  assign,
  bank,
  finish,
}: {
  steps: Steps;
  markedDone: boolean;
  activeStep: StatementStepId;
  onStepChange: (step: StatementStepId) => void;
  assign: {
    eligibleCount: number;
    refundCount: number;
    creating: boolean;
    busy: boolean;
    onCreate: () => void;
    xToggle: { count: number; excluded: boolean; onToggle: () => void } | null;
    duplicates: { count: number; onUncheck: () => void } | null;
  };
  bank: {
    accountName: (id: string) => string;
    onRecord: (card: CardSummary) => void;
    onDelete: (card: CardSummary) => void;
    onMerge: ((card: CardSummary) => void) | null;
    onFixCountedTwice: (card: CardSummary) => void;
  };
  finish: { busy: boolean; onFinish: () => void; onReopen: () => void };
}) {
  const isDone = (n: StatementStepId) => (n === "assign" ? steps.assign.done : n === "bank" ? steps.bank.done : markedDone);

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <WizardStepper
          steps={STEP_DEFS}
          current={activeStep}
          canClick={() => true}
          onStepClick={onStepChange}
          isDone={isDone}
          className="mx-auto max-w-md"
        />
        {activeStep === "assign" ? (
          <AssignPanel steps={steps} {...assign} onNext={() => onStepChange("bank")} />
        ) : activeStep === "bank" ? (
          <BankPanel steps={steps} {...bank} onNext={() => onStepChange("done")} />
        ) : (
          <FinishPanel steps={steps} markedDone={markedDone} {...finish} />
        )}
      </CardContent>
    </Card>
  );
}

function AssignPanel({
  steps,
  eligibleCount,
  refundCount,
  creating,
  busy,
  onCreate,
  xToggle,
  duplicates,
  onNext,
}: {
  steps: Steps;
  eligibleCount: number;
  refundCount: number;
  creating: boolean;
  busy: boolean;
  onCreate: () => void;
  xToggle: { count: number; excluded: boolean; onToggle: () => void } | null;
  duplicates: { count: number; onUncheck: () => void } | null;
  onNext: () => void;
}) {
  const a = steps.assign;
  const createLabel = refundCount > 0 ? `צור הוצאות והכנסות מזיכויים (${eligibleCount})` : `צור הוצאות (${eligibleCount})`;
  return (
    <div className="space-y-3">
      <PanelTitle
        title="שיוך והוצאות"
        hint="בחר/י תחום לכל שורה בטבלה למטה, ואז רשום/י אותן: רכישות הופכות להוצאות, זיכויים להכנסות באותו תחום."
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <span className={chip.ok}>{a.created} נרשמו</span>
        {a.ready > 0 ? <span className={chip.info}>{a.ready} מוכנות לרישום</span> : null}
        {a.needsDomain > 0 ? <span className={chip.warn}>{a.needsDomain} ממתינות לשיוך</span> : null}
        {a.refundsWaiting > 0 ? <span className={chip.info}>{a.refundsWaiting} זיכויים יירשמו כהכנסה</span> : null}
        {a.leftOut > 0 ? <span className={chip.plain}>{a.leftOut} לא לתיעוד</span> : null}
        {a.refundsLeftOut > 0 ? (
          <span className={chip.plain} title="זיכויים שלא מסומנים להכנסה — הבנק כבר הוריד אותם מחיוב הכרטיס">
            {a.refundsLeftOut} זיכויים לא נרשמים
          </span>
        ) : null}
      </div>
      {a.done ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-success-soft-foreground">
            <CheckIcon className="inline h-4 w-4 align-text-bottom" /> כל השורות נרשמו.
          </span>
          {!steps.bank.done ? (
            <Button size="sm" onClick={onNext}>
              המשך לחיוב בבנק
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {xToggle ? (
            <label className="flex items-center gap-2 text-sm" title="בטל את הסימון לכל שורות ה-X בבת אחת">
              <button
                type="button"
                role="switch"
                aria-checked={xToggle.excluded}
                onClick={xToggle.onToggle}
                disabled={creating}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  xToggle.excluded ? "bg-primary" : "bg-muted-foreground/30"
                }`}
              >
                <span
                  className={`absolute h-4 w-4 rounded-full bg-background shadow transition-all ${
                    xToggle.excluded ? "left-0.5" : "right-0.5"
                  }`}
                />
              </button>
              <span>בטל סימון שורות X ({xToggle.count})</span>
            </label>
          ) : null}
          {duplicates ? (
            <Button variant="outline" size="sm" onClick={duplicates.onUncheck} disabled={creating}>
              אל תרשום כפילויות ({duplicates.count})
            </Button>
          ) : null}
          <Button size="sm" className="ms-auto" onClick={onCreate} disabled={creating || busy || eligibleCount === 0}>
            {creating ? "רושם..." : createLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

function BankPanel({
  steps,
  accountName,
  onRecord,
  onDelete,
  onMerge,
  onFixCountedTwice,
  onNext,
}: {
  steps: Steps;
  accountName: (id: string) => string;
  onRecord: (card: CardSummary) => void;
  onDelete: (card: CardSummary) => void;
  onMerge: ((card: CardSummary) => void) | null;
  onFixCountedTwice: (card: CardSummary) => void;
  onNext: () => void;
}) {
  const firstMissing = steps.cards.find((c) => c.needsCharge)?.label ?? null;
  return (
    <div className="space-y-3">
      <PanelTitle
        title="חיוב בבנק"
        hint="לכל כרטיס: כמה הבנק לקח בפועל, מתי ומאיזה חשבון. כך לוח התשלומים והחשבון מראים שורה אחת לכרטיס ולא כל קנייה."
      />
      <div className="space-y-2">
        {steps.cards.map((card) => {
          const charge = card.charge;
          const merge =
            onMerge && steps.cards.length > 1 ? (
              <IconButton icon={LinkIcon} label={`מיזוג "${card.label}" לתוך כרטיס אחר`} variant="ghost" onClick={() => onMerge(card)} />
            ) : null;
          return (
            <div
              key={card.label}
              className={`space-y-2 rounded-md border px-3 py-2 ${
                charge ? "border-success-soft-foreground/40 bg-success-soft/15" : ""
              }`}
            >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{card.label}</div>
                <div className="text-xs text-muted-foreground">
                  {charge ? (
                    <>
                      {formatIsoDisplay(charge.chargeDate)} · {accountName(charge.accountId) || "חשבון"} · {card.lineCount} שורות
                    </>
                  ) : (
                    <>
                      {card.lineCount} שורות · סכום השורות {ils(card.bill)}
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {charge ? (
                  <>
                    <span className="text-sm font-semibold tabular-nums">{ils(charge.amount)}</span>
                    <DifferenceChip difference={card.difference} />
                    <EditButton label="עריכת חיוב" onClick={() => onRecord(card)} />
                    <DeleteButton label="מחיקת חיוב" onClick={() => onDelete(card)} />
                  </>
                ) : card.needsCharge ? (
                  <Button size="sm" variant={card.label === firstMissing ? "default" : "outline"} onClick={() => onRecord(card)}>
                    רישום חיוב
                  </Button>
                ) : card.creditBalance ? (
                  <span className={chip.plain}>יתרת זכות {ils(Math.abs(card.bill))} — אין חיוב</span>
                ) : (
                  <span className={chip.plain}>אין מה לחייב</span>
                )}
                {merge}
              </div>
            </div>
            {card.countedTwice > 0 ? (
              // An expense typed by hand with a bank account, then matched to this card's
              // line: it leaves the account by itself AND inside the card's charge.
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-2.5 py-1.5 text-xs">
                <span>
                  {card.countedTwiceCount === 1 ? "שורה אחת" : `${card.countedTwiceCount} שורות`} ({ils(card.countedTwice)}) רשומות גם
                  כהוצאה שיורדת מחשבון בנק בנפרד — יתרת הבנק סופרת אותן פעמיים.
                </span>
                <Button size="sm" variant="outline" onClick={() => onFixCountedTwice(card)}>
                  העברה לחיוב הכרטיס
                </Button>
              </div>
            ) : null}
            </div>
          );
        })}
      </div>
      {steps.bank.done ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-success-soft-foreground">
            <CheckIcon className="inline h-4 w-4 align-text-bottom" /> כל הכרטיסים נרשמו.
          </span>
          <Button size="sm" onClick={onNext}>
            המשך לסיום
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FinishPanel({
  steps,
  markedDone,
  busy,
  onFinish,
  onReopen,
}: {
  steps: Steps;
  markedDone: boolean;
  busy: boolean;
  onFinish: () => void;
  onReopen: () => void;
}) {
  const diff = steps.totals.difference;
  const twice = steps.totals.countedTwice;
  const diffNote =
    (diff !== null && Math.abs(diff) >= 0.005) || twice > 0 ? (
      <div className="space-y-1 rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
        {diff !== null && Math.abs(diff) >= 0.005 ? (
          <p>
            הבנק לקח {ils(Math.abs(diff))} {diff > 0 ? "יותר" : "פחות"} מסכום השורות. ההפרש לא מונע סיום — כדאי לבדוק אותו
            בשלב “חיוב בבנק” ולכתוב בהערה של החיוב למה.
          </p>
        ) : null}
        {twice > 0 ? <p>{ils(twice)} מהשורות נספרות פעמיים ביתרת הבנק — אפשר לתקן בשלב “חיוב בבנק”.</p> : null}
      </div>
    ) : null;

  if (markedDone) {
    return (
      <div className="space-y-3">
        <PanelTitle title="סיום" hint="הפירוט סגור." />
        <p className="text-sm text-success-soft-foreground">
          <CheckIcon className="inline h-4 w-4 align-text-bottom" /> בוצע. בלוח התשלומים מופיעה שורה אחת לכל כרטיס בתאריך החיוב.
        </p>
        {diffNote}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/financial/payments-calendar">ללוח התשלומים</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={onReopen} disabled={busy}>
            {busy ? "שומר..." : "ביטול סיום"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PanelTitle title="סיום" hint="אפשר לסיים כשכל השורות נרשמו ולכל כרטיס נרשם החיוב בבנק." />
      {steps.canFinish ? (
        <p className="text-sm">הכל רשום. אפשר לסגור את הפירוט.</p>
      ) : (
        <div className="space-y-1 text-sm">
          <p className="font-medium">עוד חסר:</p>
          <ul className="list-inside list-disc text-destructive">
            {steps.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      {diffNote}
      <Button size="sm" onClick={onFinish} disabled={busy || !steps.canFinish}>
        {busy ? "שומר..." : "סיום הפירוט"}
      </Button>
    </div>
  );
}
