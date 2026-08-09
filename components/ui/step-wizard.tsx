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

import { Fragment, type ReactNode, type Ref } from "react";
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
  DialogChromeBody,
  DialogChromeFooter,
  DialogChromeHeader,
} from "@/components/ui/dialog-chrome";
import { AdaptiveDialog, dialogVariants } from "@/components/layout/page-layout";
import { cn } from "@/lib/utils";

export type WizardStepDef<TStep extends number = number> = {
  n: TStep;
  label: string;
};

/**
 * Numbered steps with labels, connected by a track. RTL-aware (flex flows with
 * the document direction).
 *
 * Deliberately one-tone: the current step is an outlined navy circle, passed
 * steps are filled navy with a check, and the track behind them turns navy. A
 * second colour for "done" read as a status badge rather than as progress.
 */
export function WizardStepper<TStep extends number>({
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
  return (
    <div className={cn("flex w-full min-w-0 items-start", className)}>
      {steps.map((s, i) => {
        const done = s.n < current;
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
                  "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  active && "border-primary text-primary",
                  done && "border-primary bg-primary text-primary-foreground",
                  !active && !done && "border-border text-muted-foreground",
                  clickable && !active ? "cursor-pointer hover:border-primary/60" : "cursor-default"
                )}
              >
                {done ? <CheckIcon className="h-3.5 w-3.5" /> : s.n}
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
                  "mx-0.5 mt-[14px] h-0.5 min-w-0 flex-1 rounded-full sm:mx-2",
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

export type StepWizardProps<TStep extends number> = {
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

export function StepWizard<TStep extends number>({
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
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            שלב {stepNumber} מתוך {steps.length}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(stepNumber / steps.length) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  const header = inDialog ? (
    <DialogChromeHeader onClose={onClose} closeDisabled={closeDisabled} closeLabel={closeLabel}>
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
            שלב {current} מתוך {steps.length}
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
export function StepWizardDialog<TStep extends number>({
  open,
  onOpenChange,
  size = "formLg",
  dialogTitle,
  dialogDescription,
  kicker,
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
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* hideClose: the wizard's own X is the single way out. */}
      <AdaptiveDialog
        size={size}
        hideClose
        className={DIALOG_CHROME_CONTENT}
      >
        <StepWizard
          {...wizard}
          onClose={() => onOpenChange(false)}
          title={
            // sr-only: the stepper below already names where you are, so a
            // visible title said it twice and cost a row. Radix still needs the
            // title/description for screen readers.
            <DialogHeader className="sr-only space-y-1 text-start">
              {kicker ? (
                <div className="text-xs font-medium text-muted-foreground">{kicker}</div>
              ) : null}
              <DialogTitle>{dialogTitle}</DialogTitle>
              <DialogDescription>{dialogDescription}</DialogDescription>
            </DialogHeader>
          }
        />
      </AdaptiveDialog>
    </Dialog>
  );
}
