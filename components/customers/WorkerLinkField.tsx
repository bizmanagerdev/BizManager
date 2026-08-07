"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { matchWorkerByPhone, type WorkerOption } from "@/lib/customers/workerLink";

/**
 * "עובד בעסק (אותו אדם)" — links this customer row to the `users` row that is
 * the same human, plus the guard that catches it at typing time: when the phone
 * being entered belongs to a worker who has no customer row yet, it offers the
 * link instead of letting a near-duplicate person be created.
 *
 * IDENTITY ONLY. The customer keeps his orders/projects/receivables and the
 * worker keeps his sessions/payslips — this never moves money between the two
 * sides, it only lets the UI show them as one person.
 *
 * Renders nothing when the staff list is empty (non-admin/office roles get an
 * empty list from the route, and a business with no workers has nothing to link).
 *
 * Shared by CustomerForm (create + the order-wizard inline form) and
 * EditCustomerDialog so the two never drift.
 */
export function WorkerLinkField({
  value,
  onChange,
  phones = [],
  disabled = false,
}: {
  /** Linked users.id, or "" for none. */
  value: string;
  /** The chosen worker is passed along too, for callers that show its name. */
  onChange: (next: string, worker: WorkerOption | null) => void;
  /** Phone-ish values typed in the form, checked against staff phone numbers. */
  phones?: (string | null | undefined)[];
  disabled?: boolean;
}) {
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/users/worker-options", { signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as { workers?: WorkerOption[] };
        if (!controller.signal.aborted) setWorkers(json.workers ?? []);
      } catch {
        // ignore — aborted or offline; the field just doesn't render
      }
    })();
    return () => controller.abort();
  }, []);

  const phoneKey = phones.join("|");
  const suggestion = useMemo(
    () => (value ? null : matchWorkerByPhone(workers, ...phones)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, workers, phoneKey]
  );

  // A worker already tied to a different customer isn't offerable — the unique
  // index rejects it. The one linked to THIS customer stays so edit mode can
  // display its current value.
  const options = useMemo(
    () =>
      workers
        .filter((worker) => !worker.linkedCustomerId || worker.id === value)
        .map((worker) => ({ value: worker.id, label: worker.label, hint: worker.phone })),
    [workers, value]
  );

  if (options.length === 0) return null;

  return (
    <div className="space-y-2">
      {suggestion && !suggestionDismissed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          <div className="min-w-0">
            <div className="font-medium">הטלפון הזה שייך לעובד {suggestion.label}</div>
            <div className="text-xs">אותו אדם? קישור מציג יחד את מה שהוא חייב ואת מה שמגיע לו.</div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => setSuggestionDismissed(true)}
            >
              לא, אדם אחר
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(suggestion.id, suggestion)}
            >
              קישור לעובד
            </Button>
          </div>
        </div>
      ) : null}

      <Field label="עובד בעסק (אותו אדם)">
        <SearchableSelect
          options={options}
          value={value}
          onChange={(next) => {
            onChange(next, workers.find((worker) => worker.id === next) ?? null);
            if (next) setSuggestionDismissed(false);
          }}
          placeholder="לא עובד בעסק"
          searchPlaceholder="חיפוש עובד..."
          emptyOptionLabel="לא עובד בעסק"
          ariaLabel="עובד מקושר"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          קישור לעובד מציג את שתי היתרות יחד — מה שהוא חייב כלקוח ומה שמגיע לו כעובד. הכסף עצמו נשאר בנפרד.
        </p>
      </Field>
    </div>
  );
}
