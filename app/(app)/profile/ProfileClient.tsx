"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ComponentType } from "react";
import { ClockIcon, HideIcon, NotificationIcon, ShowIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import NotificationPrefs from "@/components/notifications/NotificationPrefs";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { InitialsAvatar, isHexColor } from "@/components/dashboard/InitialsAvatar";
import { setAvatarColorCache } from "@/lib/ui/avatar-color";
import type { UserProfile } from "@/lib/auth/requireProfile";
import { EXPENSE_BUSINESS_DOMAINS, WORK_SESSION_BUSINESS_DOMAINS, type ExpenseBusinessDomain } from "@/lib/expenses";
import { DomainSelect } from "@/components/financial/DomainSelect";
import { normalizePayrollWorkerType, payrollWorkerTypeAllowsSessions, payrollWorkerTypeGeneratesPayslips, shouldShowSessionHours } from "@/lib/payroll-worker-type";
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
  minutesBetween,
  monthKeyFromDate,
  monthLabelFromKey,
  sessionWorkedMinutes,
  toNumber,
  type MonthlyHoursSummary,
  type PayrollPeriodRow,
  type PayslipRow,
  type SalaryAgreementRow,
  type WorkSessionRow,
} from "@/lib/payroll";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import MyShiftCard from "@/components/attendance/MyShiftCard";
import SessionList from "@/components/attendance/SessionList";
import type { MyShiftReport } from "@/lib/attendance/my-shift";

type Props = {
  profile: UserProfile;
  initialFontScale: number | null;
  initialAvatarColor: string | null;
  sessions: WorkSessionRow[];
  agreements: SalaryAgreementRow[];
  payslips: PayslipRow[];
  periods: PayrollPeriodRow[];
  monthlySummaries: MonthlyHoursSummary[];
  projectOptions: Array<{ id: string; label: string }>;
  propertyOptions: Array<{ id: string; label: string }>;
  /**
   * A worker reports shifts THROUGH THE APPROVAL QUEUE — he opens and submits,
   * the boss classifies the domain and approves. So he gets the shift card and
   * his pending reports here instead of the self-service session controls, which
   * write straight into attendance_sessions with a self-chosen domain (and which
   * his RLS policies no longer permit anyway).
   */
  isWorker?: boolean;
  openShiftReport?: MyShiftReport | null;
  pendingShiftReports?: MyShiftReport[];
  /** Earned / paid / still owed across every period. Null when unreadable. */
  payTotals?: { earned: number; paid: number; owed: number } | null;
  /** session id → payment_status, so a shift row can say whether it was paid. */
  payBySessionId?: Record<string, string>;
  /** session id → the specific project name / property address it was booked to. */
  linkLabelBySessionId?: Record<string, string>;
};

type SplitPartDraft = {
  id: string;
  // Time-based split only on self-service: datetime-local end boundary (last part runs to shift end).
  // Money-based splitting (per-part cost / customer billing) is intentionally admin-only — see the
  // payroll center. Workers must not be able to set their own pay here.
  endTime: string;
  domain: ExpenseBusinessDomain;
  projectId: string;
  propertyId: string;
};

// Midpoint between two datetime-local values (default split point).
function midpointLocal(startLocal: string, endLocal: string): string {
  const startMs = new Date(startLocal).getTime();
  const endMs = new Date(endLocal).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "";
  return toLocalDateTimeValue(new Date(startMs + Math.floor((endMs - startMs) / 2)));
}
// "YYYY-MM-DDTHH:MM" → "HH:MM" for read-only display of a split boundary.
function splitTimeLabel(local: string): string {
  return local && local.length >= 16 ? local.slice(11, 16) : "—";
}

// A broad spectrum of quick-pick swatches for the personal avatar color. Any
// color is allowed (the picker below accepts a custom hex); these are just
// convenient presets. The avatar text auto-contrasts, so light picks stay legible.
const AVATAR_COLOR_PRESETS = [
  "#DC2626", "#EF4444", "#F87171", "#EA580C", "#F97316", "#FB923C",
  "#D97706", "#F59E0B", "#FBBF24", "#65A30D", "#84CC16", "#16A34A",
  "#22C55E", "#4ADE80", "#059669", "#0D9488", "#14B8A6", "#0891B2",
  "#06B6D4", "#0284C7", "#2563EB", "#3B82F6", "#60A5FA", "#4F46E5",
  "#6366F1", "#7C3AED", "#9333EA", "#A855F7", "#C026D3", "#DB2777",
  "#EC4899", "#F472B6", "#E11D48", "#F43F5E", "#475569", "#0F172A",
] as const;

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

type ProfileTab = "profile" | "notifications" | "sessions" | "salary";

