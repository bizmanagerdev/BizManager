"use client";

// THE step wizard. Every multi-step flow in the app (new customer, new order,
// new/edit project) renders through this one component, so the chrome — step
// bar, close X, scrolling body, action bar, back arrow, next arrow, step
// counter — exists exactly once. Change the back arrow here and it changes in
// all of them.
//
// Each wizard supplies only what is genuinely its own: its step list, its step
// content, and what "next" means. Anything visual that a wizard wants to differ
// on is a prop here, never a re-implementation in the wizard.

import { Fragment, useRef, type ReactNode, type Ref } from "react";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIALOG_CHROME_CONTENT,
  DIALOG_CHROME_CONTENT_PAGE,
  DialogChromeBody,
  DialogChromeFooter,
  DialogChromeHeader,
  useSwipeToDismiss,
} from "@/components/ui/dialog-chrome";
import { AdaptiveDialog, AdaptivePageDialog, dialogVariants } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";

export type WizardStepDef<TStep extends string | number = number> = {
  n: TStep;
  label: string;
};

/**
 * The step-navigation LOGIC every atomic wizard in the app was hand-rolling
 * separately: whether a given step can be jumped to (every step before it
 * must already be satisfied), and back/next/direct-jump movement. Eleven
 * dialogs (Income, CollectPayment, Expense, AccountTransfer, UploadDocument,
 * ReminderForm, WorkerPayment, SessionEditor, CreateCustomer, NewProject,
 * NewOrder) each carried their own copy of this exact same ~7-function shape
 * — same names, same logic, found only by literally reading all eleven side
 * by side. Extracted here so a fix (like the `advanceTo` vs. `goToStep`
 * gating subtlety below) only has to happen once.
 *
 * Deliberately does NOT own the `stepId` state itself (an earlier version
 * did, via its own `useState`) — some wizards read the current step to derive
 * an EXTRA gate (e.g. "an inline sub-form is open, block jumping forward"),
 * and that gate is usually computed before this hook would otherwise be
 * called; a hook that owns its own state can't have an input depend on its
 * own output. Caller keeps its own `useState<TStep>`, positioned wherever
 * that wizard already needs it (some need it declared very early, before
 * `steps`/`isSatisfied` are even computable) — this hook is just the
 * behavior layer on top.
 *
 * `steps` is expected to be a dynamically-computed array (most wizards' step
 * lists depend on runtime choices — a domain, a payment method, a project
 * type) — pass the caller's own `useMemo`'d array; this hook doesn't memoize
 * it itself, just reads whatever was passed on the latest render.
 */
export function useStepFlow<TStep extends string>({
  stepId,
  setStepId,
  steps,
  isSatisfied,
}: {
  stepId: TStep;
  setStepId: (id: TStep) => void;
  /** The current step order — recompute with your own useMemo when it can change. */
  steps: TStep[];
  /** Whether a step's own requirement is met. Gates every step AFTER it, not itself. */
  isSatisfied: (step: TStep) => boolean;
}) {
  const stepIndex = (id: TStep) => steps.indexOf(id);
  const isLastStep = steps.length > 0 && stepId === steps[steps.length - 1];

  function stepUnlocked(id: TStep) {
    const idx = stepIndex(id);
    for (let i = 0; i < idx; i++) {
      if (!isSatisfied(steps[i])) return false;
    }
    return true;
  }
  function canClickStep(id: TStep) {
    return stepIndex(id) <= stepIndex(stepId) || stepUnlocked(id);
  }
  function goToStep(id: TStep) {
    if (!stepUnlocked(id)) return;
    setStepId(id);
  }
  // Tapping an option card advances directly — no re-validation through the
  // gate below, since the tap itself is what makes the target reachable (and
  // `steps` may not have caught up yet: it can depend on state a `set...` call
  // in the SAME handler hasn't applied until the next render).
  function advanceTo(id: TStep) {
    setStepId(id);
  }
  function goBack() {
    const prev = steps[stepIndex(stepId) - 1];
    if (prev) setStepId(prev);
  }
  function goNext() {
    const next = steps[stepIndex(stepId) + 1];
    if (next) goToStep(next);
  }

  return {
    stepIndex,
    isLastStep,
    stepUnlocked,
    canClickStep,
    goToStep,
    goBack,
    goNext,
    advanceTo,
  };
}

