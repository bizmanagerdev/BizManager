"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { WizardStepper, type WizardStepDef } from "@/components/ui/step-wizard";
import { DeleteButton, EditButton, IconButton } from "@/components/ui/icon-button";
import { CheckIcon, LinkIcon } from "@/components/ui/icons";
import type { CardSummary, StatementSteps as Steps } from "@/lib/financial/cardStatementMath";
import { PanelTitle, STATUS_CHIP as chip, formatStatementAmount } from "@/components/financial/statement-ui";
import { formatShortDate, formatShortDateTime } from "@/lib/date";
import type { CurrencyCode } from "@/lib/fx/currencies";

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

// A US card kept as its own account (2026-10-25) has no bank charge: its middle
// step is its payments (each linked to the transfer from the bank) and the
// card's balance on the closing day against the statement's.
const CARD_STEP_DEFS: WizardStepDef<StatementStepId>[] = [
  { n: "assign", label: "שיוך והוצאות" },
  { n: "bank", label: "תשלומים ויתרה" },
  { n: "done", label: "סיום" },
];

const ils = (n: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** A US card's payment or cash line, as the payments step lists it. */
export type CardTransferLine = {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: "payment" | "cash_advance";
  /** "Chase · 16/09/26" once linked; null while waiting. */
  linkedLabel: string | null;
};

export type CardStepInfo = {
  currency: CurrencyCode;
  accountName: string;
  periodEnd: string | null;
  dueDate: string | null;
  newBalance: number | null;
  /** The card account's balance at the end of the closing day (negative = we owe). */
  balanceOnClose: number | null;
  lines: CardTransferLine[];
  onOpenLine: (rowId: string) => void;
};


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
  if (!steps.bank.done) return { label: steps.mode === "card_account" ? "ממתין לתשלומים" : "ממתין לחיוב בנק", tone: "warn" };
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
  card,
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
    /** When a charge was entered (created_at), by its id. */
    chargeCreatedAt: (chargeId: string) => string | null;
    onRecord: (card: CardSummary) => void;
    onDelete: (card: CardSummary) => void;
    onMerge: ((card: CardSummary) => void) | null;
    onFixCountedTwice: (card: CardSummary) => void;
  };
  finish: { busy: boolean; onFinish: () => void; onReopen: () => void };
  /** A US card kept as its own account: its payments step instead of the bank charge. */
  card?: CardStepInfo | null;
}) {
  const isDone = (n: StatementStepId) => (n === "assign" ? steps.assign.done : n === "bank" ? steps.bank.done : markedDone);

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <WizardStepper
          steps={card ? CARD_STEP_DEFS : STEP_DEFS}
          current={activeStep}
          canClick={() => true}
          onStepClick={onStepChange}
          isDone={isDone}
          className="mx-auto max-w-md"
        />
        {activeStep === "assign" ? (
          <AssignPanel steps={steps} {...assign} card={Boolean(card)} onNext={() => onStepChange("bank")} />
        ) : activeStep === "bank" ? (
          card ? (
            <CardPaymentsPanel steps={steps} card={card} onNext={() => onStepChange("done")} />
          ) : (
            <BankPanel steps={steps} {...bank} onNext={() => onStepChange("done")} />
          )
        ) : (
          <FinishPanel steps={steps} markedDone={markedDone} card={card ?? null} {...finish} />
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
  card,
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
  /** A US card kept as its own account. */
  card?: boolean;
  onNext: () => void;
}) {
  const a = steps.assign;
  const createLabel = refundCount > 0 ? `צור הוצאות והכנסות מזיכויים (${eligibleCount})` : `צור הוצאות (${eligibleCount})`;
  return (
    <div className="space-y-3">
      <PanelTitle
        title="שיוך והוצאות"
        hint={
          card
            ? "בחר/י תחום לכל קנייה בטבלה למטה, ואז רשום/י אותן: קניות הופכות להוצאות על חשבון הכרטיס, זיכויים להכנסות באותו תחום. התשלומים לכרטיס — בשלב הבא."
            : "בחר/י תחום לכל שורה בטבלה למטה, ואז רשום/י אותן: רכישות הופכות להוצאות, זיכויים להכנסות באותו תחום."
        }
      />
      <div className="flex flex-wrap gap-2 text-sm">
        <span className={chip.ok}>{a.created} נרשמו</span>
        {a.ready > 0 ? <span className={chip.info}>{a.ready} מוכנות לרישום</span> : null}
        {a.needsDomain > 0 ? <span className={chip.warn}>{a.needsDomain} ממתינות לשיוך</span> : null}
        {a.refundsWaiting > 0 ? <span className={chip.info}>{a.refundsWaiting} זיכויים יירשמו כהכנסה</span> : null}
        {a.leftOut > 0 ? <span className={chip.plain}>{a.leftOut} לא לתיעוד</span> : null}
        {a.cash > 0 ? (
          <span className={chip.plain} title="שולמו לנו במזומן — הסכום נכנס לקופה, לא הוצאה">
            {a.cash} מול מזומן
          </span>
        ) : null}
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
              {card ? "המשך לתשלומים" : "המשך לחיוב בבנק"}
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
  chargeCreatedAt,
  onRecord,
  onDelete,
  onMerge,
  onFixCountedTwice,
  onNext,
}: {
  steps: Steps;
  accountName: (id: string) => string;
  chargeCreatedAt: (chargeId: string) => string | null;
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
                      {formatShortDate(charge.chargeDate, "—")} · {accountName(charge.accountId) || "חשבון"} · {card.lineCount} שורות
                      {chargeCreatedAt(charge.id) ? (
                        <div className="text-[11px] text-muted-foreground/70">
                          נרשם {formatShortDateTime(chargeCreatedAt(charge.id))}
                        </div>
                      ) : null}
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

/** The card's balance on the statement's closing day, against the statement:
 *  the system holds what we owe as a negative balance, the statement prints it
 *  as a positive "New Balance". */
function cardBalanceGap(card: CardStepInfo): number | null {
  if (card.balanceOnClose == null || card.newBalance == null) return null;
  return Math.round((-card.balanceOnClose - card.newBalance) * 100) / 100;
}

function CardPaymentsPanel({ steps, card, onNext }: { steps: Steps; card: CardStepInfo; onNext: () => void }) {
  const money = (n: number) => formatStatementAmount(n, card.currency);
  const t = steps.transfers;
  const gap = cardBalanceGap(card);
  const firstWaiting = card.lines.find((l) => !l.linkedLabel)?.id ?? null;
  return (
    <div className="space-y-3">
      <PanelTitle
        title="תשלומים ויתרה"
        hint="כל תשלום לכרטיס הוא העברה מ־Chase או מ־Capital One — אם כבר נרשמה בהתאמת הבנק היא נמצאת לבד. משיכת מזומן נכנסת לקופה."
      />
      <div className="flex flex-wrap gap-2 text-sm">
        {t.paymentsLinked > 0 ? <span className={chip.ok}>{t.paymentsLinked} תשלומים קושרו</span> : null}
        {t.paymentsWaiting > 0 ? <span className={chip.warn}>{t.paymentsWaiting} ממתינים לקישור</span> : null}
        {t.advancesWaiting > 0 ? <span className={chip.warn}>{t.advancesWaiting} משיכות מזומן לרישום</span> : null}
        {card.lines.length === 0 ? <span className={chip.plain}>אין תשלומים בפירוט הזה</span> : null}
      </div>
      {card.lines.length > 0 ? (
        <div className="space-y-1.5">
          {card.lines.map((l) => (
            <div
              key={l.id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                l.linkedLabel ? "border-success-soft-foreground/40 bg-success-soft/15" : ""
              }`}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium" dir="auto">
                  {l.kind === "cash_advance" ? "משיכת מזומן" : "תשלום לכרטיס"} · {formatShortDate(l.date, "—")}
                </div>
                <div className="text-xs text-muted-foreground" dir="auto">
                  {l.linkedLabel ?? l.description}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums" dir="ltr">
                  {money(Math.abs(l.amount))}
                </span>
                {l.linkedLabel ? (
                  <EditButton label="שינוי הקישור" onClick={() => card.onOpenLine(l.id)} />
                ) : (
                  <Button size="sm" variant={l.id === firstWaiting ? "default" : "outline"} onClick={() => card.onOpenLine(l.id)}>
                    {l.kind === "cash_advance" ? "רישום לקופה" : "קישור להעברה"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="rounded-md border px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            יתרת {card.accountName} ב־{formatShortDate(card.periodEnd, "—")}:{" "}
            <span className="font-medium tabular-nums" dir="ltr">
              {card.balanceOnClose == null ? "—" : money(-card.balanceOnClose)}
            </span>
          </span>
          {gap === null ? (
            <span className={chip.plain}>אין יתרה בפירוט להשוואה</span>
          ) : Math.abs(gap) < 0.005 ? (
            <span className={chip.ok}>תואם לפירוט ({money(card.newBalance ?? 0)})</span>
          ) : (
            <span className={chip.warn} title="יתרת הכרטיס במערכת שונה מהיתרה החדשה בפירוט">
              בפירוט {money(card.newBalance ?? 0)} · הפרש {money(Math.abs(gap))}
            </span>
          )}
        </div>
        {gap !== null && Math.abs(gap) >= 0.005 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            ההפרש נסגר כשכל השורות של הפירוט רשומות. אם הן רשומות — כדאי לבדוק את יתרת הפתיחה של הכרטיס, או שורה שנרשמה
            בכרטיס בתאריך אחר.
          </p>
        ) : null}
        {card.dueDate ? (
          <p className="mt-1 text-xs text-muted-foreground">לתשלום עד {formatShortDate(card.dueDate, "—")}</p>
        ) : null}
      </div>
      {steps.bank.done ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-success-soft-foreground">
            <CheckIcon className="inline h-4 w-4 align-text-bottom" /> כל התשלומים קושרו.
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
  card,
  busy,
  onFinish,
  onReopen,
}: {
  steps: Steps;
  markedDone: boolean;
  card: CardStepInfo | null;
  busy: boolean;
  onFinish: () => void;
  onReopen: () => void;
}) {
  if (card) return <CardFinishPanel steps={steps} markedDone={markedDone} card={card} busy={busy} onFinish={onFinish} onReopen={onReopen} />;
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
          {/* A finished statement's next stop is the list (owner, 2026-10-14). */}
          <Button asChild size="sm">
            <Link href="/financial/statements">חזרה לרשימת הפירוטים</Link>
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

// A US card's last step: every line recorded and every payment linked; the
// card's balance on the closing day said beside it (a gap doesn't block).
function CardFinishPanel({
  steps,
  markedDone,
  card,
  busy,
  onFinish,
  onReopen,
}: {
  steps: Steps;
  markedDone: boolean;
  card: CardStepInfo;
  busy: boolean;
  onFinish: () => void;
  onReopen: () => void;
}) {
  const money = (n: number) => formatStatementAmount(n, card.currency);
  const gap = cardBalanceGap(card);
  const gapNote =
    gap !== null && Math.abs(gap) >= 0.005 ? (
      <p className="rounded-md border border-warning-soft-foreground/40 bg-warning-soft/30 px-3 py-2 text-xs">
        יתרת הכרטיס במערכת ({money(-(card.balanceOnClose ?? 0))}) שונה מהפירוט ({money(card.newBalance ?? 0)}) ב־{money(Math.abs(gap))}.
        ההפרש לא מונע סיום — כדאי לבדוק אותו בשלב “תשלומים ויתרה”.
      </p>
    ) : null;

  if (markedDone) {
    return (
      <div className="space-y-3">
        <PanelTitle title="סיום" hint="הפירוט סגור." />
        <p className="text-sm text-success-soft-foreground">
          <CheckIcon className="inline h-4 w-4 align-text-bottom" /> בוצע. הקניות רשומות על {card.accountName}, והתשלומים — כהעברות
          מהבנק.
        </p>
        {gapNote}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href="/financial/statements">חזרה לרשימת הפירוטים</Link>
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
      <PanelTitle title="סיום" hint="אפשר לסיים כשכל השורות נרשמו וכל תשלום לכרטיס קושר להעברה." />
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
      {gapNote}
      <Button size="sm" onClick={onFinish} disabled={busy || !steps.canFinish}>
        {busy ? "שומר..." : "סיום הפירוט"}
      </Button>
    </div>
  );
}