export default function ProfileClient({ profile, initialFontScale, initialAvatarColor, sessions, agreements, payslips, periods, monthlySummaries, projectOptions, propertyOptions, isWorker = false, openShiftReport = null, pendingShiftReports = [], payTotals = null, payBySessionId = {}, linkLabelBySessionId = {} }: Props) {
  const router = useRouter();
  // The whole page is the swipe surface, so the gesture works wherever the
  // thumb happens to be rather than only on the tab strip.
  const swipeRef = useRef<HTMLDivElement>(null);
  // Tab lives in the URL so the user menu can deep-link (?tab=notifications) and
  // the browser back button behaves.
  const searchParams = useSearchParams();
  const tabParam = (searchParams.get("tab") ?? "profile") as ProfileTab;
  const setTab = (tab: ProfileTab) => {
    const qs = new URLSearchParams(searchParams.toString());
    if (tab === "profile") qs.delete("tab");
    else qs.set("tab", tab);
    const q = qs.toString();
    router.replace(q ? `/profile?${q}` : "/profile", { scroll: false });
  };
  // Name + phone, editable in place. Kept in local state so the card (and the
  // avatar's initials) update on save without a round-trip through the server
  // component.
  const [detailsName, setDetailsName] = useState(profile.full_name ?? "");
  const [detailsPhone, setDetailsPhone] = useState(profile.phone ?? "");
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsNameDraft, setDetailsNameDraft] = useState(profile.full_name ?? "");
  const [detailsPhoneDraft, setDetailsPhoneDraft] = useState(profile.phone ?? "");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  async function saveDetails() {
    const name = detailsNameDraft.trim();
    if (!name) {
      setDetailsError("יש להזין שם.");
      return;
    }
    setSavingDetails(true);
    setDetailsError("");
    try {
      const res = await fetch("/api/profile/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: name, phone: detailsPhoneDraft.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; phone?: string | null };
      if (!res.ok) throw new Error(json.error);
      setDetailsName(name);
      setDetailsPhone(json.phone ?? "");
      setDetailsNameDraft(name);
      setDetailsPhoneDraft(json.phone ?? "");
      setEditingDetails(false);
      toast.success("הפרטים נשמרו");
      // The name shows in the top bar / presence too — refresh the server tree.
      router.refresh();
    } catch (err) {
      setDetailsError(toHebrewError(err, "שמירה נכשלה."));
    } finally {
      setSavingDetails(false);
    }
  }

  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordDone, setPasswordDone] = useState(false);

  async function savePassword() {
    if (newPassword.length < 6) {
      setPasswordError("הסיסמה חייבת להכיל לפחות 6 תווים.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("הסיסמאות אינן תואמות.");
      return;
    }
    setSavingPassword(true);
    setPasswordError("");
    try {
      // Goes through our own origin rather than calling GoTrue from the page —
      // see app/api/profile/password/route.ts for why.
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPasswordError(json.error || "שינוי הסיסמה נכשל.");
        return;
      }
      setPasswordDone(true);
      setChangingPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("הסיסמה עודכנה");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const hebrew = toHebrewError(err, "");
      setPasswordError(hebrew || (raw ? `שינוי הסיסמה נכשל: ${raw}` : "שינוי הסיסמה נכשל."));
    } finally {
      setSavingPassword(false);
    }
  }

  const splitPartIdRef = useRef(0);
  const [isPending, startTransition] = useTransition();
  // Deleting asks through the styled ConfirmDialog, never window.confirm.
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null);
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
  const [sessionEditBilledToCustomer, setSessionEditBilledToCustomer] = useState(false);
  const [sessionEditBillToCustomerAmount, setSessionEditBillToCustomerAmount] = useState("");
  const [splitParts, setSplitParts] = useState<SplitPartDraft[]>([]);
  const [splitEnabled, setSplitEnabled] = useState(false);
  // Open on THIS month when there are hours in it — "how am I doing this month"
  // is the question you come here with. Only when it's empty does it fall back
  // to the most recent month that has any, so the page is never blank.
  // The month list is built from shifts that EXIST, so the current month is
  // missing until the first one is approved — and "where's August?" on the 14th
  // of August is a broken page, not an empty one. Always offer it, at zero.
  const monthOptions = useMemo(() => {
    const currentKey = monthKeyFromDate(new Date());
    if (monthlySummaries.some((summary) => summary.key === currentKey)) return monthlySummaries;
    return [
      {
        key: currentKey,
        label: monthLabelFromKey(currentKey),
        totalMinutes: 0,
        sessionCount: 0,
        openSessionCount: 0,
      },
      ...monthlySummaries,
    ];
  }, [monthlySummaries]);

  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyFromDate(new Date()));

  // Global text-size multiplier. The whole UI is rem-based, so this scales
  // text, spacing and widths together (no squashing) — see app/globals.css.
  const FONT_SCALES = [
    { label: "קטן", scale: 0.9 },
    { label: "רגיל", scale: 1 },
    { label: "גדול", scale: 1.15 },
    { label: "גדול מאוד", scale: 1.3 },
    { label: "ענק", scale: 1.5 },
  ] as const;
  const snapToScale = (value: number) =>
    FONT_SCALES.reduce(
      (best, option) =>
        Math.abs(option.scale - value) < Math.abs(best - value) ? option.scale : best,
      1 as number,
    );
  const [fontScale, setFontScale] = useState<number>(() => {
    // The account value (synced across devices) wins when set.
    if (initialFontScale && initialFontScale > 0) return snapToScale(initialFontScale);
    if (typeof window === "undefined") return 1;
    const saved = Number(localStorage.getItem("biz-font-scale"));
    if (Number.isFinite(saved) && saved > 0) return snapToScale(saved);
    // Migrate the legacy absolute-px preference (base was 17px).
    const oldPx = Number(localStorage.getItem("biz-font-size"));
    return Number.isFinite(oldPx) && oldPx > 0 ? snapToScale(oldPx / 17) : 1;
  });
  useEffect(() => {
    const root = document.documentElement;
    // Older builds set an absolute inline font-size here; clear it so the CSS
    // calc(17px * var(--font-scale)) governs the size again.
    root.style.removeProperty("font-size");
    root.style.setProperty("--font-scale", String(fontScale));
    try { localStorage.setItem("biz-font-scale", String(fontScale)); } catch (_) {}
  }, [fontScale]);
  function selectFontScale(scale: number) {
    setFontScale(scale);
    // Persist to the account so the choice follows the user across devices.
    // Fire-and-forget: the local apply above already took effect.
    void fetch("/api/profile/font-scale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scale }),
    }).catch(() => {});
  }

  // Personal avatar color — the colored initials circle shown across the app.
  const [avatarColor, setAvatarColor] = useState<string | null>(
    isHexColor(initialAvatarColor) ? initialAvatarColor : null
  );
  const profileName = profile.full_name ?? profile.email ?? "";
  function selectAvatarColor(color: string | null) {
    setAvatarColor(color);
    // Update the shared cache so the top-bar avatar reflects the change live.
    setAvatarColorCache(color);
    // Fire-and-forget; a refresh propagates the new color to every other avatar.
    void fetch("/api/profile/avatar-color", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ color }),
    })
      .then(() => router.refresh())
      .catch(() => {});
  }

  const openSession = useMemo(() => sessions.find((session) => !session.clock_out) ?? null, [sessions]);
  const currentAgreement = useMemo(() => getCurrentSalaryAgreement(agreements), [agreements]);
  const showSessionTimingForProfile = shouldShowSessionHours(profile.payroll_worker_type);
  // Sessions UI is only relevant to workers whose pay type actually tracks
  // sessions (קבלנות / שעתי) — monthly-payslip or staff with no type don't punch in.
  const canTrackSessions =
    profile.payroll_worker_type != null && payrollWorkerTypeAllowsSessions(profile.payroll_worker_type);
  const showSalarySection =
    (profile.payroll_worker_type != null && payrollWorkerTypeGeneratesPayslips(profile.payroll_worker_type)) ||
    agreements.length > 0 ||
    payslips.length > 0;
  const sessionEditDateOnly = (() => {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(sessionEditClockIn);
    return match ? match[1] : new Date().toISOString().slice(0, 10);
  })();
  const periodsById = useMemo(() => new Map(periods.map((period) => [period.id, period])), [periods]);
  // No cross-month fallback: showing July's totals under a header that says
  // August is worse than showing zeros.
  const selectedMonthSummary = monthOptions.find((summary) => summary.key === selectedMonth) ?? null;
  const selectedMonthSessions = useMemo(() => sessions.filter((session) => monthKeyFromDate(session.clock_in) === selectedMonth), [selectedMonth, sessions]);
  const latestPayslip = useMemo(() => [...payslips].sort((a, b) => (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(periodsById.get(a.payroll_period_id)?.period_month ?? ""))[0] ?? null, [payslips, periodsById]);
  const latestPeriod = latestPayslip ? periodsById.get(latestPayslip.payroll_period_id) ?? null : null;
  const editorSession = useMemo(() => sessions.find((session) => session.id === sessionEditorId) ?? null, [sessionEditorId, sessions]);
  // Self-service splitting is TIME-only and applies to hourly workers. Contract/session workers
  // (session_only) are paid by money per part — that's an admin-only action in the payroll center,
  // so they don't get a split option here at all (workers must not set their own pay).
  const isContractorWorker = normalizePayrollWorkerType(profile.payroll_worker_type, "session") === "session_only";

  function createSplitPart(domain: ExpenseBusinessDomain, overrides?: Partial<Omit<SplitPartDraft, "id" | "domain">>): SplitPartDraft {
    splitPartIdRef.current += 1;
    return {
      id: `part-${splitPartIdRef.current}`,
      endTime: overrides?.endTime ?? "",
      domain,
      projectId: overrides?.projectId ?? "",
      propertyId: overrides?.propertyId ?? "",
    };
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
    setSessionEditBilledToCustomer(false);
    setSessionEditBillToCustomerAmount("");
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
    if (
      sessionEditDomain === "logistics_projects" &&
      sessionEditBilledToCustomer &&
      !(Number(sessionEditBillToCustomerAmount) > 0)
    ) {
      return "יש להזין סכום לחיוב לקוח.";
    }
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
        if (!response.ok) return setActionError(toHebrewError(json.error, "הפעולה נכשלה."));
        setSessionNote("");
        setSessionDomain("general_business");
        router.refresh();
      } catch (error: unknown) {
        setActionError(toHebrewError(error, "Unknown error"));
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
        if (!response.ok) return setActionError(toHebrewError(json.error, "מחיקת המשמרת נכשלה."));
        router.refresh();
      } catch (error: unknown) {
        setActionError(toHebrewError(error, "Unknown error"));
      }
    });
  }
  function openSessionEditor(session: WorkSessionRow) {
    const currentDomain = EXPENSE_BUSINESS_DOMAINS.includes(session.business_domain as ExpenseBusinessDomain) ? (session.business_domain as ExpenseBusinessDomain) : "general_business";
    setManualEditorOpen(false);
    setSessionEditorId(session.id);
    setSessionEditDomain(currentDomain);
    setSessionEditProjectId(session.project_id ?? "");
    setSessionEditPropertyId(session.property_id ?? "");
    setSessionEditNotes(session.notes ?? "");
    setSessionEditClockIn(toLocalValue(session.clock_in));
    setSessionEditClockOut(toLocalValue(session.clock_out));
    setSessionEditBilledToCustomer(session.is_billable_to_customer === true);
    setSessionEditBillToCustomerAmount(
      session.is_billable_to_customer && session.bill_to_customer_amount != null
        ? String(session.bill_to_customer_amount)
        : ""
    );
    setSplitParts([]);
    setSplitEnabled(false);
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
    setSessionEditBilledToCustomer(false);
    setSessionEditBillToCustomerAmount("");
    setSplitParts([]);
    setSplitEnabled(false);
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
        const billToCustomer = sessionEditDomain === "logistics_projects" && sessionEditBilledToCustomer;
        const response = await fetch("/api/profile/session/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, user_id: profile.id, business_domain: sessionEditDomain, project_id: sessionEditProjectId || null, property_id: sessionEditPropertyId || null, notes: sessionEditNotes.trim() || null, clock_in: toIso(sessionEditClockIn), clock_out: sessionEditClockOut ? toIso(sessionEditClockOut) : null, is_billable_to_customer: billToCustomer, bill_to_customer_amount: billToCustomer && sessionEditBillToCustomerAmount.trim() ? Number(sessionEditBillToCustomerAmount) : null, billing_status: billToCustomer ? "billable" : "not_billable" }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(toHebrewError(json.error, "עדכון המשמרת נכשל."));
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(toHebrewError(error, "Unknown error"));
      }
    });
  }
  async function createManualSession() {
    const error = formError(true);
    if (error) return setActionError(error);
    setActionError("");
    startTransition(async () => {
      try {
        const billToCustomer = sessionEditDomain === "logistics_projects" && sessionEditBilledToCustomer;
        const response = await fetch("/api/profile/session/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user_id: profile.id, business_domain: sessionEditDomain, project_id: sessionEditProjectId || null, property_id: sessionEditPropertyId || null, notes: sessionEditNotes.trim() || null, clock_in: toIso(sessionEditClockIn), clock_out: toIso(sessionEditClockOut), is_billable_to_customer: billToCustomer, bill_to_customer_amount: billToCustomer && sessionEditBillToCustomerAmount.trim() ? Number(sessionEditBillToCustomerAmount) : null, billing_status: billToCustomer ? "billable" : "not_billable" }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(toHebrewError(json.error, "יצירת המשמרת נכשלה."));
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(toHebrewError(error, "Unknown error"));
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
  function updateSplitEndTime(partId: string, value: string) {
    setSplitParts((current) => current.map((part) => (part.id === partId ? { ...part, endTime: value } : part)));
  }
  // Default 2-part time split: first part ends at the midpoint, second runs to the shift end.
  function buildInitialSplitParts(session: WorkSessionRow): SplitPartDraft[] {
    const domain = EXPENSE_BUSINESS_DOMAINS.includes(session.business_domain as ExpenseBusinessDomain) ? (session.business_domain as ExpenseBusinessDomain) : "general_business";
    const shared = { projectId: session.project_id ?? "", propertyId: session.property_id ?? "" };
    return [
      createSplitPart(domain, { ...shared, endTime: midpointLocal(toLocalValue(session.clock_in), toLocalValue(session.clock_out)) }),
      createSplitPart(domain, shared),
    ];
  }
  function toggleSplit(session: WorkSessionRow, enabled: boolean) {
    setSplitEnabled(enabled);
    setSplitParts(enabled ? buildInitialSplitParts(session) : []);
  }
  function addSplitPart(session: WorkSessionRow) {
    setSplitParts((current) => {
      if (current.length >= 5) return current;
      const domain = EXPENSE_BUSINESS_DOMAINS.includes(sessionEditDomain) ? sessionEditDomain : "general_business";
      const startLocal = toLocalValue(session.clock_in);
      const endLocal = toLocalValue(session.clock_out);
      const prevBoundary = current.length >= 2 ? current[current.length - 2].endTime : startLocal;
      const newPart = createSplitPart(domain, { endTime: midpointLocal(prevBoundary || startLocal, endLocal) });
      const next = [...current];
      next.splice(next.length - 1, 0, newPart);
      return next;
    });
  }
  function removeSplitPart(partId: string) {
    setSplitParts((current) => current.length <= 2 ? current : current.filter((part) => part.id !== partId));
  }
  // Each part's clock boundaries + minutes (time split), derived from the saved session span.
  function splitPreview(session: WorkSessionRow) {
    const startLocal = toLocalValue(session.clock_in);
    const endLocal = toLocalValue(session.clock_out);
    return splitParts.map((part, index) => {
      const isLast = index === splitParts.length - 1;
      const partStart = index === 0 ? startLocal : splitParts[index - 1].endTime;
      const partEnd = isLast ? endLocal : part.endTime;
      const minutes = partStart && partEnd ? minutesBetween(partStart, partEnd) : 0;
      return { ...part, startLocal: partStart, endLocal: partEnd, minutes, isLast };
    });
  }
  function computeSplitMinutes(session: WorkSessionRow): number[] {
    const startLocal = toLocalValue(session.clock_in);
    const endLocal = toLocalValue(session.clock_out);
    const boundaries = [startLocal, ...splitParts.slice(0, -1).map((part) => part.endTime), endLocal];
    return splitParts.map((_, index) => minutesBetween(boundaries[index], boundaries[index + 1]));
  }
  function splitError(session: WorkSessionRow) {
    const startLocal = toLocalValue(session.clock_in);
    const endLocal = toLocalValue(session.clock_out);
    const shiftStartMs = new Date(startLocal).getTime();
    const shiftEndMs = new Date(endLocal).getTime();
    if (!endLocal || !Number.isFinite(shiftEndMs) || shiftEndMs <= shiftStartMs) return "צריך משמרת עם שעת התחלה וסיום כדי לפצל.";
    if (splitParts.length < 2) return "צריך לפחות שני חלקים.";
    if (splitParts.length > 5) return "אפשר לפצל לכל היותר לחמישה חלקים.";
    let prevMs = shiftStartMs;
    for (let index = 0; index < splitParts.length; index += 1) {
      const part = splitParts[index];
      const isLast = index === splitParts.length - 1;
      if (!isLast) {
        const boundaryMs = new Date(part.endTime).getTime();
        if (!part.endTime || !Number.isFinite(boundaryMs)) return `יש להזין שעת יציאה לחלק ${index + 1}.`;
        if (boundaryMs <= prevMs) return `שעת היציאה של חלק ${index + 1} חייבת להיות אחרי תחילת החלק.`;
        if (boundaryMs >= shiftEndMs) return `שעת היציאה של חלק ${index + 1} חייבת להיות לפני סוף המשמרת.`;
        prevMs = boundaryMs;
      } else if (shiftEndMs - prevMs <= 0) return "לא נשאר זמן לחלק האחרון.";
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
        // Self-service split is time-only: each part is a minutes slice of the shift.
        const minutesByPart = computeSplitMinutes(editorSession);
        const response = await fetch("/api/profile/session/split", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, parts: splitParts.map((part, index) => ({ minutes: minutesByPart[index], business_domain: part.domain, project_id: part.projectId || null, property_id: part.propertyId || null })) }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(toHebrewError(json.error, "פיצול המשמרת נכשל."));
        closeEditor();
        router.refresh();
      } catch (error: unknown) {
        setActionError(toHebrewError(error, "Unknown error"));
      }
    });
  }
  function linkField(label: string, value: string, onChange: (value: string) => void, options: Array<{ id: string; label: string }>, compact = false) {
    return (
      <label className="space-y-1 text-right">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <NativeSelect dense={compact} className={compact ? "w-44" : undefined} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">בחירה</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </NativeSelect>
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">תחום</span><DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={sessionEditDomain} onChange={(value) => setEditorDomain(value as ExpenseBusinessDomain)} className="text-right" /></label>
          {sessionEditDomain === "logistics_projects" ? linkField("פרויקט", sessionEditProjectId, setSessionEditProjectId, projectOptions) : sessionEditDomain === "property_management" ? linkField("נכס", sessionEditPropertyId, setSessionEditPropertyId, propertyOptions) : <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">אין צורך בבחירה נוספת.</div>}
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">הערות</span><textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-right text-sm outline-none" value={sessionEditNotes} onChange={(event) => setSessionEditNotes(event.target.value)} /></label>
        </div>
        {sessionEditDomain === "logistics_projects" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="text-sm font-semibold">חיוב הלקוח</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sessionEditBilledToCustomer}
                onChange={(event) => {
                  setSessionEditBilledToCustomer(event.target.checked);
                  if (!event.target.checked) setSessionEditBillToCustomerAmount("");
                }}
              />
              <span>לחיוב לקוח</span>
            </label>
            {sessionEditBilledToCustomer ? (
              <label className="space-y-1 block">
                <span className="block text-xs text-muted-foreground">סכום לחיוב לקוח</span>
                <CurrencyInput
                  value={sessionEditBillToCustomerAmount}
                  onChange={(event) => setSessionEditBillToCustomerAmount(event.target.value)}
                  placeholder="למשל 650"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-row-reverse flex-wrap gap-3 text-xs text-muted-foreground">{duration ? <div className="rounded-full border px-3 py-1">משך: {duration}</div> : null}{session?.clock_out ? <div className="rounded-full border px-3 py-1">משך מקורי: {formatMinutes(sessionWorkedMinutes(session))}</div> : null}{suggestedAmount !== null ? <div className="rounded-full border px-3 py-1">{`מגיע לפי המשמרת: ${formatCurrency(suggestedAmount)}`}</div> : null}</div>
        {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
        {session?.clock_out && !isContractorWorker ? <div className="space-y-3 border-t pt-4">
          <label className="flex cursor-pointer flex-row-reverse items-center justify-end gap-3">
            <span className="font-medium">פיצול המשמרת לחלקים</span>
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={splitEnabled} onChange={(event) => toggleSplit(session, event.target.checked)} />
          </label>
          {splitEnabled ? (
            <>
              <p className="text-xs text-muted-foreground">כל חלק מתחיל בשעת היציאה של החלק הקודם. בחרו שעת יציאה לכל חלק — החלק האחרון נמשך עד סוף המשמרת.</p>
              <div className="flex flex-row-reverse">
                <Button type="button" size="sm" variant="outline" disabled={splitParts.length >= 5} onClick={() => addSplitPart(session)}>הוספת חלק</Button>
              </div>
              <div className="space-y-3">{splitPreview(session).map((part, index) => {
                const isLast = part.isLast;
                return <div key={part.id} className="rounded-xl border bg-background/70 p-3">
                  <div className="mb-2 flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">חלק {index + 1}</div>
                    <div className="flex flex-row-reverse flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{formatMinutes(part.minutes)}</span>{!isLast && splitParts.length > 2 ? <DeleteButton label="הסרת חלק" onClick={() => removeSplitPart(part.id)} /> : null}</div>
                  </div>
                  <div className="flex flex-row-reverse flex-wrap items-end justify-end gap-2">
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">כניסה</span><div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">{splitTimeLabel(part.startLocal)}</div></label>
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">יציאה</span>{!isLast ? <Input type="datetime-local" className="h-9 w-44 text-right" min={part.startLocal || undefined} max={toLocalValue(session.clock_out) || undefined} value={splitParts[index]?.endTime ?? ""} onChange={(event) => updateSplitEndTime(part.id, event.target.value)} /> : <div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">{`עד סוף המשמרת (${splitTimeLabel(toLocalValue(session.clock_out))})`}</div>}</label>
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">תחום</span><DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={splitParts[index]?.domain ?? "general_business"} onChange={(value) => updateSplitPart(part.id, { domain: value as ExpenseBusinessDomain })} className="w-40 text-right" /></label>
                    {splitParts[index]?.domain === "logistics_projects" ? linkField("פרויקט", splitParts[index]?.projectId ?? "", (value) => updateSplitPart(part.id, { projectId: value }), projectOptions, true) : null}
                    {splitParts[index]?.domain === "property_management" ? linkField("נכס", splitParts[index]?.propertyId ?? "", (value) => updateSplitPart(part.id, { propertyId: value }), propertyOptions, true) : null}
                  </div>
                </div>;
              })}</div>
              {currentSplitError ? <div className="text-sm text-destructive">{currentSplitError}</div> : null}
              <div className="flex flex-row-reverse"><Button type="button" size="sm" disabled={isPending || Boolean(currentSplitError)} onClick={() => void splitSavedSession(session.id)}>שמירת פיצול</Button></div>
            </>
          ) : null}
        </div> : null}
      </div>
    );
  }
  // Three unrelated things used to share one long scroll: how the app looks, how
  // it notifies you, and your shifts. They're separate errands, so they're
  // separate tabs — and the top-bar user menu deep-links straight to each.
  const tabs: Array<{ key: ProfileTab; label: string; icon: ComponentType<{ className?: string }> }> = [
    { key: "profile", label: "פרופיל", icon: UserIcon },
    { key: "notifications", label: "התראות", icon: NotificationIcon },
    ...(canTrackSessions
      ? [{ key: "sessions" as ProfileTab, label: "נוכחות", icon: ClockIcon }]
      : []),
    // Salary stands alone: you can have payslips without punching shifts, and
    // it has nothing to do with preferences.
    ...(showSalarySection
      ? [{ key: "salary" as ProfileTab, label: "משכורת", icon: WalletIcon }]
      : []),
  ];
  // A stale/ineligible ?tab= falls back rather than showing an empty page.
  const activeTab: ProfileTab = tabs.some((t) => t.key === tabParam) ? tabParam : "profile";

  const activeIndex = tabs.findIndex((t) => t.key === activeTab);
  const stepTab = (delta: number) => {
    const next = tabs[activeIndex + delta];
    if (next) setTab(next.key);
  };
  // Swipe the page to move between tabs. Stops at the ends rather than wrapping —
  // landing back on the first tab from the last reads as a glitch, not a loop.
  useSwipeNavigation(swipeRef, {
    onNext: () => stepTab(1),
    onPrevious: () => stepTab(-1),
    enabled: tabs.length > 1,
  });

  return (
    // Swipe anywhere on the page to change tab — except over content that claims
    // the gesture for itself (the shift rows, which open on a swipe, and any
    // sideways-scrolling table). See lib/ui/gesture-claim.
    <div className="space-y-4" ref={swipeRef}>
      {/* The same tab bar as the rest of the system (financial, projects, payroll…). */}
      <div>
      <Tabs value={activeTab} onValueChange={(value) => setTab(value as ProfileTab)}>
        {/* Full-bleed on a phone (-mx-3 cancels the shell gutter) and the four
            tabs split the width evenly, so they always fit however narrow the
            screen — shrinking the text was a guess that still left "משכורת" half
            off the edge. From sm up they go back to sitting centred at their
            natural width. */}
        <TabsList
          variant="underline"
          className="-mx-3 w-[calc(100%+1.5rem)] gap-0 px-1 sm:mx-0 sm:w-full sm:justify-center sm:gap-3 sm:px-0"
        >
          {tabs.map((t) => (
            <TabsTrigger
              key={t.key}
              value={t.key}
              className="min-w-0 flex-1 gap-1 px-0.5 text-[0.8125rem] sm:flex-none sm:gap-1 sm:px-2 sm:text-base"
            >
              <t.icon className="h-4 w-4 shrink-0" />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      </div>

      {activeTab === "profile" ? (
        <>
      {/* Your details. Name + phone are self-editable (via an auth.uid()-scoped
          RPC); email is the auth identity and role/pay type are admin-managed, so
          they stay read-only here. */}
      <Card>
        <CardContent className="py-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <InitialsAvatar name={detailsName || profileName} color={avatarColor} size="md" />
              <div className="min-w-0 text-base font-semibold">{detailsName || "—"}</div>
            </div>
            {!editingDetails ? (
              <EditButton onClick={() => setEditingDetails(true)} label="עריכת פרטים" />
            ) : null}
          </div>

          {editingDetails ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">שם</label>
                <Input value={detailsNameDraft} onChange={(e) => setDetailsNameDraft(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">טלפון</label>
                <Input
                  dir="ltr"
                  inputMode="tel"
                  value={detailsPhoneDraft}
                  onChange={(e) => setDetailsPhoneDraft(e.target.value)}
                />
              </div>
              {detailsError ? <div className="text-sm text-destructive">{detailsError}</div> : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={savingDetails}
                  onClick={() => {
                    setEditingDetails(false);
                    setDetailsNameDraft(detailsName);
                    setDetailsPhoneDraft(detailsPhone);
                    setDetailsError("");
                  }}
                >
                  ביטול
                </Button>
                <Button size="sm" disabled={savingDetails} onClick={() => void saveDetails()}>
                  {savingDetails ? "שומר…" : "שמירה"}
                </Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">טלפון</dt>
                <dd dir="ltr" className="font-medium">
                  {detailsPhone ? (
                    <a href={`tel:${detailsPhone}`} className="hover:underline">
                      {detailsPhone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">אימייל</dt>
                <dd dir="ltr" className="font-medium">
                  {profile.email ?? <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Password: Supabase treats the live session as proof of identity, so
          updateUser() needs no current password. Email is deliberately absent —
          it's the login identity, and changing it needs a confirmation round-trip
          plus a sync into public.users, so it stays admin-managed for now. */}
      <Card>
        <CardContent className="py-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">סיסמה</div>
            {!changingPassword ? (
              <Button variant="secondary" size="sm" onClick={() => setChangingPassword(true)}>
                שינוי סיסמה
              </Button>
            ) : null}
          </div>
          {changingPassword ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">סיסמה חדשה</label>
                <div className="relative">
                  <Input
                    type={showPasswords ? "text" : "password"}
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pe-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords((v) => !v)}
                    className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                    aria-label={showPasswords ? "הסתר סיסמה" : "הצג סיסמה"}
                    tabIndex={-1}
                  >
                    {showPasswords ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">אימות סיסמה</label>
                <Input
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {passwordError ? <div className="text-sm text-destructive">{passwordError}</div> : null}
              {passwordDone ? <div className="text-sm text-success">הסיסמה עודכנה.</div> : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={savingPassword}
                  onClick={() => {
                    setChangingPassword(false);
                    setNewPassword("");
                    setConfirmPassword("");
                    setPasswordError("");
                  }}
                >
                  ביטול
                </Button>
                <Button size="sm" disabled={savingPassword} onClick={() => void savePassword()}>
                  {savingPassword ? "שומר…" : "שמירה"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {passwordDone ? "הסיסמה עודכנה." : "מומלץ להחליף סיסמה מדי פעם."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <div className="mb-1 text-sm font-semibold">גודל טקסט</div>
          <div className="mb-3 text-xs text-muted-foreground">
            הבחירה משנה את גודל הטקסט בכל המערכת ונשמרת בחשבון שלך — בכל מכשיר שתתחבר ממנו.
          </div>
          <div className="flex flex-wrap gap-2">
            {FONT_SCALES.map((option) => {
              const isActive = Math.abs(fontScale - option.scale) < 0.01;
              return (
                <button
                  key={option.scale}
                  type="button"
                  onClick={() => selectFontScale(option.scale)}
                  className={`flex flex-col items-center gap-1 rounded-2xl border px-4 py-3 transition-all ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                      : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5"
                  }`}
                >
                  <span style={{ fontSize: `${17 * option.scale}px`, lineHeight: 1 }}>א</span>
                  <span className="text-xs font-medium">{option.label}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            הצבע שלי
            <InitialsAvatar name={profileName} color={avatarColor} size="md" />
          </div>
          <div className="mb-3 text-xs text-muted-foreground">
            הצבע של עיגול ראשי התיבות שלך בכל המערכת. הבחירה נשמרת בחשבון שלך.
          </div>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLOR_PRESETS.map((color) => {
              const isActive = avatarColor?.toUpperCase() === color.toUpperCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => selectAvatarColor(color)}
                  aria-label={`בחירת צבע ${color}`}
                  aria-pressed={isActive}
                  className={`h-8 w-8 rounded-full transition-transform ${
                    isActive ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: color }}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50">
              <span
                className="h-5 w-5 rounded-full border"
                style={{ backgroundColor: isHexColor(avatarColor) ? (avatarColor as string) : "transparent" }}
              />
              צבע מותאם אישית
              <input
                type="color"
                className="sr-only"
                value={isHexColor(avatarColor) ? (avatarColor as string) : "#2563EB"}
                onChange={(e) => selectAvatarColor(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => selectAvatarColor(null)}
              className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
            >
              אוטומטי
            </button>
          </div>
        </CardContent>
      </Card>

        </>
      ) : null}

      {activeTab === "notifications" ? (
        <>
          <Card>
            <CardContent className="py-5">
              <div className="mb-3 text-right">
                <div className="text-base font-semibold">התראות לטלפון</div>
                <div className="text-sm text-muted-foreground">הפעל התראות כדי לקבל עדכונים ישירות לטלפון שלך.</div>
              </div>
              <PushSubscribeButton />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-5">
              <div className="mb-3 text-right">
                <div className="text-base font-semibold">העדפות התראות</div>
                <div className="text-sm text-muted-foreground">כמה להתריע, מתי, ומה בכלל להציג בתיבה.</div>
              </div>
              <NotificationPrefs viewerRole={profile.role} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* No section heading — the active tab already names it. */}
      {activeTab === "sessions" && canTrackSessions ? (
        <section className="space-y-4">
          {/* No "סטטוס נוכחי" / "שעות החודש" cards up here: the clock card says
              whether you're in a shift, and the month picker below gives the
              hours — with the month you actually chose, rather than a card
              labelled "this month" showing the last month that had any. */}
          {isWorker ? (
            <>
              <MyShiftCard openShift={openShiftReport} pendingCount={pendingShiftReports.length} />
              {pendingShiftReports.length > 0 ? (
                <Card>
                  <CardContent className="space-y-2 py-5 text-right">
                    <div className="text-lg font-semibold">ממתינות לאישור</div>
                    <p className="text-sm text-muted-foreground">
                      משמרת נכנסת לשעות ולשכר רק אחרי שהלר מאשר אותה.
                    </p>
                    {pendingShiftReports.map((report) => (
                      <div
                        key={report.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{formatDateTime(report.clock_in)}</div>
                          {report.notes ? <div className="text-xs text-muted-foreground">{report.notes}</div> : null}
                        </div>
                        <div className="text-sm font-semibold">
                          {report.worked_minutes ? `${formatMinutes(report.worked_minutes)} שעות` : ""}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-wrap justify-center gap-3">
                  <Button size="lg" className="min-w-40" disabled={Boolean(openSession) || isPending} onClick={() => void postSessionAction("/api/profile/session/start")}>פתיחת משמרת</Button>
                  <Button size="lg" className="min-w-40" disabled={!openSession || isPending} onClick={() => void postSessionAction("/api/profile/session/end")}>סיום משמרת</Button>
                </div>
                {openSession ? <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
                  <Input value={sessionNote} onChange={(event) => setSessionNote(event.target.value)} placeholder="הערות למשמרת" />
                  <DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={sessionDomain} onChange={(value) => setSessionDomain(value as ExpenseBusinessDomain)} />
                  <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">{`זמן פתיחה: ${formatDateTime(openSession.clock_in)}`}</div>
                </div> : null}
                {actionError ? <div className="text-sm text-destructive">{actionError}</div> : null}
              </CardContent>
            </Card>
          )}

          {/* overflow-hidden: the shift list runs full-bleed (it cancels the
              padding below so its rules span the whole card), and without
              clipping those straight lines cut across the 1.5rem corner radius —
              the card looked like its border was broken at the bottom. */}
          <Card className="overflow-hidden">
            {/* Tighter side padding on a phone than the default p-6: the card
                already sits inside the page gutter, and 24px of card padding on
                top of that left the shift rows squeezed into the middle. */}
            <CardContent className="space-y-4 px-3 py-5 text-right md:px-6">
              <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                {/* Adding / editing / deleting a session outright is the boss's
                    call for a worker — his shifts arrive through the queue. */}
                {isWorker ? null : (
                  <Button type="button" variant="outline" onClick={openManualEditor}>הוספת משמרת ידנית</Button>
                )}
                <NativeSelect value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                  {monthOptions.map((summary) => <option key={summary.key} value={summary.key}>{summary.label}</option>)}
                </NativeSelect>
              </div>
              {/* Three numbers, one row — even on a phone. Stacked, they were
                  three full-width cards for three short figures. */}
              {selectedMonthSummary ? <div className="grid grid-cols-3 gap-2 md:gap-3">
                <StatCard label='סה"כ שעות' value={formatMinutes(selectedMonthSummary.totalMinutes)} />
                <StatCard label="כמות משמרות" value={`${selectedMonthSummary.sessionCount}`} />
                <StatCard label="משמרות פתוחות" value={`${selectedMonthSummary.openSessionCount}`} />
              </div> : <div className="text-sm text-muted-foreground">עדיין אין נתוני שעות.</div>}
              {/* Swipeable cards on a phone, a real table from md up. A worker
                  edits through the correction flow (withdraws the shift from
                  payroll, back to the queue); staff keep the direct editor,
                  which writes attendance_sessions in place. */}
              <SessionList
                items={selectedMonthSessions.map((session) => ({
                  session,
                  paymentStatus: payBySessionId[session.id],
                  linkLabel: linkLabelBySessionId[session.id],
                }))}
                showTiming={showSessionTimingForProfile}
                canEdit={isWorker}
                staffActions={
                  isWorker
                    ? undefined
                    : {
                        onEdit: (session) => openSessionEditor(session),
                        onDelete: (session) => setPendingDeleteSessionId(session.id),
                        disabled: isPending,
                      }
                }
              />
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === "salary" && showSalarySection ? (
        <section className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SummaryCard title="שכר נוכחי" value={currentAgreement ? currentAgreement.salary_type === "hourly" ? `${formatCurrency(currentAgreement.hourly_rate)} לשעה` : formatCurrency(currentAgreement.monthly_salary) : "-"} hint={currentAgreement ? `סוג שכר: ${getSalaryTypeLabel(currentAgreement.salary_type)}` : "אין משכורת פעילה"} />
            <SummaryCard title="תלוש אחרון" value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"} hint={latestPeriod ? `${latestPeriod.period_month} • ${getPayrollStatusLabel(latestPeriod.status)}` : "אין תלושים זמינים"} />
          </div>

          {/* The bottom line, across every period: what the work came to, what
              has been handed over, and what is still open. */}
          {payTotals ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">נצבר</div>
                <div className="text-base font-semibold">{formatCurrency(payTotals.earned)}</div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">שולם</div>
                <div className="text-base font-semibold text-success-soft-foreground">
                  {formatCurrency(payTotals.paid)}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">נותר לתשלום</div>
                <div className="text-base font-semibold text-warning-soft-foreground">
                  {formatCurrency(payTotals.owed)}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 px-3 py-5 md:px-6">
                <div className="text-lg font-semibold">היסטוריית שכר</div>
                {agreements.length === 0 ? (
                  <div className="text-sm text-muted-foreground">אין היסטוריית שכר זמינה.</div>
                ) : (
                  <>
                  {/* Phone: label-above-value rows. Five columns squeezed into a
                      360px screen turned every cell into a two-character sliver
                      with a sideways scrollbar under it. */}
                  <div className="space-y-2 md:hidden">
                    {agreements.map((agreement) => (
                      <div key={agreement.id} className="rounded-lg border p-3 text-sm">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold">
                            {agreement.salary_type === "hourly"
                              ? `${formatCurrency(agreement.hourly_rate)} לשעה`
                              : formatCurrency(agreement.monthly_salary)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {getSalaryTypeLabel(agreement.salary_type)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDate(agreement.valid_from)} - {formatDate(agreement.valid_to)}
                        </div>
                        {showSessionTimingForProfile ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            שעות תקן: {toNumber(agreement.standard_daily_hours)}
                            {agreement.overtime_rate ? ` · נוספות: ${formatCurrency(agreement.overtime_rate)}` : ""}
                          </div>
                        ) : null}
                        {agreement.notes ? (
                          <div className="mt-1 text-xs text-muted-foreground">{agreement.notes}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto rounded-lg border md:block">
                    <table className="w-full text-right text-sm">
                      <thead className="border-b bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">סוג</th>
                          <th className="px-3 py-2 font-medium">בתוקף</th>
                          <th className="px-3 py-2 font-medium">שכר</th>
                          {showSessionTimingForProfile ? (
                            <>
                              <th className="px-3 py-2 font-medium">שעות תקן</th>
                              <th className="px-3 py-2 font-medium">נוספות</th>
                            </>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {agreements.map((agreement, index) => (
                          <tr key={agreement.id} className={`border-b align-top ${index % 2 === 0 ? "bg-muted/20" : "bg-background"}`}>
                            <td className="px-3 py-2">
                              <div className="font-medium">{getSalaryTypeLabel(agreement.salary_type)}</div>
                              {agreement.notes ? <div className="mt-1 text-xs text-muted-foreground">{agreement.notes}</div> : null}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {formatDate(agreement.valid_from)} - {formatDate(agreement.valid_to)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-semibold">
                              {agreement.salary_type === "hourly" ? `${formatCurrency(agreement.hourly_rate)} לשעה` : formatCurrency(agreement.monthly_salary)}
                            </td>
                            {showSessionTimingForProfile ? (
                              <>
                                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{toNumber(agreement.standard_daily_hours)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{agreement.overtime_rate ? formatCurrency(agreement.overtime_rate) : "-"}</td>
                              </>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3 px-3 py-5 md:px-6">
                <div className="text-lg font-semibold">תלושי שכר</div>
                {payslips.length === 0 ? (
                  <div className="text-sm text-muted-foreground">אין תלושי שכר זמינים כרגע.</div>
                ) : (
                  <>
                  {/* Phone: the amount is what you came for, so it leads; the
                      breakdown (base + adjustments) reads as a sentence under it
                      rather than as three columns three characters wide. */}
                  <div className="space-y-2 md:hidden">
                    {payslips.map((payslip) => {
                      const period = periodsById.get(payslip.payroll_period_id) ?? null;
                      return (
                        <div key={payslip.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">{period?.period_month ?? "תקופת שכר"}</span>
                            <span className="font-semibold">{formatCurrency(payslip.gross_salary)}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getSalaryTypeLabel(payslip.calculated_salary_type)}
                            {showSessionTimingForProfile ? ` · ${formatMinutes(payslip.total_work_minutes)} שעות` : ""}
                            {period ? ` · ${getPayrollStatusLabel(period.status)}` : ""}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            בסיס {formatCurrency(payslip.calculated_base_salary)}
                            {toNumber(payslip.manual_adjustments) !== 0
                              ? ` · התאמות ${formatCurrency(payslip.manual_adjustments)}`
                              : ""}
                          </div>
                          {period ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatDate(period.start_date)} - {formatDate(period.end_date)} · צפי תשלום:{" "}
                              {getNextMonthDueText(period.end_date)}
                            </div>
                          ) : null}
                          {payslip.notes ? (
                            <div className="mt-1 text-xs text-muted-foreground">{payslip.notes}</div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto rounded-lg border md:block">
                    <table className="w-full text-right text-sm">
                      <thead className="border-b bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">תקופה</th>
                          <th className="px-3 py-2 font-medium">סוג</th>
                          {showSessionTimingForProfile ? <th className="px-3 py-2 font-medium">שעות</th> : null}
                          <th className="px-3 py-2 font-medium">שכר בסיס</th>
                          <th className="px-3 py-2 font-medium">התאמות</th>
                          <th className="px-3 py-2 font-medium">סכום</th>
                          <th className="px-3 py-2 font-medium">סטטוס</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payslips.map((payslip, index) => {
                          const period = periodsById.get(payslip.payroll_period_id) ?? null;
                          return (
                            <tr key={payslip.id} className={`border-b align-top ${index % 2 === 0 ? "bg-muted/20" : "bg-background"}`}>
                              <td className="px-3 py-2">
                                <div className="font-medium">{period?.period_month ?? "תקופת שכר"}</div>
                                {period ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatDate(period.start_date)} - {formatDate(period.end_date)} • צפי תשלום: {getNextMonthDueText(period.end_date)}
                                  </div>
                                ) : null}
                                {payslip.notes ? <div className="mt-1 text-xs text-muted-foreground">{payslip.notes}</div> : null}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{getSalaryTypeLabel(payslip.calculated_salary_type)}</td>
                              {showSessionTimingForProfile ? (
                                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatMinutes(payslip.total_work_minutes)}</td>
                              ) : null}
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatCurrency(payslip.calculated_base_salary)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatCurrency(payslip.manual_adjustments)}</td>
                              <td className="whitespace-nowrap px-3 py-2 font-semibold">{formatCurrency(payslip.gross_salary)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{period ? getPayrollStatusLabel(period.status) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      ) : null}

      <ViewDialog
        open={manualEditorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title="הוספת משמרת ידנית"
        description="דיווח משמרת שלא נרשמה בשעון."
        size="details4xl"
      >
        {renderEditor(null)}
      </ViewDialog>

      <ViewDialog
        open={Boolean(editorSession)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title="עריכת משמרת"
        description="עדכון שעות, פרויקט והערות למשמרת שדיווחת."
        size="details4xl"
      >
        {editorSession ? renderEditor(editorSession) : null}
      </ViewDialog>

      <ConfirmDialog
        open={pendingDeleteSessionId !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteSessionId(null);
        }}
        destructive
        title="מחיקת משמרת"
        description="המשמרת תימחק מהדיווח שלך."
        confirmLabel="מחיקה"
        loading={isPending}
        onConfirm={() => {
          if (pendingDeleteSessionId) void deleteSession(pendingDeleteSessionId);
          setPendingDeleteSessionId(null);
        }}
      />
    </div>
  );
}

function SummaryCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <Card><CardContent className="space-y-1 py-5"><div className="text-sm text-muted-foreground">{title}</div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{hint}</div></CardContent></Card>;
}
function StatCard({ label, value }: { label: string; value: string }) {
  // Sized to sit three-across on a phone: tighter padding, a label that may wrap
  // to two lines, and a figure that scales up only once there's room.
  return <div className="rounded-2xl border bg-muted/20 p-3 text-right md:p-4"><div className="text-xs text-muted-foreground md:text-sm">{label}</div><div className="mt-1 text-base font-semibold md:text-xl">{value}</div></div>;
}
