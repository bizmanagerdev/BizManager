"use client";
import { toHebrewError } from "@/lib/error-messages";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { ClockIcon, DesktopIcon, HideIcon, MobileIcon, NotificationIcon, ShowIcon, UserIcon, WalletIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ViewDialog } from "@/components/ui/view-dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSetPageTitle } from "@/components/layout/page-title-context";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import NotificationPrefs from "@/components/notifications/NotificationPrefs";
import PushSubscribeButton from "@/components/notifications/PushSubscribeButton";
import { DateInput, DateTimeInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { InitialsAvatar, isHexColor } from "@/components/dashboard/InitialsAvatar";
import { setAvatarColorCache } from "@/lib/ui/avatar-color";
import { setMyAvatarColor, setMyProfileDetails, setMyFontScale } from "@/lib/profile/selfSettings";
import { scheduleDeferredAction } from "@/lib/undo-engine";
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
import MyBonusCard from "@/components/payroll/MyBonusCard";
import SessionList from "@/components/attendance/SessionList";
import WorkerSummaryExport from "@/components/payroll/WorkerSummaryExport";
import type { MyPaymentAllocationRow, MyPaymentRow } from "@/lib/my-payroll";
import { PendingReportList } from "@/components/attendance/PendingReportList";
import type { PayslipItemRow as BonusItemRow } from "@/lib/payroll-bonuses";
import type { MyShiftReport } from "@/lib/attendance/my-shift";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/types";
import { commonDict } from "@/lib/i18n/dictionaries/common";
import { profileDict } from "@/lib/i18n/dictionaries/profile";

type Props = {
  profile: UserProfile;
  /** Office/admin are always "he"; only a worker ever sees "ar". */
  locale?: Locale;
  initialFontScale: number | null;
  /** The phone's own multiplier; null = follow the desktop one. */
  initialFontScaleMobile: number | null;
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
  /**
   * The «התאמת לוח» trigger, built by the page (it needs the widget catalog and
   * the saved prefs). Passed in rather than imported so this file stays out of
   * the dashboard's business; null for a worker, who has no board to arrange.
   */
  dashboardCustomizer?: ReactNode;
  openShiftReport?: MyShiftReport | null;
  pendingShiftReports?: MyShiftReport[];
  /** His own bonuses — one payslip_items row each. */
  myBonuses?: BonusItemRow[];
  /** Earned / paid / still owed across every period. Null when unreadable. */
  payTotals?: { earned: number; paid: number; owed: number } | null;
  /** session id → payment_status, so a shift row can say whether it was paid. */
  payBySessionId?: Record<string, string>;
  /** session id → the specific project name / property address it was booked to. */
  linkLabelBySessionId?: Record<string, string>;
  /** His own recorded payments, for the printable summary's "פירוט תשלומים" table. */
  payments?: MyPaymentRow[];
  paymentAllocations?: MyPaymentAllocationRow[];
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

export default function ProfileClient({ profile, locale = "he", initialFontScale, initialFontScaleMobile, initialAvatarColor, sessions, agreements, payslips, periods, monthlySummaries, projectOptions, propertyOptions, isWorker = false, dashboardCustomizer = null, openShiftReport = null, pendingShiftReports = [], myBonuses = [], payTotals = null, payBySessionId = {}, linkLabelBySessionId = {}, payments = [], paymentAllocations = [] }: Props) {
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
  const [detailsError, setDetailsError] = useState("");

  function saveDetails() {
    const name = detailsNameDraft.trim();
    if (!name) {
      setDetailsError(t(profileDict, locale, "errNameRequired"));
      return;
    }
    const phone = detailsPhoneDraft.trim() || null;
    const previousName = detailsName;
    const previousPhone = detailsPhone;
    setDetailsError("");
    setEditingDetails(false);
    scheduleDeferredAction({
      key: "profile:details",
      message: t(profileDict, locale, "detailsSavedToast"),
      onApplyOptimistic: () => {
        setDetailsName(name);
        setDetailsPhone(phone ?? "");
        setDetailsNameDraft(name);
        setDetailsPhoneDraft(phone ?? "");
      },
      onRevert: () => {
        setDetailsName(previousName);
        setDetailsPhone(previousPhone);
        setDetailsNameDraft(previousName);
        setDetailsPhoneDraft(previousPhone);
      },
      onCommit: async () => {
        const result = await setMyProfileDetails(name, phone);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, t(profileDict, locale, "detailsSaveFailed")) };
        // The name shows in the top bar / presence too — refresh the server tree.
        router.refresh();
        return { ok: true };
      },
    });
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
      setPasswordError(t(profileDict, locale, "errPasswordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t(profileDict, locale, "errPasswordMismatch"));
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
        setPasswordError(json.error || t(profileDict, locale, "passwordChangeFailed"));
        return;
      }
      setPasswordDone(true);
      setChangingPassword(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success(t(profileDict, locale, "passwordUpdatedToast"));
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const hebrew = toHebrewError(err, "");
      setPasswordError(
        hebrew ||
          (raw
            ? `${t(profileDict, locale, "passwordChangeFailedPrefix")}${raw}`
            : t(profileDict, locale, "passwordChangeFailed"))
      );
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
        label: monthLabelFromKey(currentKey, locale),
        totalMinutes: 0,
        sessionCount: 0,
        openSessionCount: 0,
      },
      ...monthlySummaries,
    ];
  }, [monthlySummaries, locale]);

  const [selectedMonth, setSelectedMonth] = useState(() => monthKeyFromDate(new Date()));

  // Global text-size multiplier. The whole UI is rem-based, so this scales
  // text, spacing and widths together (no squashing) — see app/globals.css.
  const FONT_SCALES = [
    { label: t(profileDict, locale, "fontScaleSmall"), scale: 0.9 },
    { label: t(profileDict, locale, "fontScaleNormal"), scale: 1 },
    { label: t(profileDict, locale, "fontScaleLarge"), scale: 1.15 },
    { label: t(profileDict, locale, "fontScaleXLarge"), scale: 1.3 },
    { label: t(profileDict, locale, "fontScaleHuge"), scale: 1.5 },
  ] as const;
  // Which screen each row of the chooser sets. Order matters: the device you're
  // most likely reading this on first.
  const FONT_SCALE_DEVICES = [
    { key: "desktop" as const, label: t(profileDict, locale, "deviceDesktop"), icon: DesktopIcon },
    { key: "mobile" as const, label: t(profileDict, locale, "deviceMobile"), icon: MobileIcon },
  ];
  const snapToScale = (value: number) =>
    FONT_SCALES.reduce(
      (best, option) =>
        Math.abs(option.scale - value) < Math.abs(best - value) ? option.scale : best,
      1 as number,
    );
  // TWO sizes, one per device class: the desktop multiplier (--font-scale) and
  // the phone's (--font-scale-mobile). The CSS picks between them by viewport, so
  // both are set here and only the one for the screen you're on takes effect —
  // which is why each chooser says which device it's for.
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
  // Falls back to the desktop size rather than to 1: before this setting existed
  // there was one value for both, and nobody's phone should silently reset.
  const [fontScaleMobile, setFontScaleMobile] = useState<number>(() => {
    if (initialFontScaleMobile && initialFontScaleMobile > 0) return snapToScale(initialFontScaleMobile);
    if (typeof window === "undefined") return snapToScale(initialFontScale ?? 1);
    const saved = Number(localStorage.getItem("biz-font-scale-mobile"));
    if (Number.isFinite(saved) && saved > 0) return snapToScale(saved);
    const desktop = Number(localStorage.getItem("biz-font-scale"));
    return Number.isFinite(desktop) && desktop > 0 ? snapToScale(desktop) : snapToScale(initialFontScale ?? 1);
  });
  useEffect(() => {
    const root = document.documentElement;
    // Older builds set an absolute inline font-size here; clear it so the CSS
    // calc(17px * var(--font-scale)) governs the size again.
    root.style.removeProperty("font-size");
    root.style.setProperty("--font-scale", String(fontScale));
    root.style.setProperty("--font-scale-mobile", String(fontScaleMobile));
    try {
      localStorage.setItem("biz-font-scale", String(fontScale));
      localStorage.setItem("biz-font-scale-mobile", String(fontScaleMobile));
    } catch (_) {}
  }, [fontScale, fontScaleMobile]);
  function selectFontScale(scale: number, device: "desktop" | "mobile") {
    if (device === "mobile") setFontScaleMobile(scale);
    else setFontScale(scale);
    // Persist to the account so the choice follows the user across devices.
    // Fire-and-forget: the local apply above already took effect.
    void setMyFontScale(scale, device).catch(() => {});
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
    void setMyAvatarColor(color)
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
  // Newest month first. The payslips query has no ORDER BY (it can't — the month
  // lives on the period, not the payslip), so unsorted they came back in whatever
  // order Postgres felt like: 05, 04, 07, 06.
  const sortedPayslips = useMemo(
    () =>
      [...payslips].sort((a, b) =>
        (periodsById.get(b.payroll_period_id)?.period_month ?? "").localeCompare(
          periodsById.get(a.payroll_period_id)?.period_month ?? ""
        )
      ),
    [payslips, periodsById]
  );
  const latestPayslip = sortedPayslips[0] ?? null;
  const latestPeriod = latestPayslip ? periodsById.get(latestPayslip.payroll_period_id) ?? null : null;
  // Bonus total per payslip, so the row can show what's inside its סכום rather
  // than leaving him to guess whether his ₪300 made it in.
  const bonusTotalByPayslipId = useMemo(() => {
    const next = new Map<string, number>();
    myBonuses.forEach((bonus) => {
      if (!bonus.payslip_id) return;
      next.set(bonus.payslip_id, (next.get(bonus.payslip_id) ?? 0) + toNumber(bonus.amount));
    });
    return next;
  }, [myBonuses]);
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
    if (!sessionEditClockIn) return t(profileDict, locale, "errStartTimeRequired");
    if (requireClockOut && !sessionEditClockOut) return t(profileDict, locale, "errEndTimeRequired");
    const clockInIso = toIso(sessionEditClockIn);
    const clockOutIso = sessionEditClockOut ? toIso(sessionEditClockOut) : "";
    if (!clockInIso) return t(profileDict, locale, "errStartTimeInvalid");
    if (sessionEditClockOut && !clockOutIso) return t(profileDict, locale, "errEndTimeInvalid");
    if (clockOutIso && new Date(clockOutIso) <= new Date(clockInIso)) return t(profileDict, locale, "errEndAfterStart");
    if (sessionEditDomain === "logistics_projects" && !sessionEditProjectId) return t(profileDict, locale, "errSelectProject");
    if (sessionEditDomain === "property_management" && !sessionEditPropertyId) return t(profileDict, locale, "errSelectProperty");
    if (
      sessionEditDomain === "logistics_projects" &&
      sessionEditBilledToCustomer &&
      !(Number(sessionEditBillToCustomerAmount) > 0)
    ) {
      return t(profileDict, locale, "errBillAmountRequired");
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
        if (!response.ok) return setActionError(toHebrewError(json.error, t(profileDict, locale, "actionFailed")));
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
        if (!response.ok) return setActionError(toHebrewError(json.error, t(profileDict, locale, "deleteSessionFailed")));
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
    if (!profile.id) return setActionError(t(profileDict, locale, "errNoWorkerForSave"));
    setActionError("");
    startTransition(async () => {
      try {
        const billToCustomer = sessionEditDomain === "logistics_projects" && sessionEditBilledToCustomer;
        const response = await fetch("/api/profile/session/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId, user_id: profile.id, business_domain: sessionEditDomain, project_id: sessionEditProjectId || null, property_id: sessionEditPropertyId || null, notes: sessionEditNotes.trim() || null, clock_in: toIso(sessionEditClockIn), clock_out: sessionEditClockOut ? toIso(sessionEditClockOut) : null, is_billable_to_customer: billToCustomer, bill_to_customer_amount: billToCustomer && sessionEditBillToCustomerAmount.trim() ? Number(sessionEditBillToCustomerAmount) : null, billing_status: billToCustomer ? "billable" : "not_billable" }) });
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) return setActionError(toHebrewError(json.error, t(profileDict, locale, "updateSessionFailed")));
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
        if (!response.ok) return setActionError(toHebrewError(json.error, t(profileDict, locale, "createSessionFailed")));
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
    if (!endLocal || !Number.isFinite(shiftEndMs) || shiftEndMs <= shiftStartMs) return t(profileDict, locale, "splitErrNeedShift");
    if (splitParts.length < 2) return t(profileDict, locale, "splitErrMin2");
    if (splitParts.length > 5) return t(profileDict, locale, "splitErrMax5");
    let prevMs = shiftStartMs;
    for (let index = 0; index < splitParts.length; index += 1) {
      const part = splitParts[index];
      const isLast = index === splitParts.length - 1;
      if (!isLast) {
        const boundaryMs = new Date(part.endTime).getTime();
        if (!part.endTime || !Number.isFinite(boundaryMs)) return t(profileDict, locale, "splitErrExitTimeRequiredTemplate").replace("{n}", String(index + 1));
        if (boundaryMs <= prevMs) return t(profileDict, locale, "splitErrExitAfterStartTemplate").replace("{n}", String(index + 1));
        if (boundaryMs >= shiftEndMs) return t(profileDict, locale, "splitErrExitBeforeEndTemplate").replace("{n}", String(index + 1));
        prevMs = boundaryMs;
      } else if (shiftEndMs - prevMs <= 0) return t(profileDict, locale, "splitErrNoTimeLast");
      if (part.domain === "logistics_projects" && !part.projectId) return t(profileDict, locale, "splitErrSelectProjectPartTemplate").replace("{n}", String(index + 1));
      if (part.domain === "property_management" && !part.propertyId) return t(profileDict, locale, "splitErrSelectPropertyPartTemplate").replace("{n}", String(index + 1));
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
        if (!response.ok) return setActionError(toHebrewError(json.error, t(profileDict, locale, "splitSessionFailed")));
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
          <option value="">{t(profileDict, locale, "selectPlaceholder")}</option>
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
          <div className="font-medium">{isManual ? t(profileDict, locale, "manualShiftTitle") : t(profileDict, locale, "editShiftTitle")}</div>
          <div className="flex flex-row-reverse flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending || Boolean(saveError)} onClick={() => isManual ? void createManualSession() : void saveSessionEdits(session.id)}>{isManual ? t(profileDict, locale, "saveShiftLabel") : t(profileDict, locale, "saveChangesLabel")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={closeEditor}>{t(profileDict, locale, "closeShort")}</Button>
          </div>
        </div>
        {showSessionTimingForProfile ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "startTimeLabel")}</span><DateTimeInput value={sessionEditClockIn} onChange={(event) => setSessionEditClockIn(event.target.value)} /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "totalHoursFieldLabel")}</span><Input inputMode="decimal" className="text-right" value={editedDurationHours} onChange={(event) => {
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
            }} placeholder={t(profileDict, locale, "hoursPlaceholderExample")} /></label>
            <label className="space-y-1"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "endTimeLabel")}</span><DateTimeInput value={sessionEditClockOut} onChange={(event) => setSessionEditClockOut(event.target.value)} /></label>
          </div>
        ) : (
          <label className="space-y-1 block"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "dateLabel")}</span><DateInput value={sessionEditDateOnly} onChange={(event) => {
            const next = event.target.value;
            if (!next) return;
            setSessionEditClockIn(`${next}T09:00`);
            setSessionEditClockOut(`${next}T10:00`);
          }} /></label>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "domainLabel")}</span><DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={sessionEditDomain} onChange={(value) => setEditorDomain(value as ExpenseBusinessDomain)} className="text-right" /></label>
          {sessionEditDomain === "logistics_projects" ? linkField(t(profileDict, locale, "projectLabel"), sessionEditProjectId, setSessionEditProjectId, projectOptions) : sessionEditDomain === "property_management" ? linkField(t(profileDict, locale, "propertyLabel"), sessionEditPropertyId, setSessionEditPropertyId, propertyOptions) : <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{t(profileDict, locale, "noSelectionNeeded")}</div>}
          <label className="space-y-1"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "notesLabel")}</span><textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-right text-sm outline-none" value={sessionEditNotes} onChange={(event) => setSessionEditNotes(event.target.value)} /></label>
        </div>
        {sessionEditDomain === "logistics_projects" ? (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="text-sm font-semibold">{t(profileDict, locale, "billCustomerTitle")}</div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sessionEditBilledToCustomer}
                onChange={(event) => {
                  setSessionEditBilledToCustomer(event.target.checked);
                  if (!event.target.checked) setSessionEditBillToCustomerAmount("");
                }}
              />
              <span>{t(profileDict, locale, "billToCustomerLabel")}</span>
            </label>
            {sessionEditBilledToCustomer ? (
              <label className="space-y-1 block">
                <span className="block text-xs text-muted-foreground">{t(profileDict, locale, "billAmountLabel")}</span>
                <CurrencyInput
                  value={sessionEditBillToCustomerAmount}
                  onChange={(event) => setSessionEditBillToCustomerAmount(event.target.value)}
                  placeholder={t(profileDict, locale, "billAmountPlaceholderExample")}
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-row-reverse flex-wrap gap-3 text-xs text-muted-foreground">{duration ? <div className="rounded-full border px-3 py-1">{t(profileDict, locale, "durationPrefix")}{duration}</div> : null}{session?.clock_out ? <div className="rounded-full border px-3 py-1">{t(profileDict, locale, "originalDurationPrefix")}{formatMinutes(sessionWorkedMinutes(session))}</div> : null}{suggestedAmount !== null ? <div className="rounded-full border px-3 py-1">{`${t(profileDict, locale, "suggestedAmountPrefix")}${formatCurrency(suggestedAmount)}`}</div> : null}</div>
        {saveError ? <div className="text-sm text-destructive">{saveError}</div> : null}
        {session?.clock_out && !isContractorWorker ? <div className="space-y-3 border-t pt-4">
          <label className="flex cursor-pointer flex-row-reverse items-center justify-end gap-3">
            <span className="font-medium">{t(profileDict, locale, "splitShiftLabel")}</span>
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={splitEnabled} onChange={(event) => toggleSplit(session, event.target.checked)} />
          </label>
          {splitEnabled ? (
            <>
              <p className="text-xs text-muted-foreground">{t(profileDict, locale, "splitHint")}</p>
              <div className="flex flex-row-reverse">
                <Button type="button" size="sm" variant="outline" disabled={splitParts.length >= 5} onClick={() => addSplitPart(session)}>{t(profileDict, locale, "addPartLabel")}</Button>
              </div>
              <div className="space-y-3">{splitPreview(session).map((part, index) => {
                const isLast = part.isLast;
                return <div key={part.id} className="rounded-xl border bg-background/70 p-3">
                  <div className="mb-2 flex flex-row-reverse flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{t(profileDict, locale, "partLabelTemplate").replace("{n}", String(index + 1))}</div>
                    <div className="flex flex-row-reverse flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{formatMinutes(part.minutes)}</span>{!isLast && splitParts.length > 2 ? <DeleteButton label={t(profileDict, locale, "removePartLabel")} onClick={() => removeSplitPart(part.id)} /> : null}</div>
                  </div>
                  <div className="flex flex-row-reverse flex-wrap items-end justify-end gap-2">
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "entryLabel")}</span><div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">{splitTimeLabel(part.startLocal)}</div></label>
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "exitLabel")}</span>{!isLast ? <Input type="datetime-local" className="h-9 w-44 text-right" min={part.startLocal || undefined} max={toLocalValue(session.clock_out) || undefined} value={splitParts[index]?.endTime ?? ""} onChange={(event) => updateSplitEndTime(part.id, event.target.value)} /> : <div className="flex h-9 min-w-24 items-center justify-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">{`${t(profileDict, locale, "untilShiftEndPrefix")}${splitTimeLabel(toLocalValue(session.clock_out))})`}</div>}</label>
                    <label className="space-y-1 text-right"><span className="block text-xs text-muted-foreground">{t(profileDict, locale, "domainLabel")}</span><DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={splitParts[index]?.domain ?? "general_business"} onChange={(value) => updateSplitPart(part.id, { domain: value as ExpenseBusinessDomain })} className="w-40 text-right" /></label>
                    {splitParts[index]?.domain === "logistics_projects" ? linkField(t(profileDict, locale, "projectLabel"), splitParts[index]?.projectId ?? "", (value) => updateSplitPart(part.id, { projectId: value }), projectOptions, true) : null}
                    {splitParts[index]?.domain === "property_management" ? linkField(t(profileDict, locale, "propertyLabel"), splitParts[index]?.propertyId ?? "", (value) => updateSplitPart(part.id, { propertyId: value }), propertyOptions, true) : null}
                  </div>
                </div>;
              })}</div>
              {currentSplitError ? <div className="text-sm text-destructive">{currentSplitError}</div> : null}
              <div className="flex flex-row-reverse"><Button type="button" size="sm" disabled={isPending || Boolean(currentSplitError)} onClick={() => void splitSavedSession(session.id)}>{t(profileDict, locale, "saveSplitLabel")}</Button></div>
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
    { key: "profile", label: t(profileDict, locale, "tabProfile"), icon: UserIcon },
    { key: "notifications", label: t(profileDict, locale, "tabNotifications"), icon: NotificationIcon },
    ...(canTrackSessions
      ? [{ key: "sessions" as ProfileTab, label: t(profileDict, locale, "tabAttendance"), icon: ClockIcon }]
      : []),
    // Salary stands alone: you can have payslips without punching shifts, and
    // it has nothing to do with preferences.
    ...(showSalarySection
      ? [{ key: "salary" as ProfileTab, label: t(profileDict, locale, "tabSalary"), icon: WalletIcon }]
      : []),
  ];
  // A stale/ineligible ?tab= falls back rather than showing an empty page.
  const activeTab: ProfileTab = tabs.some((t) => t.key === tabParam) ? tabParam : "profile";

  // The top bar mirrors the tab you're on ("נוכחות", "משכורת"…) rather than a
  // fixed "הפרופיל שלי". These are four separate errands under one route, so on a
  // phone — where the bar is the only thing naming the screen — a static title
  // says less than the tab strip right below it. Set here, not by a <PageTitle>
  // in the server page, because the active tab only exists on the client.
  const activeTabLabel = tabs.find((t) => t.key === activeTab)?.label ?? t(profileDict, locale, "pageTitle");
  useSetPageTitle(activeTabLabel, profile.full_name ?? undefined);

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
              <EditButton onClick={() => setEditingDetails(true)} label={t(profileDict, locale, "editDetailsLabel")} />
            ) : null}
          </div>

          {editingDetails ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t(profileDict, locale, "nameLabel")}</label>
                <Input value={detailsNameDraft} onChange={(e) => setDetailsNameDraft(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t(profileDict, locale, "phoneLabel")}</label>
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
                  onClick={() => {
                    setEditingDetails(false);
                    setDetailsNameDraft(detailsName);
                    setDetailsPhoneDraft(detailsPhone);
                    setDetailsError("");
                  }}
                >
                  {t(commonDict, locale, "cancel")}
                </Button>
                <Button size="sm" onClick={saveDetails}>
                  {t(commonDict, locale, "save")}
                </Button>
              </div>
            </div>
          ) : (
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">{t(profileDict, locale, "phoneLabel")}</dt>
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
                <dt className="text-muted-foreground">{t(profileDict, locale, "emailLabel")}</dt>
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
            <div className="text-sm font-semibold">{t(profileDict, locale, "passwordSectionTitle")}</div>
            {!changingPassword ? (
              <Button variant="secondary" size="sm" onClick={() => setChangingPassword(true)}>
                {t(profileDict, locale, "changePasswordLabel")}
              </Button>
            ) : null}
          </div>
          {changingPassword ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t(profileDict, locale, "newPasswordLabel")}</label>
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
                    aria-label={showPasswords ? t(profileDict, locale, "hidePasswordLabel") : t(profileDict, locale, "showPasswordLabel")}
                    tabIndex={-1}
                  >
                    {showPasswords ? <HideIcon className="h-4 w-4" /> : <ShowIcon className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t(profileDict, locale, "confirmPasswordLabel")}</label>
                <Input
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              {passwordError ? <div className="text-sm text-destructive">{passwordError}</div> : null}
              {passwordDone ? <div className="text-sm text-success">{t(profileDict, locale, "passwordUpdatedNote")}</div> : null}
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
                  {t(commonDict, locale, "cancel")}
                </Button>
                <Button size="sm" disabled={savingPassword} onClick={() => void savePassword()}>
                  {savingPassword ? t(profileDict, locale, "savingEllipsis") : t(commonDict, locale, "save")}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {passwordDone ? t(profileDict, locale, "passwordUpdatedNote") : t(profileDict, locale, "passwordHint")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* «התאמת לוח» lives here rather than on the dashboard itself (user,
          2026-08-17): it's a personal display preference like the two below it,
          and it was the one control standing between the board's header and its
          cards. A worker gets no button — his board is the clock, his tasks and
          his deliveries, so there'd be nothing to rearrange. */}
      {dashboardCustomizer ? (
        <Card>
          <CardContent className="py-5">
            <div className="mb-1 text-sm font-semibold">{t(profileDict, locale, "dashboardCustomizerTitle")}</div>
            <div className="mb-3 text-xs text-muted-foreground">
              {t(profileDict, locale, "dashboardCustomizerHint")}
            </div>
            {/* The list itself, open on the page — the same shape as every other
                section here, rather than a button that slides a panel in. */}
            {dashboardCustomizer}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="py-5">
          <div className="mb-1 text-sm font-semibold">{t(profileDict, locale, "fontSizeTitle")}</div>
          <div className="mb-4 text-xs text-muted-foreground">
            {t(profileDict, locale, "fontSizeHint")}
          </div>
          {/* Two rows, one per device class. Each applies to the screen it names,
              so changing the phone size from a desktop shows nothing here — the
              row is labelled for exactly that reason. */}
          <div className="space-y-4">
            {FONT_SCALE_DEVICES.map((device) => (
              <div key={device.key}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <device.icon className="h-4 w-4" />
                  {device.label}
                </div>
                <div className="flex flex-wrap gap-2">
                  {FONT_SCALES.map((option) => {
                    const current = device.key === "mobile" ? fontScaleMobile : fontScale;
                    const isActive = Math.abs(current - option.scale) < 0.01;
                    return (
                      <button
                        key={option.scale}
                        type="button"
                        onClick={() => selectFontScale(option.scale, device.key)}
                        aria-pressed={isActive}
                        className={`flex flex-col items-center gap-1 rounded-2xl border px-4 py-3 transition-all ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/25"
                            : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5"
                        }`}
                      >
                        <span style={{ fontSize: `${17 * option.scale}px`, lineHeight: 1 }}>{locale === "ar" ? "ا" : "א"}</span>
                        <span className="text-xs font-medium">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
            {t(profileDict, locale, "avatarColorTitle")}
            <InitialsAvatar name={profileName} color={avatarColor} size="md" />
          </div>
          <div className="mb-3 text-xs text-muted-foreground">
            {t(profileDict, locale, "avatarColorHint")}
          </div>
          <div className="flex flex-wrap gap-2">
            {AVATAR_COLOR_PRESETS.map((color) => {
              const isActive = avatarColor?.toUpperCase() === color.toUpperCase();
              return (
                <button
                  key={color}
                  type="button"
                  onClick={() => selectAvatarColor(color)}
                  aria-label={`${t(profileDict, locale, "selectColorAriaPrefix")}${color}`}
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
              {t(profileDict, locale, "customColorLabel")}
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
              {t(profileDict, locale, "autoColorLabel")}
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
                <div className="text-base font-semibold">{t(profileDict, locale, "pushTitle")}</div>
                <div className="text-sm text-muted-foreground">{t(profileDict, locale, "pushHint")}</div>
              </div>
              <PushSubscribeButton />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-5">
              <div className="mb-3 text-right">
                <div className="text-base font-semibold">{t(profileDict, locale, "prefsTitle")}</div>
                <div className="text-sm text-muted-foreground">{t(profileDict, locale, "prefsHint")}</div>
              </div>
              <NotificationPrefs viewerRole={profile.role} locale={locale} />
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
              <MyShiftCard openShift={openShiftReport} pendingCount={pendingShiftReports.length} locale={locale} />
              {/* Right under the clock: "I marked my hours, and I also got a
                  ₪300 bonus that day" is one thought, not two screens. */}
              <MyBonusCard bonuses={myBonuses} locale={locale} />
              {pendingShiftReports.length > 0 ? (
                <Card className="overflow-hidden">
                  <CardContent className="space-y-2 px-3 py-5 text-right sm:px-6">
                    <div className="text-lg font-semibold">{t(profileDict, locale, "pendingApprovalTitle")}</div>
                    <p className="text-sm text-muted-foreground">
                      {t(profileDict, locale, "pendingApprovalHint")}
                    </p>
                    <PendingReportList reports={pendingShiftReports} locale={locale} />
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-wrap justify-center gap-3">
                  <Button size="lg" className="min-w-40" disabled={Boolean(openSession) || isPending} onClick={() => void postSessionAction("/api/profile/session/start")}>{t(profileDict, locale, "startShiftLabel")}</Button>
                  <Button size="lg" className="min-w-40" disabled={!openSession || isPending} onClick={() => void postSessionAction("/api/profile/session/end")}>{t(profileDict, locale, "endShiftLabel")}</Button>
                </div>
                {openSession ? <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
                  <Input value={sessionNote} onChange={(event) => setSessionNote(event.target.value)} placeholder={t(profileDict, locale, "shiftNotesPlaceholder")} />
                  <DomainSelect domains={WORK_SESSION_BUSINESS_DOMAINS} value={sessionDomain} onChange={(value) => setSessionDomain(value as ExpenseBusinessDomain)} />
                  <div className="rounded-xl border bg-muted/30 px-3 py-2 text-sm">{`${t(profileDict, locale, "openTimePrefix")}${formatDateTime(openSession.clock_in)}`}</div>
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
                  <Button type="button" variant="outline" onClick={openManualEditor}>{t(profileDict, locale, "addManualShiftLabel")}</Button>
                )}
                <NativeSelect value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                  {monthOptions.map((summary) => <option key={summary.key} value={summary.key}>{summary.label}</option>)}
                </NativeSelect>
              </div>
              {/* Share/download a PDF or print the SAME selected month — the
                  exact "סיכום עבודה ותשלומים לעובד" report a boss can already
                  print for any worker from the salary center, just scoped to
                  this worker's own data (see WorkerSummaryExport). */}
              <WorkerSummaryExport
                workerName={profileName}
                workerPhone={profile.phone}
                monthLabel={selectedMonthSummary?.label ?? monthLabelFromKey(selectedMonth, locale)}
                monthKey={selectedMonth}
                selectedMonthSessions={selectedMonthSessions}
                linkLabelBySessionId={linkLabelBySessionId}
                agreements={agreements}
                payslips={payslips}
                periods={periods}
                payments={payments}
                paymentAllocations={paymentAllocations}
                locale={locale}
              />
              {/* Three numbers, one row — even on a phone. Stacked, they were
                  three full-width cards for three short figures. */}
              {selectedMonthSummary ? <div className="grid grid-cols-3 gap-2 md:gap-3">
                <StatCard label={t(profileDict, locale, "totalHoursStatLabel")} value={formatMinutes(selectedMonthSummary.totalMinutes)} />
                <StatCard label={t(profileDict, locale, "sessionCountLabel")} value={`${selectedMonthSummary.sessionCount}`} />
                <StatCard label={t(profileDict, locale, "openSessionCountLabel")} value={`${selectedMonthSummary.openSessionCount}`} />
              </div> : <div className="text-sm text-muted-foreground">{t(profileDict, locale, "noHoursDataYet")}</div>}
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
                locale={locale}
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
          {/* A global (monthly) worker has no נוכחות tab at all — no shifts to
              punch — so his bonus card lives here instead of next to a clock. */}
          {isWorker && !canTrackSessions ? <MyBonusCard bonuses={myBonuses} locale={locale} /> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SummaryCard title={t(profileDict, locale, "currentSalaryTitle")} value={currentAgreement ? currentAgreement.salary_type === "hourly" ? `${formatCurrency(currentAgreement.hourly_rate)} ${t(profileDict, locale, "hourlySuffix")}` : formatCurrency(currentAgreement.monthly_salary) : "-"} hint={currentAgreement ? `${t(profileDict, locale, "salaryTypePrefix")}${getSalaryTypeLabel(currentAgreement.salary_type)}` : t(profileDict, locale, "noActiveSalary")} />
            <SummaryCard title={t(profileDict, locale, "lastPayslipTitle")} value={latestPayslip ? formatCurrency(latestPayslip.gross_salary) : "-"} hint={latestPeriod ? latestPeriod.period_month : t(profileDict, locale, "noPayslipsAvailable")} />
          </div>

          {/* The bottom line, across every period: what the work came to, what
              has been handed over, and what is still open. */}
          {payTotals ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t(profileDict, locale, "earnedLabel")}</div>
                <div className="text-base font-semibold">{formatCurrency(payTotals.earned)}</div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t(profileDict, locale, "paidLabel")}</div>
                <div className="text-base font-semibold text-success-soft-foreground">
                  {formatCurrency(payTotals.paid)}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{t(profileDict, locale, "owedLabel")}</div>
                <div className="text-base font-semibold text-warning-soft-foreground">
                  {formatCurrency(payTotals.owed)}
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 px-3 py-5 md:px-6">
                <div className="text-lg font-semibold">{t(profileDict, locale, "salaryHistoryTitle")}</div>
                {agreements.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t(profileDict, locale, "noSalaryHistory")}</div>
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
                              ? `${formatCurrency(agreement.hourly_rate)} ${t(profileDict, locale, "hourlySuffix")}`
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
                            {t(profileDict, locale, "standardHoursPrefix")}{toNumber(agreement.standard_daily_hours)}
                            {agreement.overtime_rate ? `${t(profileDict, locale, "overtimePrefix")}${formatCurrency(agreement.overtime_rate)}` : ""}
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
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "typeHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "validHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "salaryHeader")}</th>
                          {showSessionTimingForProfile ? (
                            <>
                              <th className="px-3 py-2 font-medium">{t(profileDict, locale, "standardHoursHeader")}</th>
                              <th className="px-3 py-2 font-medium">{t(profileDict, locale, "overtimeHeader")}</th>
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
                              {agreement.salary_type === "hourly" ? `${formatCurrency(agreement.hourly_rate)} ${t(profileDict, locale, "hourlySuffix")}` : formatCurrency(agreement.monthly_salary)}
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
                <div className="text-lg font-semibold">{t(profileDict, locale, "payslipsTitle")}</div>
                {payslips.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t(profileDict, locale, "noPayslipsNow")}</div>
                ) : (
                  <>
                  {/* Phone: the amount is what you came for, so it leads; the
                      breakdown (base + adjustments) reads as a sentence under it
                      rather than as three columns three characters wide. */}
                  <div className="space-y-2 md:hidden">
                    {sortedPayslips.map((payslip) => {
                      const period = periodsById.get(payslip.payroll_period_id) ?? null;
                      const bonusTotal = bonusTotalByPayslipId.get(payslip.id) ?? 0;
                      return (
                        <div key={payslip.id} className="rounded-lg border p-3 text-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-medium">{period?.period_month ?? t(profileDict, locale, "payPeriodFallback")}</span>
                            <span className="font-semibold">{formatCurrency(payslip.gross_salary)}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getSalaryTypeLabel(payslip.calculated_salary_type)}
                            {showSessionTimingForProfile ? ` · ${formatMinutes(payslip.total_work_minutes)} ${t(profileDict, locale, "hoursSuffix")}` : ""}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t(profileDict, locale, "baseLabelPrefix")}{formatCurrency(payslip.calculated_base_salary)}
                            {bonusTotal > 0 ? `${t(profileDict, locale, "bonusesPrefix")}${formatCurrency(bonusTotal)}` : ""}
                            {toNumber(payslip.manual_adjustments) !== 0
                              ? `${t(profileDict, locale, "adjustmentsPrefix")}${formatCurrency(payslip.manual_adjustments)}`
                              : ""}
                          </div>
                          {period ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {formatDate(period.start_date)} - {formatDate(period.end_date)} · {t(profileDict, locale, "dueDatePrefix")}
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
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "periodHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "typeHeader")}</th>
                          {showSessionTimingForProfile ? <th className="px-3 py-2 font-medium">{t(profileDict, locale, "hoursHeader")}</th> : null}
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "baseSalaryHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "bonusesHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "adjustmentsHeader")}</th>
                          <th className="px-3 py-2 font-medium">{t(profileDict, locale, "amountHeader")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedPayslips.map((payslip, index) => {
                          const period = periodsById.get(payslip.payroll_period_id) ?? null;
                          const bonusTotal = bonusTotalByPayslipId.get(payslip.id) ?? 0;
                          return (
                            <tr key={payslip.id} className={`border-b align-top ${index % 2 === 0 ? "bg-muted/20" : "bg-background"}`}>
                              <td className="px-3 py-2">
                                <div className="font-medium">{period?.period_month ?? t(profileDict, locale, "payPeriodFallback")}</div>
                                {period ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatDate(period.start_date)} - {formatDate(period.end_date)} • {t(profileDict, locale, "dueDatePrefix")}{getNextMonthDueText(period.end_date)}
                                  </div>
                                ) : null}
                                {payslip.notes ? <div className="mt-1 text-xs text-muted-foreground">{payslip.notes}</div> : null}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground">{getSalaryTypeLabel(payslip.calculated_salary_type)}</td>
                              {showSessionTimingForProfile ? (
                                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatMinutes(payslip.total_work_minutes)}</td>
                              ) : null}
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatCurrency(payslip.calculated_base_salary)}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                                {bonusTotal > 0 ? formatCurrency(bonusTotal) : "—"}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatCurrency(payslip.manual_adjustments)}</td>
                              <td className="whitespace-nowrap px-3 py-2 font-semibold">{formatCurrency(payslip.gross_salary)}</td>
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
        title={t(profileDict, locale, "addManualShiftLabel")}
        description={t(profileDict, locale, "manualShiftDialogDescription")}
        size="details4xl"
      >
        {renderEditor(null)}
      </ViewDialog>

      <ViewDialog
        open={Boolean(editorSession)}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
        title={t(profileDict, locale, "editShiftTitle")}
        description={t(profileDict, locale, "editShiftDialogDescription")}
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
        title={t(profileDict, locale, "deleteShiftTitle")}
        description={t(profileDict, locale, "deleteShiftDescription")}
        confirmLabel={t(commonDict, locale, "delete")}
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
