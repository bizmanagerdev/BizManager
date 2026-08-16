"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import type { AlertMode, AlertRow, AlertSchedule } from "@/lib/notifications/types";
import { BUILTIN_ALERT_TYPES } from "@/lib/notifications/types";
import AlertMetricsPanel from "@/components/notifications/AlertMetricsPanel";
import { notifyAlertsChanged } from "@/lib/ui/alerts-refresh";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";

// This screen answers ONE question for an admin: which automatic alerts exist,
// and who gets them. That's the "live" rules list — everything else (scheduled
// digests, the night window, custom one-offs, the test runner, noise metrics) is
// plumbing, so it sits behind מתקדם.
//
// Not here on purpose:
//   * how MUCH each person wants (mode / summary hour / subscriptions) → /profile
//   * the dunning ladder → /collections, next to the debtors it chases
const ADVANCED_MODES: AlertMode[] = ["scheduled", "night"];
const MODE_LABEL: Record<AlertMode, string> = {
  scheduled: "סיכומים מתוזמנים",
  live: "התראות אוטומטיות",
  night: "התראת לילה",
};
const AUDIENCE_OPTIONS = [
  { value: "all", label: "כולם" },
  { value: "office", label: "משרד + ניהול" },
  { value: "admin", label: "ניהול בלבד" },
];
const AUDIENCE_LABEL: Record<string, string> = { all: "כולם", office: "משרד + ניהול", admin: "ניהול בלבד" };

type UserOption = { id: string; label: string };

const SCHEDULE_OPTIONS: { value: AlertSchedule; label: string }[] = [
  { value: "daily", label: "כל יום" },
  { value: "weekdays", label: "ימי עבודה (א–ה)" },
  { value: "sun", label: "ראשון" },
  { value: "mon", label: "שני" },
  { value: "tue", label: "שלישי" },
  { value: "wed", label: "רביעי" },
  { value: "thu", label: "חמישי" },
  { value: "fri", label: "שישי" },
  { value: "sat", label: "שבת" },
];

const BUILTIN_LABELS: Record<string, string> = {
  overdue_tasks: "משימות באיחור",
  today_tasks: "משימות להיום",
  tomorrow_tasks: "משימות למחר",
  projects_starting: "פרויקטים מתחילים",
  projects_deadline: "פרויקטים קרובים לסיום",
  deliveries: "משלוחים היום",
  weekly_summary: "סיכום שבועי",
  pending_attendance: "דיווחי נוכחות לאישור",
};

type PageSection = {
  key: string;
  label: string;
  baseUrl: string;
  optionsType?: "projects" | "customers" | "orders" | "tasks";
};

