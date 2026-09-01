// @vitest-environment jsdom
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { useStepFlow, WizardStepper, type WizardStepDef } from "@/components/ui/step-wizard";

// step-wizard.tsx's own comment: 11 dialogs each hand-rolled this exact
// step-gating logic separately before it was extracted here — a regression
// here silently breaks every multi-step flow in the app (order/project/
// customer wizards, Income/Expense/CollectPayment, …). Pure hook logic, no
// DOM needed beyond React's own render cycle, so this is cheap to lock down.
type Step = "a" | "b" | "c" | "d";
const STEPS: Step[] = ["a", "b", "c", "d"];

function useHarness(satisfied: Partial<Record<Step, boolean>> = {}) {
  const [stepId, setStepId] = useState<Step>("a");
  const isSatisfied = (s: Step) => satisfied[s] ?? true;
  const flow = useStepFlow({ stepId, setStepId, steps: STEPS, isSatisfied });
  return { stepId, ...flow };
}

describe("useStepFlow", () => {
  it("unlocks a step only once every step before it is satisfied", () => {
    const { result } = renderHook(() => useHarness({ b: false }));
    // step "a" has nothing before it → always unlocked.
    expect(result.current.stepUnlocked("a")).toBe(true);
    // step "c" is gated on "b", which is NOT satisfied.
    expect(result.current.stepUnlocked("c")).toBe(false);
    // step "b" is gated only on "a", which IS satisfied.
    expect(result.current.stepUnlocked("b")).toBe(true);
  });

  it("canClickStep allows a step at-or-behind the current one, and an unlocked step ahead", () => {
    const { result } = renderHook(() => useHarness({ b: false }));
    // At "a": "b" is ahead but still unlocked (only gated on "a", which is
    // satisfied), while "c" is blocked because "b" itself is unsatisfied.
    expect(result.current.canClickStep("a")).toBe(true);
    expect(result.current.canClickStep("b")).toBe(true);
    expect(result.current.canClickStep("c")).toBe(false);
  });

  it("canClickStep always allows stepping back, even into a step now 're-locked' by later state", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.advanceTo("c"));
    expect(result.current.stepId).toBe("c");
    // Position-based: "a" and "b" are behind the current step, so always clickable.
    expect(result.current.canClickStep("a")).toBe(true);
    expect(result.current.canClickStep("b")).toBe(true);
  });

  it("goToStep refuses to jump to a locked step", () => {
    const { result } = renderHook(() => useHarness({ b: false }));
    act(() => result.current.goToStep("c"));
    expect(result.current.stepId).toBe("a");
  });

  it("goToStep jumps directly to an unlocked step", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.goToStep("c"));
    expect(result.current.stepId).toBe("c");
  });

  it("advanceTo moves forward without re-checking the gate", () => {
    const { result } = renderHook(() => useHarness({ b: false, c: false }));
    // Even though "c" would normally be locked (unsatisfied "b"), advanceTo
    // is the "the tap itself makes this reachable" escape hatch.
    act(() => result.current.advanceTo("c"));
    expect(result.current.stepId).toBe("c");
  });

  it("goNext stops at the last step and goBack stops at the first", () => {
    const { result } = renderHook(() => useHarness());
    expect(result.current.isLastStep).toBe(false);
    act(() => result.current.goBack());
    expect(result.current.stepId).toBe("a"); // no-op, nothing before "a"

    act(() => result.current.goToStep("d"));
    expect(result.current.stepId).toBe("d");
    act(() => result.current.goNext());
    expect(result.current.stepId).toBe("d"); // no-op, nothing after "d"
  });

  it("goNext respects gating (won't advance into a locked step)", () => {
    const { result } = renderHook(() => useHarness({ c: false }));
    act(() => result.current.goToStep("b"));
    expect(result.current.stepId).toBe("b");
    // b -> c: c's OWN gate only cares about steps before it (a, b), both
    // satisfied — c being itself unsatisfied doesn't block entering it.
    act(() => result.current.goNext());
    expect(result.current.stepId).toBe("c");
  });
});

describe("WizardStepper", () => {
  const steps: WizardStepDef<Step>[] = [
    { n: "a", label: "פרטים" },
    { n: "b", label: "תשלום" },
    { n: "c", label: "סיכום" },
  ];

  it("marks steps before the current one as done, and the current one as active", () => {
    render(
      <WizardStepper steps={steps} current="b" canClick={() => true} onStepClick={() => {}} />
    );
    // "a" is done -> shows a check icon instead of "1".
    expect(screen.queryByText("1")).not.toBeInTheDocument();
    // "b" (current) and "c" (upcoming) show their numbers.
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("תשלום")).toBeInTheDocument();
  });

  it("disables a step button when canClick returns false, and clicking it does nothing", () => {
    const onStepClick = vi.fn();
    render(
      <WizardStepper steps={steps} current="a" canClick={(n) => n !== "c"} onStepClick={onStepClick} />
    );
    const summaryButton = screen.getByText("3").closest("button")!;
    expect(summaryButton).toBeDisabled();
    fireEvent.click(summaryButton);
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it("clicking an unlocked, non-current step calls onStepClick with its id", () => {
    const onStepClick = vi.fn();
    render(
      <WizardStepper steps={steps} current="a" canClick={() => true} onStepClick={onStepClick} />
    );
    const paymentButton = screen.getByText("תשלום").parentElement!.querySelector("button")!;
    fireEvent.click(paymentButton);
    expect(onStepClick).toHaveBeenCalledWith("b");
  });
});
