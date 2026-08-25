"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/ui/date-input";
import { StepWizardDialog, useStepFlow } from "@/components/ui/step-wizard";
import { StepHeading } from "@/components/ui/option-row";
import { SummaryRow, SummarySection } from "@/components/ui/summary";
import { AssigneeSelect } from "@/components/collections/AssigneeSelect";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { toHebrewError } from "@/lib/error-messages";

// One dialog for BOTH creating and editing a reminder — reused across the order
// panel, the worklist, and anywhere else. Create posts to /api/reminders/create
// with the entity links; edit posts to /api/reminders/update by id.
//
// Rebuilt 2026-08-25 onto the same atomic step-wizard architecture as
// IncomeDialog/CollectPaymentDialog/ExpenseDialog (one question per screen)
// instead of a single-page FormDialog — part of converging every quick-action
// dialog onto one shared shape.
export type ReminderFormValue = {
  id: string;
  remindAt: string | null;
  content: string | null;
  assignedTo: string | null;
};

type ReminderStepId = "when" | "note" | "assignee" | "summary";

const STEP_LABEL: Record<ReminderStepId, string> = {
  when: "מועד",
  note: "פרטים",
  assignee: "אחראי",
  summary: "סיכום",
};

// ISO → value for <input type="datetime-local"> in the viewer's local time.
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatLocalDateTime(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ReminderFormDialog({
  mode,
  open,
  onOpenChange,
  onSaved,
  value,
  links,
  category = "order",
  defaultNote,
  defaultRemindAt,
  canAssignOthers = true,
}: {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  /** The reminder being edited (edit mode). */
  value?: ReminderFormValue;
  /** Entity links to attach on create, e.g. { order_id, customer_id }. */
  links?: Record<string, string | null | undefined>;
  category?: string;
  /** Pre-fill the note on create (e.g. the payment description). */
  defaultNote?: string;
  /** Pre-fill the remind date/time on create (e.g. a calendar day). */
  defaultRemindAt?: string;
  /**
   * False for a worker: his reminders are his own, and the server pins them to
   * him regardless. Offering a picker whose choice is then overruled is worse
   * than not offering one.
   */
  canAssignOthers?: boolean;
}) {
  const { users, currentUserId } = useAssignableUsers();
  const [stepId, setStepId] = useState<ReminderStepId>("when");
  const [remindAt, setRemindAt] = useState("");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIds = useMemo<ReminderStepId[]>(() => {
    const ids: ReminderStepId[] = ["when", "note"];
    if (canAssignOthers) ids.push("assignee");
    ids.push("summary");
    return ids;
  }, [canAssignOthers]);
  const wizardSteps = useMemo(() => stepIds.map((id) => ({ n: id, label: STEP_LABEL[id] })), [stepIds]);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && value) {
      setRemindAt(isoToLocalInput(value.remindAt));
      setNote(value.content ?? "");
      setAssignee(value.assignedTo ?? "");
    } else {
      setRemindAt(defaultRemindAt ? isoToLocalInput(defaultRemindAt) : "");
      setNote(defaultNote ?? "");
      setAssignee(currentUserId ?? "");
    }
    setError(null);
    // When the date is already chosen (opened from the calendar), land on the
    // note field so the user just types what to be reminded about.
    setStepId(mode === "create" && defaultRemindAt ? "note" : "when");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Default the assignee to me once the user list resolves (create mode only).
  useEffect(() => {
    if (open && mode === "create" && currentUserId) setAssignee((prev) => prev || currentUserId);
  }, [open, mode, currentUserId]);

  function isSatisfied(id: ReminderStepId): boolean {
    switch (id) {
      case "when":
        return Boolean(remindAt);
      case "note":
        return Boolean(note.trim());
      case "assignee":
      case "summary":
        return true;
    }
  }

  const { stepIndex, isLastStep, canClickStep, goToStep, goBack, goNext } = useStepFlow<ReminderStepId>({
    stepId,
    setStepId,
    steps: stepIds,
    isSatisfied,
  });

  function handleOpenChange(next: boolean) {
    if (!next && submitting) return;
    onOpenChange(next);
  }

  async function submit() {
    if (submitting) return;
    setError(null);
    if (!remindAt) {
      setError("יש לבחור תאריך ושעה לתזכורת.");
      return;
    }
    if (!note.trim()) {
      setError("יש להזין פרטים לתזכורת.");
      return;
    }
    setSubmitting(true);
    try {
      const remindIso = new Date(remindAt).toISOString();
      const url = mode === "edit" ? "/api/reminders/update" : "/api/reminders/create";
      const payload =
        mode === "edit"
          ? { id: value?.id, remind_at: remindIso, content: note.trim(), assigned_to: assignee || null }
          : {
              ...links,
              remind_at: remindIso,
              content: note.trim() || undefined,
              assigned_to: assignee || undefined,
              action_type: "other",
              category,
            };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error);
      toast.success(mode === "edit" ? "התזכורת עודכנה." : "התזכורת נוספה.");
      onSaved?.();
      handleOpenChange(false);
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSubmitting(false);
    }
  }

  const assigneeName = users.find((u) => u.id === assignee)?.label;

  return (
    <StepWizardDialog
      open={open}
      onOpenChange={handleOpenChange}
      dialogTitle={mode === "edit" ? "עריכת תזכורת" : "תזכורת חדשה"}
      dialogDescription={mode === "edit" ? "עדכון פרטי התזכורת" : "יצירת תזכורת חדשה"}
      size="formMd"
      fullScreen
      progressVariant="bar"
      steps={wizardSteps}
      current={stepId}
      canClickStep={canClickStep}
      onStepClick={goToStep}
      closeDisabled={submitting}
      onBack={stepIndex(stepId) > 0 ? goBack : undefined}
      backDisabled={submitting}
      onNext={() => (isLastStep ? void submit() : goNext())}
      nextLabel={isLastStep ? (submitting ? "שומר..." : mode === "edit" ? "שמירה" : "הוספת תזכורת") : undefined}
      nextDisabled={isLastStep ? submitting : !isSatisfied(stepId)}
      isLastStep={isLastStep}
      submitOnEnter
      error={error || undefined}
    >
      {stepId === "when" ? (
        <>
          <StepHeading title="מתי להזכיר?" />
          <DateTimeInput value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
        </>
      ) : stepId === "note" ? (
        <>
          <StepHeading title="על מה להזכיר?" />
          <Input autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      ) : stepId === "assignee" ? (
        <>
          <StepHeading title="מי אחראי?" sub="לא חובה" />
          <AssigneeSelect value={assignee} onChange={setAssignee} includeMeDefault />
        </>
      ) : (
        <>
          <StepHeading title="לאשר ולשמור?" />
          <SummarySection title="פרטי התזכורת">
            <SummaryRow label="מועד" value={formatLocalDateTime(remindAt)} />
            <SummaryRow label="פרטים" value={note} />
            {canAssignOthers ? <SummaryRow label="אחראי" value={assigneeName ?? "—"} /> : null}
          </SummarySection>
        </>
      )}
    </StepWizardDialog>
  );
}