const PAGE_SECTIONS: PageSection[] = [
  { key: "dashboard", label: "לוח בקרה", baseUrl: "/dashboard" },
  { key: "tasks", label: "משימות", baseUrl: "/tasks", optionsType: "tasks" },
  { key: "projects", label: "פרויקטים", baseUrl: "/projects", optionsType: "projects" },
  { key: "sales", label: "מכירות", baseUrl: "/sales", optionsType: "orders" },
  { key: "customers", label: "לקוחות", baseUrl: "/customers", optionsType: "customers" },
  { key: "financial", label: "פיננסים", baseUrl: "/financial" },
  { key: "inbox", label: "התיבה", baseUrl: "/inbox" },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
function fmtHour(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

type FormState = {
  title: string;
  body: string;
  url: string;
  alert_type: string | null;
  enabled: boolean;
  send_hour_israel: number;
  schedule: AlertSchedule;
  recipient_user_ids: string[];
  audience_role: string;
  send_hour_end_israel: number;
};

const DEFAULT_FORM: FormState = {
  title: "",
  body: "",
  url: "/inbox",
  alert_type: null,
  enabled: true,
  send_hour_israel: 8,
  schedule: "daily",
  recipient_user_ids: [],
  audience_role: "office",
  send_hour_end_israel: 1,
};

export default function NotificationSettings({ users }: { users: UserOption[] }) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<AlertMode>("scheduled");
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AlertRow | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { alerts?: AlertRow[] } | null) => {
        if (!cancelled) setAlerts(d?.alerts ?? []);
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, []);

  async function loadAlerts() {
    const r = await fetch("/api/notifications/config").catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { alerts?: AlertRow[] };
    setAlerts(d.alerts ?? []);
  }

  function openAdd() {
    setEditingId(null);
    setEditingMode("scheduled"); // new alerts added here are scheduled digests
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  }

  function openEdit(alert: AlertRow) {
    setEditingId(alert.id);
    setEditingMode((alert.mode ?? "scheduled") as AlertMode);
    setForm({
      title: alert.title,
      body: alert.body,
      url: alert.url,
      alert_type: alert.alert_type,
      enabled: alert.enabled,
      send_hour_israel: alert.send_hour_israel,
      schedule: alert.schedule,
      recipient_user_ids: alert.recipient_user_ids ?? [],
      audience_role: alert.audience_role ?? "office",
      send_hour_end_israel: alert.send_hour_end_israel ?? 1,
    });
    setDialogOpen(true);
  }

  async function toggleEnabled(alert: AlertRow) {
    const next = !alert.enabled;
    setAlerts((prev) =>
      prev?.map((a) => (a.id === alert.id ? { ...a, enabled: next } : a)) ?? prev
    );
    await fetch(`/api/notifications/config/${alert.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  }

  async function saveForm() {
    if (!form.title.trim()) return;
    setSaving(true);
    if (editingId) {
      await fetch(`/api/notifications/config/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setAlerts((prev) =>
        prev?.map((a) => (a.id === editingId ? { ...a, ...form } : a)) ?? prev
      );
    } else {
      const r = await fetch("/api/notifications/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (r.ok) await loadAlerts();
    }
    setSaving(false);
    setDialogOpen(false);
  }

  async function deleteAlert(id: string) {
    setDeleting(id);
    await fetch(`/api/notifications/config/${id}`, { method: "DELETE" });
    setAlerts((prev) => prev?.filter((a) => a.id !== id) ?? prev);
    setDeleting(null);
    setConfirmDelete(null);
  }

  function summarizeRun(r: Record<string, unknown>): string {
    if (typeof r.skipped === "string") return `דילג (${r.skipped})`;
    const p: string[] = [];
    const t = r.totals as { inserted?: number; resolved?: number } | undefined;
    if (t) p.push(`נוצרו ${t.inserted ?? 0}, נסגרו ${t.resolved ?? 0}`);
    if (typeof r.pushed === "number") p.push(`${r.pushed} התראות`);
    if (typeof r.orderCount === "number") p.push(`${r.orderCount} הובלות · ${r.projectCount ?? 0} פרויקטים`);
    if (typeof r.notifications === "number") p.push(`${r.notifications} סיכומים`);
    if (typeof r.sent === "number") p.push(`נשלחו לנייד: ${r.sent}${r.failed ? ` (נכשלו ${r.failed})` : ""}`);
    return p.length ? p.join(" · ") : "בוצע";
  }

  async function runTest(which: string, label: string) {
    setRunning(which);
    setRunResult(null);
    try {
      const res = await fetch("/api/notifications/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ which }),
      });
      const d = (await res.json().catch(() => ({}))) as { result?: Record<string, unknown> };
      setRunResult(`${label}: ${summarizeRun(d.result ?? {})}`);
      // The sync may have opened/closed alerts — refresh the on-screen surfaces
      // (page bars + sidebar badges) so counts don't lag until the next poll.
      notifyAlertsChanged();
    } catch {
      setRunResult(`${label}: הבדיקה נכשלה`);
    } finally {
      setRunning(null);
    }
  }

  async function sendTest() {
    setTestSending(true);
    setTestResult(null);
    const res = await fetch("/api/notifications/send-test", { method: "POST" }).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as { sent?: number };
      setTestResult(`נשלחו ${d.sent ?? 0} התראות`);
    } else {
      setTestResult("שליחה נכשלה");
    }
    setTestSending(false);
  }

  if (!alerts) {
    return <div className="py-4 text-sm text-muted-foreground">טוען הגדרות...</div>;
  }

  function recipientLabel(ids: string[]) {
    if (!ids?.length) return "כולם";
    if (ids.length === 1) return users.find((u) => u.id === ids[0])?.label ?? "1 נבחר";
    return `${ids.length} נבחרו`;
  }

  function metaFor(alert: AlertRow, mode: AlertMode) {
    const hasRecipients = (alert.recipient_user_ids?.length ?? 0) > 0;
    if (mode === "live") {
      return hasRecipients
        ? recipientLabel(alert.recipient_user_ids)
        : AUDIENCE_LABEL[alert.audience_role ?? ""] ?? "לפי אחראי";
    }
    if (mode === "night") {
      return `${fmtHour(alert.send_hour_israel)}–${fmtHour(alert.send_hour_end_israel ?? 1)} · ${
        hasRecipients ? recipientLabel(alert.recipient_user_ids) : AUDIENCE_LABEL[alert.audience_role ?? "office"]
      }`;
    }
    return `${fmtHour(alert.send_hour_israel)} · ${recipientLabel(alert.recipient_user_ids)}`;
  }

  function AlertRowItem({ alert, mode }: { alert: AlertRow; mode: AlertMode }) {
    const isBuiltin = alert.alert_type && (BUILTIN_ALERT_TYPES as readonly string[]).includes(alert.alert_type);
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => void toggleEnabled(alert)}
          aria-label={alert.enabled ? "כבה התראה" : "הפעל התראה"}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${alert.enabled ? "bg-primary" : "bg-muted"}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${alert.enabled ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm font-medium ${alert.enabled ? "" : "text-muted-foreground"}`}>{alert.title}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            {isBuiltin && (
              <span className="rounded bg-info-soft px-1.5 py-px text-[10px] text-info-soft-foreground">
                {BUILTIN_LABELS[alert.alert_type!] ?? alert.alert_type}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">{metaFor(alert, mode)}</span>
          </div>
        </div>

        <EditButton onClick={() => openEdit(alert)} label="עריכת התראה" />

        {/* System rules (rule_key) aren't deletable — only toggled/edited. */}
        {!alert.rule_key ? (
          <DeleteButton
            label="מחיקת התראה"
            loading={deleting === alert.id}
            onClick={() => setConfirmDelete(alert)}
          />
        ) : null}
      </div>
    );
  }

  const liveRows = alerts.filter((a) => a.mode === "live");
  const advancedRows = alerts.filter((a) => ADVANCED_MODES.includes((a.mode ?? "scheduled") as AlertMode));

  return (
    <div className="space-y-3">
      {/* The whole point of the page: which automatic alerts run, and who gets them. */}
      <p className="text-xs text-muted-foreground">
        מה המערכת מזהה לבד, ולמי זה מגיע. כמה התראות כל אחד מקבל — נקבע אישית ב
        <a href="/profile#notifications" className="mx-1 text-primary hover:underline">
          אזור האישי
        </a>
        של כל משתמש.
      </p>

      {liveRows.length === 0 ? (
        <div className="rounded-xl border px-4 py-8 text-center text-sm text-muted-foreground">אין התראות מוגדרות</div>
      ) : (
        <div className="divide-y rounded-xl border">
          {liveRows.map((alert) => (
            <AlertRowItem key={alert.id} alert={alert} mode="live" />
          ))}
        </div>
      )}

      {/* Everything below is plumbing — collapsed by default. */}
      <details className="group rounded-xl border bg-muted/10">
        <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-muted-foreground">
          <span className="group-open:hidden">▸ </span>
          <span className="hidden group-open:inline">▾ </span>
          מתקדם — סיכומים מתוזמנים, התראת לילה, בדיקות
        </summary>

        <div className="space-y-3 border-t p-3">
          {advancedRows.length > 0
            ? ADVANCED_MODES.map((mode) => {
                const rows = alerts.filter((a) => (a.mode ?? "scheduled") === mode);
                if (rows.length === 0) return null;
                return (
                  <div key={mode}>
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{MODE_LABEL[mode]}</div>
                    <div className="divide-y rounded-xl border bg-background">
                      {rows.map((alert) => (
                        <AlertRowItem key={alert.id} alert={alert} mode={mode} />
                      ))}
                    </div>
                  </div>
                );
              })
            : null}

          <div className="flex items-center justify-end gap-2">
            {testResult && <span className="text-xs text-muted-foreground">{testResult}</span>}
            <Button variant="secondary" size="sm" onClick={sendTest} disabled={testSending}>
              {testSending ? "שולח..." : "שלח בדיקה לנייד"}
            </Button>
            <Button variant="secondary" size="sm" onClick={openAdd}>
              + סיכום מתוזמן
            </Button>
          </div>

          {/* Fire each engine on demand, ignoring its time gate. */}
          <div className="rounded-xl border bg-background p-3">
            <div className="mb-1 text-xs font-semibold">הרצה מיידית (ללא המתנה לשעה)</div>
            <div className="flex flex-wrap gap-2">
              {[
                { which: "sync", label: "סנכרון התראות" },
                { which: "deliver", label: "שליחת תזכורות" },
                { which: "nightly", label: "התראת לילה" },
                { which: "daily", label: "סיכומים" },
              ].map((b) => (
                <Button key={b.which} variant="secondary" size="sm" disabled={running !== null} onClick={() => void runTest(b.which, b.label)}>
                  {running === b.which ? "מריץ…" : b.label}
                </Button>
              ))}
            </div>
            {runResult ? <div className="mt-2 text-xs text-muted-foreground">{runResult}</div> : null}
          </div>

          <AlertMetricsPanel />
        </div>
      </details>

      {/* Add / Edit Dialog */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editingMode === "live" ? form.title : editingId ? "עריכת התראה" : "הוספת התראה"}
        description="מתי לשלוח, למי, ובאיזה ערוץ."
        onSubmit={() => void saveForm()}
        submitLabel="שמור"
        busyLabel="שומר..."
        busy={saving}
        submitDisabled={!form.title.trim()}
      >

          <div className="space-y-4 py-1">
            {/* An automatic rule writes its own title/text/link per finding, so the
                only thing there is to set here is WHO it goes to. Showing the
                title/body/url fields for it was pure noise. */}
            {editingMode === "live" ? (
              <p className="text-xs text-muted-foreground">
                המערכת מזהה את זה לבד וכותבת את הטקסט לכל מקרה. כאן קובעים רק למי זה שייך.
              </p>
            ) : (
              <>
                <Field size="xs" label="כותרת">
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="כותרת ההתראה"
                    className={inputCls}
                  />
                </Field>

                <Field size="xs" label="תוכן">
                  <input
                    value={form.body}
                    onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                    placeholder="טקסט ההתראה (אופציונלי)"
                    className={inputCls}
                  />
                </Field>

                <Field size="xs" label="קישור — עמוד שייפתח">
                  <UrlPicker value={form.url} onChange={(url) => setForm((f) => ({ ...f, url }))} />
                </Field>
              </>
            )}

            {editingMode === "scheduled" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field size="xs" label="שעת שליחה">
                    <NativeSelect value={form.send_hour_israel} onChange={(e) => setForm((f) => ({ ...f, send_hour_israel: Number(e.target.value) }))}>
                      {HOURS.map((h) => (
                        <option key={h} value={h}>{fmtHour(h)}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field size="xs" label="תדירות">
                    <NativeSelect value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value as AlertSchedule }))}>
                      {SCHEDULE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
                <Field size="xs" label="למי לשלוח">
                  <RecipientsDropdown users={users} selected={form.recipient_user_ids} onChange={(ids) => setForm((f) => ({ ...f, recipient_user_ids: ids }))} />
                </Field>
              </>
            ) : (
              <>
                {editingMode === "night" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field size="xs" label="משעה">
                      <NativeSelect value={form.send_hour_israel} onChange={(e) => setForm((f) => ({ ...f, send_hour_israel: Number(e.target.value) }))}>
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{fmtHour(h)}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field size="xs" label="עד שעה">
                      <NativeSelect value={form.send_hour_end_israel} onChange={(e) => setForm((f) => ({ ...f, send_hour_end_israel: Number(e.target.value) }))}>
                        {HOURS.map((h) => (
                          <option key={h} value={h}>{fmtHour(h)}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </div>
                ) : null}
                <Field size="xs" label="למי זה שייך (לפי תפקיד)">
                  <NativeSelect
                    value={form.audience_role}
                    onChange={(e) => setForm((f) => ({ ...f, audience_role: e.target.value }))}
                    disabled={editingMode === "live" && form.recipient_user_ids.length > 0} 
                  >
                    {AUDIENCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </NativeSelect>
                </Field>
                {editingMode === "live" ? (
                  <>
                    <Field size="xs" label="או לאנשים מסוימים (גובר על התפקיד)">
                      <RecipientsDropdown
                        users={users}
                        selected={form.recipient_user_ids}
                        onChange={(ids) => setForm((f) => ({ ...f, recipient_user_ids: ids }))}
                        emptyLabel="לפי התפקיד"
                      />
                    </Field>
                    <p className="rounded-lg bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
                      זה קובע <strong className="text-foreground">של מי</strong> ההתראה — כלומר למי היא מתריעה
                      לנייד. ניהול רואה בתיבה גם התראות של המשרד בכל מקרה; זה רק לא מצלצל להם.
                      התראות שיש להן אחראי (משימה, פרויקט) הולכות תמיד לאחראי עצמו.
                    </p>
                  </>
                ) : null}
              </>
            )}
          </div>

      </FormDialog>
      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        destructive
        title="מחיקת התראה"
        description="פעולה זו לא ניתנת לביטול."
        confirmLabel="מחק"
        loading={!!deleting}
        onConfirm={() => confirmDelete && void deleteAlert(confirmDelete.id)}
      >
        <p className="text-sm text-muted-foreground">
          האם למחוק את ההתראה <strong className="text-foreground">{confirmDelete?.title}</strong>?
        </p>
      </ConfirmDialog>
    </div>
  );
}

// ── Recipients dropdown ──────────────────────────────────────────────────────

function RecipientsDropdown({
  users,
  selected,
  onChange,
  emptyLabel = "כולם",
}: {
  users: UserOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Shown when nothing is picked. "כולם" for scheduled digests, "לפי התפקיד" for live rules. */
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const allSelected = selected.length === 0;

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  function toggle(id: string) {
    onChange(
      selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
    );
  }

  const label = allSelected
    ? emptyLabel
    : selected.length === 1
    ? (users.find((u) => u.id === selected[0])?.label ?? "1 נבחר")
    : `${selected.length} נבחרו`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between`}
      >
        <span>{label}</span>
        {open ? <ChevronUpIcon className="h-3 w-3 text-muted-foreground" /> : <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />}
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border bg-background shadow-lg"
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          {/* empty selection → all recipients (scheduled) / by role (live) */}
          <DropdownRow
            label={emptyLabel}
            checked={allSelected}
            onClick={() => onChange([])}
          />
          <div className="border-t" />
          {users.map((u) => (
            <DropdownRow
              key={u.id}
              label={u.label}
              checked={selected.includes(u.id)}
              onClick={() => toggle(u.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownRow({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted/40 ${
        checked ? "text-primary" : ""
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
          checked ? "border-primary bg-primary text-white" : "border-border"
        }`}
      >
        {checked ? <CheckIcon className="h-3 w-3" /> : null}
      </span>
      {label}
    </button>
  );
}

// ── URL Picker ───────────────────────────────────────────────────────────────

type NavOption = { id: string; label: string; url: string };

function UrlPicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [items, setItems] = useState<NavOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const fetchAbortRef = useRef<AbortController | null>(null);

  const activeSection = PAGE_SECTIONS.find(
    (s) => value === s.baseUrl || (s.optionsType && value.startsWith(s.baseUrl + "/"))
  );

  function selectSection(section: PageSection) {
    setSearch("");
    if (!section.optionsType) {
      setItems(null);
      onChange(section.baseUrl);
      return;
    }
    onChange(section.baseUrl);
    // Cancel any in-flight fetch
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    setLoading(true);
    fetch(`/api/nav-options?type=${section.optionsType}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { options?: NavOption[] } | null) => {
        setItems(d?.options ?? []);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== "AbortError") setLoading(false);
      });
  }

  const filtered = items
    ? search.trim()
      ? items.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
      : items
    : null;

  return (
    <div className="space-y-2">
      {/* Section chips */}
      <div className="flex flex-wrap gap-1">
        {PAGE_SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => void selectSection(s)}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              activeSection?.key === s.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Specific item picker — shown when section supports drill-down */}
      {activeSection?.optionsType && (
        <div className="rounded-lg border bg-muted/20 p-2 space-y-1.5">
          <div className="text-[11px] text-muted-foreground">בחר פריט ספציפי (אופציונלי)</div>

          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש..."
            className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />

          {loading && <div className="py-1 text-xs text-muted-foreground">טוען...</div>}

          {filtered && (
            <div className="max-h-40 overflow-y-auto space-y-px">
              {/* "All" option */}
              <button
                type="button"
                onClick={() => onChange(activeSection.baseUrl)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-muted/40 ${
                  value === activeSection.baseUrl ? "bg-primary/10 text-primary font-medium" : ""
                }`}
              >
                כל {activeSection.label}
              </button>

              {filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(item.url)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-muted/40 ${
                    value === item.url ? "bg-primary/10 text-primary font-medium" : ""
                  }`}
                >
                  {item.label}
                </button>
              ))}

              {filtered.length === 0 && (
                <div className="py-2 text-center text-xs text-muted-foreground">לא נמצאו תוצאות</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Final URL preview */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span>קישור:</span>
        <span dir="ltr" className="font-mono text-foreground">{value}</span>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary";