/**
 * A wizard's visible title, centered against the WHOLE header — not just
 * within its own slot, which is narrower than the header by the close X's
 * width (X + divider + gaps, ≈44px). Centering plain text there alone would
 * sit it visibly off-center toward the start. The single start-side spacer
 * below is sized to roughly match that, re-balancing it — approximate, not
 * pixel-exact, but reads as centered next to the X (user request, 2026-08-25:
 * "center the title like the x"). Shared by every StepWizard-family title:
 * StepWizardDialog, NewOrderClient, NewProjectClient, ExpenseDialog's express
 * header — "they need to all be the same" (same request).
 */
export function WizardTitle({
  title,
  description,
  kicker,
}: {
  title: string;
  /** Screen-reader only — the steps already say what the wizard does. */
  description: string;
  kicker?: string;
}) {
  return (
    <DialogHeader className="space-y-0.5">
      <div className="flex items-center gap-2">
        <div className="w-11 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 text-center">
          {kicker ? <div className="text-xs font-medium text-muted-foreground">{kicker}</div> : null}
          <DialogTitle className="truncate text-base font-semibold">{title}</DialogTitle>
        </div>
      </div>
      <DialogDescription className="sr-only">{description}</DialogDescription>
    </DialogHeader>
  );
}

/**
 * Numbered steps with labels, connected by a track. RTL-aware (flex flows with
 * the document direction).
 *
 * Deliberately one-tone: the current step is an outlined navy circle, passed
 * steps are filled navy with a check, and the track behind them turns navy. A
 * second colour for "done" read as a status badge rather than as progress.
 *
 * Position-based, not value-based: `done`/the circle's number both come from
 * the step's INDEX in `steps`, not from comparing `s.n` to `current` — a step
 * list built from string IDs (e.g. IncomeDialog's domain-dependent flow) has
 * no ordering to compare with `<`, and even a numbered wizard is really asking
 * "is this step behind where I am", which is a position question.
 */
