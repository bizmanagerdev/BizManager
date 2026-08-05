"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { WORK_SESSION_BUSINESS_DOMAINS } from "@/lib/expenses";
import { formatMinutes, minutesBetween } from "@/lib/payroll";
import { formatShortDateTime } from "@/lib/date";
import { toHebrewError } from "@/lib/error-messages";
import type { PendingPhoneReport } from "@/lib/attendance/phone-reports";
import type { SalaryCenterProjectOption } from "@/lib/payroll-center";

type Props = {
  reports: PendingPhoneReport[];
  projectOptions: SalaryCenterProjectOption[];
  propertyOptions: SalaryCenterProjectOption[];
};

/**
 * Payroll queue for phone clock-ins/outs waiting on an admin. Each report is classified to a
 * business domain and approved into a real session, or rejected. Hidden entirely when empty.
 */
export default function PhoneAttendanceQueue({ reports, projectOptions, propertyOptions }: Props) {
  if (reports.length === 0) return null;

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">דיווחי נוכחות טלפוניים ממתינים לאישור</h2>
          <span className="rounded-full bg-secondary/10 px-2.5 py-0.5 text-sm font-medium text-secondary">
            {reports.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          כל דיווח שהתקבל בטלפון ממתין לשיוך תחום ולאישור לפני שייכנס כמשמרת בפועל.
        </p>
        <ul className="space-y-3">
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              projectOptions={projectOptions}
              propertyOptions={propertyOptions}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ReportRow({
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
  const [domain, setDomain] = useState("");
  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const workedMinutes = report.worked_minutes ?? minutesBetween(report.clock_in, report.clock_out);
  const needsProject = domain === "logistics_projects";
  const needsProperty = domain === "property_management";

  const projectSelectOptions = projectOptions.map((option) => ({ value: option.id, label: option.label }));
  const propertySelectOptions = propertyOptions.map((option) => ({ value: option.id, label: option.label }));

  function approve() {
    setError("");
    if (!domain) {
      setError("יש לבחור תחום עסקי.");
      return;
    }
    if (needsProject && !projectId) {
      setError("יש לבחור פרויקט.");
      return;
    }
    if (needsProperty && !propertyId) {
      setError("יש לבחור נכס.");
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch("/api/attendance/phone-reports/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            report_id: report.id,
            business_domain: domain,
            project_id: needsProject ? projectId : null,
            property_id: needsProperty ? propertyId : null,
          }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setError(toHebrewError(json.error, "אישור הדיווח נכשל."));
          return;
        }
        toast.success("הדיווח אושר ונרשם כמשמרת.");
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
        if (!response.ok) {
          setError(toHebrewError(json.error, "דחיית הדיווח נכשלה."));
          setRejectOpen(false);
          return;
        }
        setRejectOpen(false);
        toast.success("הדיווח נדחה.");
        router.refresh();
      } catch (err: unknown) {
        setError(toHebrewError(err, "דחיית הדיווח נכשלה."));
        setRejectOpen(false);
      }
    });
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="font-medium">
          {report.worker_name ?? "עובד לא ידוע"}
          {report.worker_phone ? <span className="mr-2 text-sm text-muted-foreground">{report.worker_phone}</span> : null}
        </div>
        <div className="text-sm font-medium text-secondary">{formatMinutes(workedMinutes)} שעות</div>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {formatShortDateTime(report.clock_in)} — {formatShortDateTime(report.clock_out)}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1">
          <DomainSelect
            value={domain}
            onChange={(next) => {
              setDomain(next);
              setProjectId("");
              setPropertyId("");
              setError("");
            }}
            domains={WORK_SESSION_BUSINESS_DOMAINS}
            placeholder="בחירת תחום"
            ariaLabel="תחום עסקי"
          />
        </div>
        {needsProject ? (
          <div className="min-w-[12rem] flex-1">
            <SearchableSelect
              options={projectSelectOptions}
              value={projectId}
              onChange={setProjectId}
              placeholder="בחירת פרויקט"
              ariaLabel="פרויקט"
            />
          </div>
        ) : null}
        {needsProperty ? (
          <div className="min-w-[12rem] flex-1">
            <SearchableSelect
              options={propertySelectOptions}
              value={propertyId}
              onChange={setPropertyId}
              placeholder="בחירת נכס"
              ariaLabel="נכס"
            />
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" onClick={approve} disabled={isPending}>
          {isPending ? "..." : "אישור"}
        </Button>
        <Button type="button" variant="destructive" onClick={() => setRejectOpen(true)} disabled={isPending}>
          דחייה
        </Button>
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
        <Textarea
          value={rejectReason}
          onChange={(event) => setRejectReason(event.target.value)}
          placeholder="סיבת הדחייה"
          rows={2}
        />
      </ConfirmDialog>
    </li>
  );
}
