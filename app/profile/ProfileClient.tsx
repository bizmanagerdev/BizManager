"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UserProfile } from "@/lib/auth/requireProfile";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel, type ExpenseBusinessDomain } from "@/lib/expenses";
import { shouldShowSessionHours } from "@/lib/payroll-worker-type";
import {
  calculateSessionLaborCost,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatMinutes,
  getCurrentSalaryAgreement,
  getNextMonthDueText,
  getPayrollStatusLabel,
  getSalaryTypeLabel,
  monthKeyFromDate,
  sessionWorkedMinutes,
  toNumber,
  type MonthlyHoursSummary,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";

type Props = {
  profile: UserProfile;
  sessions: WorkSessionRow[];
  agreements: SalaryAgreementRow[];
  payslips: PayslipRow[];
  periods: PayrollPeriodRow[];
  monthlySummaries: MonthlyHoursSummary[];
  projectOptions: Array<{ id: string; label: string }>;
  propertyOptions: Array<{ id: string; label: string }>;
};

type SplitPartDraft = { id: string; minutes: string; domain: ExpenseBusinessDomain; projectId: string; propertyId: string };

function toLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function nowLocal(offsetMinutes = 0) {
  const value = new Date();
  value.setSeconds(0, 0);
  value.setMinutes(value.getMinutes() + offsetMinutes);
  return toLocalValue(value.toISOString());
}
function toIso(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toLocalDateTimeValue(date: Date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

export default function ProfileClient({ profile, sessions, agreements, payslips, periods, monthlySummaries, projectOptions, propertyOptions }: Props) {
  const router = useRouter();
  const splitPartIdRef = useRef(0);
  const [isPending, startTransition] = useTransition();
  const [sessionNote, setSessionNote] = useState("");
  const [sessionDomain, setSessionDomain] = useState<ExpenseBusinessDomain>("general_business");
  const [actionError, setActionError] = useState("");
  const [sessionEditorId, setSessionEditorId] = useState("");
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const [sessionEditDomain, setSessionEditDomain] = useState<ExpenseBusinessDomain>("general_business");
  const [sessionEditProjectId, setSessionEditProjectId] = useState("");
  const [sessionEditPropertyId, setSessionEditPropertyId] = useState("");
  const [sessionEditNotes, setSessionEditNotes] = useState("");
  const [sessionEditClockIn, setSessionEditClockIn] = useState("");
  const [sessionEditClockOut, setSessionEditClockOut] = useState("");
  const [splitParts, setSplitParts] = useState<SplitPartDraft[]>([]);
  const [selectedMonth, setSelectedMonth] = useState(monthlySummaries[0]?.key ?? monthKeyFromDate(new Date()));

  const openSession = useMemo(() => sessions.find((session) => !session.clock_out) ?? null, [sessions]);
  const currentAgreement = useMemo(() => getCurrentSalaryAgreement(agreements), [agreements]);
  const showSessionTimingForProfile = shouldShowSessionHours(profile.payroll_worker_type);
  const sessionEditDateOnly = (() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(sessionEditClockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  })();
  const periodsById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  const selectedMonthSummary = monthlySummaries.find((summary) => summary.key === selectedMonth) ?? monthlySummaries[0] ?? null;
  const selectedMonthSessions = useMemo(() => sessions.filter((session) => monthKeyFromDate(session.clock_in) === selectedMonth), [selectedMonth, sessions]);
  const latestPayslip = useMemo(() => [...payslips].sort((a, b) => (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(periodsById.get(a.payroll_period_id)?.period_month ?? ""))[0] ?? null, [payslips, periodsById]);
  const latestPeriod = latestPayslip ? periodsById.get(latestPayslip.payroll_period_id) ?? null : null;
  const editorSession = useMemo(() => sessions.find((session) => session.id === sessionEditorId) ?? null, [sessionEditorId, sessions]);

  function createSplitPart(domain: ExpenseBusinessDomain, overrides?: Partial<Omit<SplitPartDraft, "id" | "domain">>): SplitPartDraft {
    splitPartIdRef.current += 1;
    return { id: `part-${splitPartIdRef.current}`, minutes: overrides?.minutes ?? "", domain, projectId: overrides?.projectId ?? "", propertyId: overrides?.propertyId ?? "" };
  }
  function clearEditor() {
    setSessionEditorId("");
    setManualEditorOpen(false);
    setSessionEditDomain("general_business");
    setSessionEditProjectId("");
    setSessionEditPropertyId("");
    setSessionEditNotes("");
    setSessionEditClockIn("");
    setSessionEditClockOut("");
    setSplitParts([]);
  }
  function setEditorDomain(next: ExpenseBusinessDomain) {
    setSessionEditDomain(next);
    if (next !== "logistics_projects") setSessionEditProjectId("");
    if (next !== "property_management") setSessionEditPropertyId("");
  }
  function formError(requireClockOut: boolean) {
    if (!sessionEditClockIn) return "יש להזין שעת התחלה.";
    if (requireClockOut && !sessionEditClockOut) return "יש להזין שעת סיום.";
    const clockInIso = toIso(sessionEditClockIn);
    const clockOutIso = sessionEditClockOut ? toIso(sessionEditClockOut) : "";
    if (!clockInIso) return "שעת ההתחלה לא תקינה.";
    if (sessionEditClockOut && !clockOutIso) return "שעת הסיום לא תקינה.";
    if (clockOutIso && new Date(clockOutIso) <= new Date(clockInIso)) return "שעת הסיום חייבת להיות אחרי שעת ההתחלה.";
    if (sessionEditDomain === "logistics_projects" && !sessionEditProjectId) return "יש לבחור פרויקט.";
    if (sessionEditDomain === "property_management" && !sessionEditPropertyId) return "יש לבחור נכס.";
    return "";
  }
  function editedDuration() {
    const start = toIso(sessionEditClockIn);
    const end = sessionEditClockOut ? toIso(sessionEditClockOut) : "";
    if (!start || !end) return "";
    const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    return minutes > 0 ? formatMinutes(minutes) : "";
  }

  async function postSessionAction(url: string) {
    setActionError("");
    startTransition(async () => {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: sessionNote.trim() || null, business_domain: sessionDomain }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(json.error ?? "הפעולה נכשלה.");
        setSessionNote("");
        setSessionDomain("general_business");
        router.refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }
  async function deleteSession(sessionId: string) {
    setActionError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(json.error ?? "מחיקת המשמרת נכשלה.");
        router.refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }
  function openSessionEditor(session: WorkSessionRow) {
    const totalMinutes = sessionWorkedMinutes(session);
    const currentDomain = EXPENSE_BUSINESS_DOMAINS.includes(session.business_domain as ExpenseBusinessDomain) ? (session.business_domain as ExpenseBusinessDomain) : "general_business";
    setManualEditorOpen(false);
    setSessionEditorId(session.id);
    setSessionEditDomain(currentDomain);
    setSessionEditProjectId(session.project_id ?? "");
    setSessionEditPropertyId(session.property_id ?? "");
    setSessionEditNotes(session.notes ?? "");
    setSessionEditClockIn(toLocalValue(session.clock_in));
    setSessionEditClockOut(toLocalValue(session.clock_out));
    setSplitParts(session.clock_out ? [createSplitPart(currentDomain, { minutes: String(Math.max(1, Math.floor(totalMinutes / 2))), projectId: session.project_id ?? "", propertyId: session.property_id ?? "" }), createSplitPart(currentDomain, { projectId: session.project_id ?? "", propertyId: session.property_id ?? "" })] : []);
    setActionError("");
  }
  function openManualEditor() {
    setActionError("");
    setSessionEditorId("");
    setManualEditorOpen(true);
    setSessionEditDomain("general_business");
    setSessionEditProjectId("");
    setSessionEditPropertyId("");
    setSessionEditNotes("");
    setSessionEditClockIn(nowLocal(-60));
    setSessionEditClockOut(nowLocal());
    setSplitParts([]);
  }
  function closeEditor() {
    setActionError("");
    clearEditor();
  }
  async function saveSessionEdits(sessionId: string) {
    const error = formError(Boolean(editorSession?.clock_out));
    if (error) return setActionError(error);
    if (!profile.id) return setActionError("לא נמצא עובד לשמירת המשמרת.");
    setActionError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, business_domain: sessionEditDomain, project_id: sessionEditProjectId || null, property_id: sessionEditPropertyId || null, notes: sessionEditNotes.trim() || null, clock_in: toIso(sessionEditClockIn), clock_out: sessionEditClockOut ? toIso(sessionEditClockOut) : null }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(json.error ?? "עדכון המשמרת נכשל.");
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }
  async function createManualSession() {
    const error = formError(true);
    if (error) return setActionError(error);
    setActionError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: profile.id, business_domain: sessionEditDomain, project_id: sessionEditProjectId || null, property_id: sessionEditPropertyId || null, notes: sessionEditNotes.trim() || null, clock_in: toIso(sessionEditClockIn), clock_out: toIso(sessionEditClockOut) }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(json.error ?? "יצירת המשמרת נכשלה.");
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }
  function updateSplitPart(partId: string, changes: Partial<Omit<SplitPartDraft, "id">>) {
    setSplitParts((current) => current.map((part) => {
      if (part.id !== partId) return part;
      const next = { ...part, ...changes };
      if (changes.domain && changes.domain !== "logistics_projects") next.projectId = "";
      if (changes.domain && changes.domain !== "property_management") next.propertyId = "";
      return next;
    }));
  }
  function updateSplitMinutes(partId: string, rawMinutes: string, totalMinutes: number) {
    setSplitParts((current) => {
      const index = current.findIndex((part) => part.id === partId);
      if (index < 0) return current;
      const maxForPart = Math.max(1, totalMinutes - (current.length - index - 1));
      const trimmed = rawMinutes.trim();
      if (trimmed === "") return current.map((part) => part.id === partId ? { ...part, minutes: "" } : part);
      const parsed = Math.floor(Number(trimmed));
      const clamped = Number.isFinite(parsed) ? Math.max(1, Math.min(maxForPart, parsed)) : 1;
      return current.map((part) => part.id === partId ? { ...part, minutes: String(clamped) } : part);
    });
  }
  function addSplitPart(defaultDomain: ExpenseBusinessDomain, totalMinutes: number) {
    setSplitParts((current) => current.length >= Math.min(5, totalMinutes) ? current : [...current, createSplitPart(defaultDomain)]);
  }
  function removeSplitPart(partId: string) {
    setSplitParts((current) => current.length <= 2 ? current : current.filter((part) => part.id !== partId));
  }
  function splitPreview(session: WorkSessionRow) {
    const total = sessionWorkedMinutes(session);
    let consumed = 0;
    return splitParts.map((part, index) => {
      const isLast = index === splitParts.length - 1;
      const requested = Math.max(0, Number(part.minutes) || 0);
      const minutes = isLast ? Math.max(0, total - consumed) : Math.max(0, Math.min(total - consumed, requested));
      consumed += minutes;
      return { ...part, minutes };
    });
  }
  function splitError(session: WorkSessionRow) {
    const totalMinutes = sessionWorkedMinutes(session);
    if (splitParts.length < 2) return "צריך לפחות שני חלקים.";
    if (splitParts.length > Math.min(5, totalMinutes)) return "אי אפשר לפצל ליותר חלקים ממספר הדקות במשמרת.";
    let consumed = 0;
    for (let index = 0; index < splitParts.length; index += 1) {
      const part = splitParts[index];
      const isLast = index === splitParts.length - 1;
      const remainingParts = splitParts.length - index - 1;
      if (!isLast) {
        const minutes = Math.floor(Number(part.minutes));
        if (!Number.isFinite(minutes) || minutes <= 0) return `יש להזין מספר דקות תקין בחלק ${index + 1}.`;
        if (consumed + minutes > totalMinutes - remainingParts) return "סכום הדקות גדול ממשך המשמרת.";
        consumed += minutes;
      } else if (totalMinutes - consumed <= 0) return "לא נשאר זמן לחלק האחרון.";
      if (part.domain === "logistics_projects" && !part.projectId) return `יש לבחור פרויקט בחלק ${index + 1}.`;
      if (part.domain === "property_management" && !part.propertyId) return `יש לבחור נכס בחלק ${index + 1}.`;
    }
    return "";
  }
  async function splitSavedSession(sessionId: string) {
    if (!editorSession || !editorSession.clock_out) return;
    const error = splitError(editorSession);
    if (error) return setActionError(error);
    setActionError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile/session/split", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, parts: splitParts.map((part) => ({ minutes: part.minutes, business_domain: part.domain, project_id: part.projectId || null, property_id: part.propertyId || null })) }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(json.error ?? "פיצול המשמרת נכשל.");
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(error instanceof Error ? error.message : "Unknown error");
      }
    });
  }
  function linkField(label: string, value: string, onChange: (value: string) => void, options: Array<{ id: string; label: string }>, compact = false) {
    return (
      <label className="space-y-1 text-right">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <select className={`rounded-md border border-input bg-background px-3 text-right text-sm ${compact ? "h-9 w-44" : "h-10 w-full"}`} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">בחירה</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  function renderEditor(session: WorkSessionRow | null) {
    const isManual = session === null;
    const saveError = formError(isManual || Boolean(session?.clock_out));
    const duration = editedDuration();
    const currentSplitError = session?.clock_out ? splitError(session) : "";
    const editedMinutes = (() => {
      const start = toIso(sessionEditClockIn);
      const end = sessionEditClockOut ? toIso(sessionEditClockOut) : "";
      if (!start || !end) return 0;
      const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
      return minutes > 0 ? minutes : 0;
    })();
    const editedDurationHours = editedMinutes > 0
      ? (() => {
          const hours = editedMinutes / 60;
          return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
        })()
      : "";
    const suggestedAmount = (() => {
      const reference = toIso(sessionEditClockIn);
      if (!reference || editedMinutes <= 0) return null;
      const agreement = getCurrentSalaryAgreement(agreements, new Date(reference));
      return calculateSessionLaborCost(agreement, editedMinutes);
    })();
    return (
      <div dir="rtl" className="space-y-4 text-right">
        <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
          <div className="font-medium">{isManual ? "משמרת ידנית" : "עריכת משמרת"}</div>
          <div className="flex flex-row-reverse flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending || Boolean(saveError)} onClick={() => isManual ? void createManualSession() : void saveSessionEdits(session.id)}>{isManual ? "שמירת משמרת" : "שמירת שינויים"}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>סגור</Button>
          </div>
        </div>
        {showSessionTimingForProfile ? (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">שעת התחלה</span><DateTimeInput value={sessionEditClockIn} onChange={(event) => setSessionEditClockIn(event.target.value)} /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">סה״כ שעות</span><Input inputMode="decimal" className="text-right" value={editedDurationHours} onChange={(event) => {
              const nextValue = event.target.value;
              if (!nextValue.trim()) {
                setSessionEditClockOut("");
                return;
              }
              const parsedHours = Number(nextValue);
              const start = toIso(sessionEditClockIn);
              if (!start || !Number.isFinite(parsedHours) || parsedHours <= 0) return;
              const nextClockOut = new Date(new Date(start).getTime() + parsedHours * 60 * 60 * 1000);
              if (Number.isNaN(nextClockOut.getTime())) return;
              setSessionEditClockOut(toLocalDateTimeValue(nextClockOut));
            }} placeholder="למשל 8" /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">שעת סיום</span><DateTimeInput value={sessionEditClockOut} onChange={(event) => setSessionEditClockOut(event.target.value)} /></label>
          </div>
        ) : (
          <label className="space-y-1 block"><span className="block text-xs text-muted-foreground">תאריך</span><DateInput value={sessionEditDateOnly} onChange={(event) => {
            const next = event.target.value;
            if (!next) return;
            setSessionEditClockIn(`${next}T09:00`);
            setSessionEditClockOut(`${next}T10:00`);
          }} /></label>
        )}
        <div className="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">תחום</span><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-right text-sm" value={sessionEditDomain} onChange={(event) => setEditorDomain(event.target.value as ExpenseBusinessDomain)}>{EXPENSE_BUSINESS_DOMAINS.map((domain) => <option key={domain} value={domain}>{getBusinessDomainLabel(domain)}</option>)}</select></label>
          {sessionEditDomain === "logistics_projects" ? linkField("פרויקט", sessionEditProjectId, setSessionEditProjectId, projectOptions) : sessionEditDomain === "property_management" ? linkField("נכס", sessionEditPropertyId, setSessionEditPropertyId, propertyOptions) : <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">אין צורך בבחירה נוספת.</div>}
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">הערות</span><textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-right text-sm outline-none" value={sessionEditNotes} onChange={(event) => setSessionEditNotes(event.target.value)} /></label>
        </div>
        <div className="flex flex-row-reverse flex-wrap gap-3 text-xs text-muted-foreground">{duration ? <div className="rounded-full border px-3 py-1">משך: {duration}</div> : null}{session?.clock_out ? <div className="rounded-full border px-3 py-1">משך מקורי: {formatMinutes(sessionWorkedMinutes(session))}</div> : null}{suggestedAmount !== null ? <div className="rounded-full border px-3 py-1">{`מגיע לפי המשמרת: ${formatCurrency(suggestedAmount)}`}</div> : null}</div>
        {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
        {session?.clock_out ? <div className="space-y-3 border-t pt-4">
          <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
            <div className="font-medium">פיצול משמרת</div>
            <div className="flex flex-row-reverse flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={splitParts.length >= Math.min(5, sessionWorkedMinutes(session))} onClick={() => addSplitPart(sessionEditDomain, sessionWorkedMinutes(session))}>הוספת חלק</Button>
              <Button type="button" size="sm" disabled={isPending || Boolean(currentSplitError)} onClick={() => void splitSavedSession(session.id)}>שמירת פיצול</Button>
            </div>
          </div>
          <div className="space-y-3">{splitPreview(session).map((part, index) => {
            const isLast = index === splitParts.length - 1;
            return <div key={part.id} className="rounded-xl border bg-background/70 p-3">
              <div className="mb-2 flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium">חלק {index + 1}</div>
                <div className="flex flex-row-reverse flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{formatMinutes(part.minutes)}</span>{!isLast && splitParts.length > 2 ? <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => removeSplitPart(part.id)}>הסרה</Button> : null}</div>
              </div>
              <div className="flex flex-row-reverse flex-wrap items-end justify-end gap-2">
                {!isLast ? <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">דקות</span><Input type="number" min="1" className="h-9 w-24 text-right" value={splitParts[index]?.minutes ?? ""} onChange={(event) => updateSplitMinutes(part.id, event.target.value, sessionWorkedMinutes(session))} /></label> : <div className="min-w-20 rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">יתרה</div>}
                <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">תחום</span><select className="h-9 w-40 rounded-md border border-input bg-background px-3 text-right text-sm" value={splitParts[index]?.domain ?? "general_business"} onChange={(event) => updateSplitPart(part.id, { domain: event.target.value as ExpenseBusinessDomain })}>{EXPENSE_BUSINESS_DOMAINS.map((domain) => <option key={domain} value={domain}>{getBusinessDomainLabel(domain)}</option>)}</select></label>
                {splitParts[index]?.domain === "logistics_projects" ? linkField("פרויקט", splitParts[index]?.projectId ?? "", (value) => updateSplitPart(part.id, { projectId: value }), projectOptions, true) : null}
                {splitParts[index]?.domain === "property_management" ? linkField("נכס", splitParts[index]?.propertyId ?? "", (value) => updateSplitPart(part.id, { propertyId: value }), propertyOptions, true) : null}
              </div>
            </div>;
          })}</div>
          {currentSplitError ? <div className="text-sm text-destructive">{currentSplitError}</div> : null}
        </div> : null}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="סטטוס נוכחי" value={openSession ? "במשמרת" : "לא במשמרת"} hint={openSession ? `נכנסת ב-${formatDateTime(openSession.clock_in)}` : "אין משמרת פתוחה כרגע"} />
        <SummaryCard title="שעות החודש" value={selectedMonthSummary ? formatMinutes(selectedMonthSummary.totalMinutes) : "0:00"} hint={selectedMonthSummary ? selectedMonthSummary.label : "אין שעות מדווחות"} />
<SummaryCard title="שכר נוכחי" value={currentAgreement ? currentAgreement.salary_type === "hourly" ? `${formatCurrency(currentAgreement.hourly_rate)} לשעה` : formatCurrency(currentAgreement.monthly_salary) : "-"} hint={currentAgreement ? `סוג שכר: ${getSalaryTypeLabel(currentAgreement.salary_type)}` : "אין משכורת פעילה"} />
        <SummaryCard title="תלוש אחרון" value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"} hint={latestPeriod ? `${latestPeriod.period_month} • ${getPayrollStatusLabel(latestPeriod.status)}` : "אין תלושים זמינים"} />
      </div>

      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-col items-center gap-4 text-center">
            <div><div className="text-lg font-semibold">{profile.full_name ?? profile.email ?? "עובד"}</div><div className="text-sm text-muted-foreground">{profile.email ?? "-"} | {profile.phone ?? "-"}</div></div>
            <div className="flex flex-wrap justify-center gap-3">
              <Button size="lg" className="min-w-40" disabled={Boolean(openSession) || isPending} onClick={() => void postSessionAction("/api/profile/session/start")}>פתיחת משמרת</Button>
              <Button size="lg" className="min-w-40" disabled={!openSession || isPending} onClick={() => void postSessionAction("/api/profile/session/end")}>סיום משמרת</Button>
            </div>
          </div>
          {openSession ? <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <Input value={sessionNote} onChange={(event) => setSessionNote(event.target.value)} placeholder="הערות למשמרת" />
            <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={sessionDomain} onChange={(event) => setSessionDomain(event.target.value as ExpenseBusinessDomain)}>
              {EXPENSE_BUSINESS_DOMAINS.map((domain) => <option key={domain} value={domain}>{getBusinessDomainLabel(domain)}</option>)}
            </select>
            <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">{`זמן פתיחה: ${formatDateTime(openSession.clock_in)}`}</div>
          </div> : null}
          {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">סיכום חודשי</TabsTrigger>
          <TabsTrigger value="salary">שכר והיסטוריה</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Card>
            <CardContent className="space-y-4 py-5 text-right">
              <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" onClick={openManualEditor}>הוספת משמרת ידנית</Button>
                <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                  {monthlySummaries.map((summary) => <option key={summary.key} value={summary.key}>{summary.label}</option>)}
                </select>
              </div>
              {selectedMonthSummary ? <div className="grid gap-3 md:grid-cols-3">
                <StatCard label='סה"כ שעות' value={formatMinutes(selectedMonthSummary.totalMinutes)} />
                <StatCard label="כמות משמרות" value={`${selectedMonthSummary.sessionCount}`} />
                <StatCard label="משמרות פתוחות" value={`${selectedMonthSummary.openSessionCount}`} />
              </div> : <div className="text-sm text-muted-foreground">עדיין אין נתוני שעות.</div>}
              <div className="space-y-3 text-right">
                {selectedMonthSessions.length === 0 ? <div className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">אין עדיין משמרות בחודש הזה.</div> : selectedMonthSessions.map((session) => <div key={session.id} className="rounded-2xl border p-4 text-sm text-right">
                  <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                    {showSessionTimingForProfile ? (
                      <div className="text-base font-semibold">{formatMinutes(sessionWorkedMinutes(session))}</div>
                    ) : null}
                    <div className="font-medium">
                      {showSessionTimingForProfile
                        ? `${formatDateTime(session.clock_in)} ${session.clock_out ? `- ${formatDateTime(session.clock_out)}` : "- פתוח"}`
                        : formatDate(session.clock_in)}
                    </div>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    תחום: {getBusinessDomainLabel(session.business_domain)}
                    {showSessionTimingForProfile ? ` | יציאה: ${formatDateTime(session.clock_out)}` : ""}
                  </div>
                  {session.notes ? <div className="mt-2 text-muted-foreground">{session.notes}</div> : null}
                  <div className="mt-3 flex flex-row-reverse flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openSessionEditor(session)}>עריכת משמרת</Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => {
                        if (!confirm("למחוק את המשמרת הזו?")) return;
                        void deleteSession(session.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      מחיקה
                    </Button>
                  </div>
                </div>)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="salary">
          <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
            <Card><CardContent className="space-y-3 py-5"><div className="text-lg font-semibold">היסטוריית שכר</div>{agreements.length === 0 ? <div className="text-sm text-muted-foreground">אין היסטוריית שכר זמינה.</div> : agreements.map((agreement) => <div key={agreement.id} className="rounded-2xl border p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</div><div className="text-base font-semibold">{agreement.salary_type === "hourly" ? `${formatCurrency(agreement.hourly_rate)} לשעה` : formatCurrency(agreement.monthly_salary)}</div></div><div className="mt-2 text-muted-foreground">בתוקף: {formatDate(agreement.valid_from)} - {formatDate(agreement.valid_to)}</div><div className="mt-1 text-muted-foreground">שעות תקן: {toNumber(agreement.standard_daily_hours)} | שעות נוספות: {agreement.overtime_rate ? formatCurrency(agreement.overtime_rate) : "-"}</div>{agreement.notes ? <div className="mt-2">{agreement.notes}</div> : null}</div>)}</CardContent></Card>
            <Card><CardContent className="space-y-3 py-5"><div className="text-lg font-semibold">תלושי שכר</div>{payslips.length === 0 ? <div className="text-sm text-muted-foreground">אין תלושי שכר זמינים כרגע.</div> : payslips.map((payslip) => { const period = periodsById.get(payslip.payroll_period_id) ?? null; return <div key={payslip.id} className="rounded-2xl border p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium">{period?.period_month ?? "תקופת שכר"}</div><div className="text-base font-semibold">{formatCurrency(payslip.gross_salary)}</div></div><div className="mt-2 text-muted-foreground">שעות לחישוב: {formatMinutes(payslip.total_work_minutes)} | סוג: {getSalaryTypeLabel(payslip.calculated_salary_type)}</div><div className="mt-1 text-muted-foreground">שכר בסיס: {formatCurrency(payslip.calculated_base_salary)} | התאמות: {formatCurrency(payslip.manual_adjustments)}</div>{period ? <div className="mt-1 text-muted-foreground">סטטוס: {getPayrollStatusLabel(period.status)} | טווח: {formatDate(period.start_date)} - {formatDate(period.end_date)} | צפי תשלום: {getNextMonthDueText(period.end_date)}</div> : null}{payslip.notes ? <div className="mt-2">{payslip.notes}</div> : null}</div>; })}</CardContent></Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={manualEditorOpen}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="max-w-4xl" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>הוספת משמרת ידנית</DialogTitle>
          </DialogHeader>
          {renderEditor(null)}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editorSession)}
        onOpenChange={(open) => {
          if (!open && isPending) return;
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="max-w-5xl" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>עריכת משמרת</DialogTitle>
          </DialogHeader>
          {editorSession ? renderEditor(editorSession) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <Card><CardContent className="space-y-1 py-5"><div className="text-sm text-muted-foreground">{title}</div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{hint}</div></CardContent></Card>;
}
function StatCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border bg-muted/20 p-4 text-right"><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>;
}
