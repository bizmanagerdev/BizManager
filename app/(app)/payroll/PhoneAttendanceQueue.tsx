"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Clock, Plus, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WORK_SESSION_BUSINESS_DOMAINS } from "@/lib/expenses";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import type { OpenPhoneReport, PendingPhoneReport } from "@/lib/attendance/phone-reports";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";

type Props = {
  pending: PendingPhoneReport[];
  open: OpenPhoneReport[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
};

/** Hebrew weekday ("יום ראשון" …) of a timestamp, in Israel time. */
function hebrewWeekday(iso: string) {
  return new Intl.DateTimeFormat("he-IL", { weekday: "long", timeZone: "Asia/Jerusalem" }).format(new Date(iso));
}

/**
 * Slim top bar for phone attendance. Collapsed by default so it never takes over the page — click to
 * expand into two groups: workers currently clocked in (open), and clocked-out reports waiting for an
 * admin to classify + approve them into real sessions.
 */
export default function PhoneAttendanceQueue({ pending, open, projectOptions, propertyOptions }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (pending.length === 0 && open.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-secondary/30 bg-secondary/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-secondary">
          {pending.length > 0 ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold text-secondary-foreground">
              {pending.length}
            </span>
          ) : null}
          נוכחות טלפונית
          {open.length > 0 ? <Badge variant="success">{open.length} נוכחים כעת</Badge> : null}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-secondary transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded ? (
        <div className="space-y-4 border-t border-secondary/20 bg-background p-3">
          {open.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">נוכחים כעת</h3>
              <div className="space-y-2">
                {open.map((report) => (
                  <OpenRow key={report.id} report={report} />
                ))}
              </div>
            </section>
          ) : null}
          {pending.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground">ממתינים לאישור</h3>
              <div className="space-y-3">
                {pending.map((report) => (
                  <ReportCard key={report.id} report={report} projectOptions={projectOptions} propertyOptions={propertyOptions} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A worker currently clocked in (open shift) — read-only until they clock out. */
function OpenRow({ report }: { report: OpenPhoneReport }) {
  const elapsed = minutesBetween(report.clock_in, new Date());
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">נוכח</Badge>
          <span className="font-semibold">{report.worker_name ?? "עובד לא ידוע"}</span>
          {report.worker_phone ? <span className="text-sm text-muted-foreground">{report.worker_phone}</span> : null}
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{hebrewWeekday(report.clock_in)}</span> · נכנס {formatShortDateTime(report.clock_in)}
        </div>
      </div>
      <span className="whitespace-nowrap text-sm font-medium text-muted-foreground">כבר {formatMinutes(elapsed)} ש׳</span>
    </div>
  );
}

type PartDraft = {
  id: string;
  domain: string;
  projectId: string;
  propertyId: string;
  billable: boolean;
  billAmount: string;
  hours: string; // split duration for this part (ignored for the last / only part)
};

function blankPart(): PartDraft {
  return { id: `p-${Math.random().toString(36).slice(2, 8)}`, domain: "", projectId: "", propertyId: "", billable: false, billAmount: "", hours: "" };
}

function ReportCard({
  report,
  projectOptions,
  propertyOptions,
}: {
  report: PendingPhoneReport;
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [parts, setParts] = useState<PartDraft[]>([blankPart()]);
  const [error, setError] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const totalMinutes = report.worked_minutes ?? minutesBetween(report.clock_in, report.clock_out);
  const split = parts.length > 1;
  const canSplit = totalMinutes >= 2;
  const weekday = hebrewWeekday(report.clock_in);

  const projectSelectOptions = useMemo(() => projectOptions.map((o) => ({ value: o.id, label: o.label })), [projectOptions]);
  const propertySelectOptions = useMemo(() => propertyOptions.map((o) => ({ value: o.id, label: o.label })), [propertyOptions]);

  // Minutes for each non-last part (from its hours field); the last part gets the remainder.
  const nonLastMinutes = parts.slice(0, -1).map((p) => Math.round((Number(p.hours) || 0) * 60));
  const remainderMinutes = totalMinutes - nonLastMinutes.reduce((a, b) => a + b, 0);
  const overAllocated = split && remainderMinutes <= 0;

  function updatePart(index: number, patch: Partial<PartDraft>) {
    setError("");
    setParts((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }
  function addPart() {
    setError("");
    setParts((current) => [...current, blankPart()]);
  }
  function removePart(index: number) {
    setError("");
    setParts((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));
  }

  function approve() {
    setError("");
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i];
      const label = split ? ` (חלק ${i + 1})` : "";
      if (!p.domain) return setError(`יש לבחור תחום עסקי${label}.`);
      if (p.domain === "logistics_projects" && !p.projectId) return setError(`יש לבחור פרויקט${label}.`);
      if (p.domain === "property_management" && !p.propertyId) return setError(`יש לבחור נכס${label}.`);
      if (p.domain === "logistics_projects" && p.billable) {
        const amount = Number(p.billAmount);
        if (!p.billAmount.trim() || !Number.isFinite(amount) || amount <= 0) return setError(`יש להזין סכום חיוב ללקוח תקין${label}.`);
      }
      if (split && i < parts.length - 1 && !(Number(p.hours) > 0)) return setError(`יש להזין משך תקין${label}.`);
    }
    if (overAllocated) return setError("סכום החלקים חורג ממשך המשמרת — צמצם את החלקים.");

    const payloadParts = parts.map((p, i) => ({
      business_domain: p.domain,
      project_id: p.domain === "logistics_projects" ? p.projectId : null,
      property_id: p.domain === "property_management" ? p.propertyId : null,
      is_billable_to_customer: p.domain === "logistics_projects" && p.billable,
      bill_to_customer_amount: p.domain === "logistics_projects" && p.billable ? Number(p.billAmount) : null,
      minutes: split && i < parts.length - 1 ? nonLastMinutes[i] : undefined,
    }));

    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id, parts: payloadParts }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setError(toHebrewError(json.error, "אישור הדיווח נכשל."));
        toast.success(split ? "הדיווח אושר ופוצל למשמרות." : "הדיווח אושר ונרשם כמשמרת.");
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "אישור הדיווח נכשל."));
      }
    });
  }

  function reject() {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/reject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ report_id: report.id, reason: rejectReason.trim() || null }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        setRejectOpen(false);
        if (!response.ok) return setError(toHebrewError(json.error, "דחיית הדיווח נכשלה."));
        toast.success("הדיווח נדחה.");
        router.refresh();
      } catch (err: unknown) {
        setRejectOpen(false);
        setError(toHebrewError(err, "דחיית הדיווח נכשלה."));
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      {/* Header: worker + duration */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-semibold">{report.worker_name ?? "עובד לא ידוע"}</span>
          {report.worker_phone ? <span className="mr-2 text-sm text-muted-foreground">{report.worker_phone}</span> : null}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-sm font-medium text-secondary">
          <Clock className="h-3.5 w-3.5" />
          {formatMinutes(totalMinutes)} שעות
        </span>
      </div>
      <div className="mt-0.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{weekday}</span> · {formatShortDateTime(report.clock_in)} — {formatShortDateTime(report.clock_out)}
      </div>

      {/* Classification */}
      <div className="mt-3 space-y-2">
        {parts.map((part, index) => {
          const isLast = index === parts.length - 1;
          return (
            <div key={part.id} className={cn("space-y-2", split && "rounded-md border border-border/70 bg-muted/30 p-2")}>
              {split ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">חלק {index + 1}</span>
                  <div className="flex items-center gap-1.5">
                    {isLast ? (
                      <span className={cn("text-sm", overAllocated ? "font-medium text-destructive" : "text-muted-foreground")}>
                        {overAllocated ? "חריגה — צמצם" : `יתרה ${formatMinutes(remainderMinutes)} ש׳`}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Input
                          value={part.hours}
                          onChange={(e) => updatePart(index, { hours: e.target.value })}
                          inputMode="decimal"
                          placeholder="0"
                          className="h-8 w-16 text-center"
                          aria-label={`משך חלק ${index + 1} בשעות`}
                        />
                        <span className="text-sm text-muted-foreground">ש׳</span>
                      </span>
                    )}
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePart(index)} aria-label="הסרת חלק">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-[9rem] flex-1">
                  <DomainSelect
                    value={part.domain}
                    onChange={(next) => updatePart(index, { domain: next, projectId: "", propertyId: "", billable: false, billAmount: "" })}
                    domains={WORK_SESSION_BUSINESS_DOMAINS}
                    placeholder="בחירת תחום"
                    ariaLabel="תחום עסקי"
                  />
                </div>
                {part.domain === "logistics_projects" ? (
                  <div className="min-w-[11rem] flex-1">
                    <SearchableSelect
                      options={projectSelectOptions}
                      value={part.projectId}
                      onChange={(v) => updatePart(index, { projectId: v })}
                      placeholder="בחירת פרויקט"
                      ariaLabel="פרויקט"
                    />
                  </div>
                ) : null}
                {part.domain === "property_management" ? (
                  <div className="min-w-[11rem] flex-1">
                    <SearchableSelect
                      options={propertySelectOptions}
                      value={part.propertyId}
                      onChange={(v) => updatePart(index, { propertyId: v })}
                      placeholder="בחירת נכס"
                      ariaLabel="נכס"
                    />
                  </div>
                ) : null}
              </div>

              {/* Bill to customer — only for project work. */}
              {part.domain === "logistics_projects" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <NativeSelect
                    value={part.billable ? "yes" : "no"}
                    onChange={(e) => updatePart(index, { billable: e.target.value === "yes", billAmount: "" })}
                    aria-label="חיוב ללקוח"
                    className="h-9 w-36"
                  >
                    <option value="no">ללא חיוב ללקוח</option>
                    <option value="yes">חיוב ללקוח</option>
                  </NativeSelect>
                  {part.billable ? (
                    <CurrencyInput
                      value={part.billAmount}
                      onChange={(e) => updatePart(index, { billAmount: e.target.value })}
                      placeholder="סכום לחיוב"
                      containerClassName="w-32"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {canSplit ? (
          <Button type="button" variant="ghost" size="sm" className="text-secondary" onClick={addPart}>
            {split ? <Plus className="ml-1 h-4 w-4" /> : <Scissors className="ml-1 h-4 w-4" />}
            {split ? "הוסף תחום" : "פיצול לתחומים"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button type="button" variant="destructive" onClick={() => setRejectOpen(true)} disabled={isPending}>
            דחייה
          </Button>
          <Button type="button" onClick={approve} disabled={isPending}>
            {isPending ? "..." : "אישור"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="דחיית דיווח נוכחות"
        description="הדיווח יידחה ולא ייכנס כמשמרת. אפשר לרשום סיבה (לא חובה)."
        confirmLabel="דחה דיווח"
        destructive
        loading={isPending}
        onConfirm={reject}
      >
        <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="סיבת הדחייה" rows={2} />
      </ConfirmDialog>
    </div>
  );
}