export function WizardStepper<TStep extends string | number>({
  steps,
  current,
  canClick,
  onStepClick,
  className,
}: {
  steps: WizardStepDef<TStep>[];
  current: TStep;
  canClick: (n: TStep) => boolean;
  onStepClick: (n: TStep) => void;
  className?: string;
}) {
  const currentIndex = steps.findIndex((s) => s.n === current);
  return (
    // overflow-x-auto: IncomeDialog/CollectPaymentDialog can run to a dozen-plus
    // steps now that they're fully one-question-per-stage, and that many labels
    // never fits a phone width — it needs to scroll INSIDE the stepper, not push
    // the whole page sideways (same overflow-x-auto/overflow-y-hidden pairing
    // the underline tabs use, for the same stray-vertical-scrollbar reason).
    // No-op for a short (≤4 step) wizard like order/project/customer.
    <div className={cn("flex w-full min-w-0 items-start overflow-x-auto overflow-y-hidden", className)}>
      {steps.map((s, i) => {
        const done = currentIndex >= 0 && i < currentIndex;
        const active = s.n === current;
        const clickable = canClick(s.n);
        return (
          <Fragment key={s.n}>
            <div className="flex shrink-0 flex-col items-center gap-1">
              <button
                type="button"
                aria-current={active ? "step" : undefined}
                disabled={!clickable}
                onClick={() => clickable && onStepClick(s.n)}
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-semibold transition-colors",
                  active && "border-primary text-primary",
                  done && "border-primary bg-primary text-primary-foreground",
                  !active && !done && "border-border text-muted-foreground",
                  clickable && !active ? "cursor-pointer hover:border-primary/60" : "cursor-default"
                )}
              >
                {done ? <CheckIcon className="h-2.5 w-2.5" /> : i + 1}
              </button>
              <div
                className={cn(
                  // Narrower on a phone: four labels + the X have to fit 360px.
                  "w-11 text-center text-[10px] font-medium leading-tight sm:w-14",
                  active || done ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {s.label}
              </div>
            </div>
            {i < steps.length - 1 ? (
              <div
                className={cn(
                  // min-w-3 (not min-w-0): a floor so the track actually forces
                  // the row to overflow (and scroll) once there are enough steps,
                  // instead of flex-shrinking every track down to nothing first.
                  "mx-0.5 mt-[9px] h-0.5 min-w-3 flex-1 rounded-full sm:mx-2",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export type StepWizardProps<TStep extends string | number> = {
  /**
   * "dialog" — a fixed-height column inside a dialog: pinned bars, scrolling
   * middle. "page" — a standalone page: the step bar is a sticky card, the
   * action bar is flush above the bottom nav on mobile, and the page itself
   * scrolls.
   */
  variant?: "dialog" | "page";
  steps: WizardStepDef<TStep>[];
  current: TStep;
  canClickStep: (n: TStep) => boolean;
  onStepClick: (n: TStep) => void;
  /**
   * "steps" draws the numbered, clickable stepper — right when the steps have
   * names worth showing. "bar" draws "3 / 12" and a progress bar instead, for
   * flows with too many steps to name in a row on a phone.
   */
  progressVariant?: "steps" | "bar";

  /** Optional heading rendered above the step bar (dialog title, usually). */
  title?: ReactNode;
  /** Renders the single close X in the step bar. Omit for a wizard with no way out. */
  onClose?: () => void;
  closeDisabled?: boolean;
  closeLabel?: string;
  /** A full-page mobile dialog's swipe-down affordance bar, in dialog mode only. */
  grabber?: boolean;

  /** Omit on the first step — the back button then disappears. */
  onBack?: () => void;
  backLabel?: string;
  backDisabled?: boolean;

  onNext: () => void;
  /**
   * The intermediate steps label themselves — "המשך ל<next step>" — straight
   * from the step list, so a wizard never restates its own step names and a
   * renamed step renames its button. Pass this only to override that (or on the
   * last step, where the button is the create/save action).
   */
  nextLabel?: ReactNode;
  nextDisabled?: boolean;
  /** Last step swaps the forward arrow for a check — this is the create/save press. */
  isLastStep?: boolean;
  /** Wraps body+footer in a form so Enter in a field advances the wizard. */
  submitOnEnter?: boolean;

  /** Shown in the action bar, before the buttons. */
  error?: string;
  /** Quiet line under the error, e.g. "יוצר לקוח חדש, נא להמתין...". */
  note?: string;
  /** Fills the start of the action bar when there is no back button (step 1). */
  footerStart?: ReactNode;
  /** Sits between back and next — the order wizard's running total, say. */
  footerCenter?: ReactNode;
  /** "שלב 2 מתוך 4" next to the back button. */
  showStepCounter?: boolean;

  bodyRef?: Ref<HTMLDivElement>;
  /** The wizard's outermost element — page mode uses it to find its scroll parent. */
  rootRef?: Ref<HTMLDivElement>;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
};

export function StepWizard<TStep extends string | number>({
  variant = "dialog",
  steps,
  current,
  canClickStep,
  onStepClick,
  progressVariant = "steps",
  title,
  onClose,
  closeDisabled = false,
  closeLabel = "סגירה",
  grabber = false,
  onBack,
  backLabel = "חזרה",
  backDisabled = false,
  onNext,
  nextLabel,
  nextDisabled = false,
  isLastStep = false,
  submitOnEnter = false,
  error,
  note,
  footerStart,
  footerCenter,
  showStepCounter = true,
  bodyRef,
  rootRef,
  bodyClassName,
  className,
  children,
}: StepWizardProps<TStep>) {
  const inDialog = variant === "dialog";

  // Dialog mode uses the shared chrome, so a wizard is indistinguishable from
  // a FormDialog. Page mode keeps its own sticky-card bar — a standalone page
  // has no dialog edges to sit against.
  const stepNumber = Math.max(1, steps.findIndex((s) => s.n === current) + 1);
  const nextStep = steps[stepNumber];
  // On a phone the full "המשך לתשלום ופרטים" pushed the action bar onto three
  // rows, so the auto label keeps only "המשך" there — the stepper above already
  // shows which step is next. An explicit nextLabel is always shown in full.
  const autoNextLabel = nextStep ? `המשך ל${nextStep.label}` : "";
  const resolvedNextLabel =
    nextLabel ?? (
      <>
        <span className="hidden sm:inline">{autoNextLabel}</span>
        <span className="sm:hidden">המשך</span>
      </>
    );
  const headerContent = (
    <div className="min-w-0 flex-1 space-y-2">
      {title}
      {progressVariant === "steps" ? (
        <WizardStepper
          steps={steps}
          current={current}
          canClick={canClickStep}
          onStepClick={onStepClick}
        />
      ) : (
        // Same w-11 start-spacer as WizardTitle, and for the same reason: this
        // sits in the header's flex-1 slot, which is narrower than the full
        // header by the close X's footprint — centering text/bar plainly inside
        // it lands visibly off-true-center. The title compensates for itself;
        // this block is separate JSX and needs its own copy of the same fix.
        <div className="flex items-center gap-2">
          <div className="w-11 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-center text-xs font-medium text-muted-foreground">
              שלב {stepNumber} מתוך {steps.length}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(stepNumber / steps.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const header = inDialog ? (
    <DialogChromeHeader
      onClose={onClose}
      closeDisabled={closeDisabled}
      closeLabel={closeLabel}
      grabber={grabber}
    >
      {headerContent}
    </DialogChromeHeader>
  ) : (
    <div className="z-20 -mx-4 -mt-4 mb-1 flex items-start gap-2 border-b border-border/70 bg-background px-3 py-2.5 shadow-[0_2px_12px_rgb(0_0_0_/_0.06)] sm:px-4 md:sticky md:top-16 md:-mt-6 md:mx-0 md:rounded-2xl md:border md:shadow-lg lg:-mt-8">
      {headerContent}
    </div>
  );

  const body = inDialog ? (
    <DialogChromeBody ref={bodyRef} className={bodyClassName}>
      {children}
    </DialogChromeBody>
  ) : (
    // On a page the wrapper dissolves so the page keeps its own single-column
    // flow and scrolls as one.
    <div ref={bodyRef} className={cn("contents", bodyClassName)}>
      {children}
    </div>
  );

  const footerInner = (
    <>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {/* Wraps when cramped: anything in footerCenter drops to its own row above
          the buttons on narrow screens and sits inline when there's room. */}
      <div className="flex flex-wrap items-center gap-2">
        {onBack ? (
          <Button
            type="button"
            variant="secondary"
            onClick={onBack}
            disabled={backDisabled}
            className="me-auto min-w-0"
          >
            <ChevronRightIcon className="h-4 w-4" />
            {backLabel}
          </Button>
        ) : (
          (footerStart ?? <div className="me-auto" />)
        )}

        {showStepCounter ? (
          <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
            {/* stepNumber (position), not `current` — current can be a string
                id (IncomeDialog/CollectPaymentDialog/ExpenseDialog's express
                mode), which would print literally ("שלב amount מתוך 13"). */}
            שלב {stepNumber} מתוך {steps.length}
          </span>
        ) : null}

        {footerCenter}

        <Button
          type={submitOnEnter ? "submit" : "button"}
          onClick={submitOnEnter ? undefined : onNext}
          disabled={nextDisabled}
          className="min-w-0 shrink-0"
        >
          {isLastStep ? <CheckIcon className="h-4 w-4" /> : null}
          {resolvedNextLabel}
          {isLastStep ? null : <ChevronLeftIcon className="h-4 w-4" />}
        </Button>
      </div>
    </>
  );

  const footer = inDialog ? (
    <DialogChromeFooter>{footerInner}</DialogChromeFooter>
  ) : (
    // Standalone: flush above the bottom nav on a phone, a sticky card on md+.
    <div className="fixed inset-x-0 bottom-[58px] z-40 space-y-2 border-t border-border/70 bg-background/95 px-3 py-3 shadow-[0_-2px_12px_rgb(0_0_0_/_0.06)] backdrop-blur sm:px-4 md:sticky md:inset-x-auto md:bottom-0 md:z-10 md:mt-1 md:rounded-2xl md:border md:shadow-lg">
      {footerInner}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        inDialog ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-5 pb-28 md:pb-0",
        className
      )}
    >
      {header}
      {submitOnEnter ? (
        <form
          className={cn(inDialog ? "flex min-h-0 flex-1 flex-col" : "contents")}
          onSubmit={(e) => {
            e.preventDefault();
            onNext();
          }}
        >
          {body}
          {footer}
        </form>
      ) : (
        <>
          {body}
          {footer}
        </>
      )}
    </div>
  );
}

/**
 * The wizard plus the dialog around it, for flows that own their own dialog.
 * Wizards that are already hosted in a caller's dialog (order, project) render
 * <StepWizard> directly instead.
 */
export function StepWizardDialog<TStep extends string | number>({
  open,
  onOpenChange,
  size = "formLg",
  dialogTitle,
  dialogDescription,
  kicker,
  fullScreen = false,
  ...wizard
}: Omit<StepWizardProps<TStep>, "variant" | "title" | "onClose"> & {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  size?: keyof typeof dialogVariants;
  dialogTitle: string;
  /** Screen-reader only — the steps already say what the wizard does. */
  dialogDescription: string;
  /** Small muted line above the title ("לקוחות"), if the flow wants one. */
  kicker?: string;
  /** Render as a full mobile page (swipe down or X to close) instead of a
   *  centered box — desktop is unchanged either way. Same mechanism as
   *  FormDialog's `fullScreen`. */
  fullScreen?: boolean;
}) {
  // No current caller passes its own `bodyRef` through StepWizardDialog (only
  // direct <StepWizard> use does, e.g. NewProjectClient), so this one just
  // wins outright when fullScreen is on — nothing to merge.
  const dragBodyRef = useRef<HTMLDivElement>(null);
  const swipeProps = useSwipeToDismiss({
    enabled: fullScreen,
    bodyRef: dragBodyRef,
    onDismiss: () => onOpenChange(false),
  });

  const stepWizard = (
    <StepWizard
      {...wizard}
      bodyRef={fullScreen ? dragBodyRef : wizard.bodyRef}
      grabber={fullScreen}
      onClose={() => onOpenChange(false)}
      title={<WizardTitle title={dialogTitle} description={dialogDescription} kicker={kicker} />}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* hideClose: the wizard's own X is the single way out. */}
      {fullScreen ? (
        <AdaptivePageDialog
          size={size}
          hideClose
          className={DIALOG_CHROME_CONTENT_PAGE}
          {...swipeProps}
        >
          {stepWizard}
        </AdaptivePageDialog>
      ) : (
        <AdaptiveDialog size={size} hideClose className={DIALOG_CHROME_CONTENT}>
          {stepWizard}
        </AdaptiveDialog>
      )}
    </Dialog>
  );
}
