"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AlertRow, AlertSchedule } from "@/lib/notifications/types";
import { BUILTIN_ALERT_TYPES } from "@/lib/notifications/types";

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
  { key: "alerts", label: "התראות", baseUrl: "/alerts" },
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
};

const DEFAULT_FORM: FormState = {
  title: "",
  body: "",
  url: "/alerts",
  alert_type: null,
  enabled: true,
  send_hour_israel: 8,
  schedule: "daily",
  recipient_user_ids: [],
};

export default function NotificationSettings({ users }: { users: UserOption[] }) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AlertRow | null>(null);
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

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
    setForm(DEFAULT_FORM);
    setDialogOpen(true);
  }

  function openEdit(alert: AlertRow) {
    setEditingId(alert.id);
    setForm({
      title: alert.title,
      body: alert.body,
      url: alert.url,
      alert_type: alert.alert_type,
      enabled: alert.enabled,
      send_hour_israel: alert.send_hour_israel,
      schedule: alert.schedule,
      recipient_user_ids: alert.recipient_user_ids ?? [],
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

  return (
    <div className="space-y-3">
      {/* Actions row */}
      <div className="flex items-center justify-end gap-2">
        {testResult && (
          <span className="text-xs text-muted-foreground">{testResult}</span>
        )}
        <Button variant="secondary" size="sm" onClick={sendTest} disabled={testSending}>
          {testSending ? "שולח..." : "שלח בדיקה"}
        </Button>
        <Button size="sm" onClick={openAdd}>+ הוסף</Button>
      </div>

      {/* Alert list */}
      <div className="divide-y rounded-xl border">
        {alerts.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            אין התראות מוגדרות
          </div>
        )}
        {alerts.map((alert) => {
          const isBuiltin =
            alert.alert_type &&
            (BUILTIN_ALERT_TYPES as readonly string[]).includes(alert.alert_type);
          return (
            <div key={alert.id} className="flex items-center gap-3 px-4 py-3">
              {/* Toggle */}
              <button
                type="button"
                onClick={() => void toggleEnabled(alert)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  alert.enabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    alert.enabled ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>

              {/* Title + meta */}
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-sm font-medium ${
                    alert.enabled ? "" : "text-muted-foreground"
                  }`}
                >
                  {alert.title}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  {isBuiltin && (
                    <span className="rounded bg-blue-50 px-1.5 py-px text-[10px] text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                      {BUILTIN_LABELS[alert.alert_type!] ?? alert.alert_type}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {fmtHour(alert.send_hour_israel)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">·</span>
                  <span className="text-[11px] text-muted-foreground">
                    {recipientLabel(alert.recipient_user_ids)}
                  </span>
                </div>
              </div>

              {/* Edit */}
              <button
                type="button"
                onClick={() => openEdit(alert)}
                className="shrink-0 rounded-lg border px-2.5 py-1 text-xs transition-colors hover:bg-muted/40"
                title="עריכה"
              >
                ✏️
              </button>

              {/* Delete */}
              <button
                type="button"
                onClick={() => setConfirmDelete(alert)}
                disabled={deleting === alert.id}
                className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:hover:bg-red-950/30"
                title="מחיקה"
              >
                {deleting === alert.id ? "..." : "✕"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingId ? "עריכת התראה" : "הוספת התראה"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Title */}
            <Field label="כותרת">
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="כותרת ההתראה"
                className={inputCls}
              />
            </Field>

            {/* Body */}
            <Field label="תוכן">
              <input
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="טקסט ההתראה (אופציונלי)"
                className={inputCls}
              />
            </Field>

            {/* URL */}
            <Field label="קישור — עמוד שייפתח">
              <UrlPicker
                value={form.url}
                onChange={(url) => setForm((f) => ({ ...f, url }))}
              />
            </Field>

            {/* Hour + Schedule */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="שעת שליחה">
                <select
                  value={form.send_hour_israel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, send_hour_israel: Number(e.target.value) }))
                  }
                  className={inputCls}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {fmtHour(h)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="תדירות">
                <select
                  value={form.schedule}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, schedule: e.target.value as AlertSchedule }))
                  }
                  className={inputCls}
                >
                  {SCHEDULE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Recipients */}
            <Field label="למי לשלוח">
              <RecipientsDropdown
                users={users}
                selected={form.recipient_user_ids}
                onChange={(ids) => setForm((f) => ({ ...f, recipient_user_ids: ids }))}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDialogOpen(false)}
            >
              ביטול
            </Button>
            <Button
              size="sm"
              onClick={() => void saveForm()}
              disabled={saving || !form.title.trim()}
            >
              {saving ? "שומר..." : "שמור"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>מחיקת התראה</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            האם למחוק את ההתראה{" "}
            <strong className="text-foreground">{confirmDelete?.title}</strong>?{" "}
            פעולה זו לא ניתנת לביטול.
          </p>
          <DialogFooter>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDelete(null)}
            >
              ביטול
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => confirmDelete && void deleteAlert(confirmDelete.id)}
              disabled={!!deleting}
            >
              {deleting ? "מוחק..." : "מחק"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Recipients dropdown ──────────────────────────────────────────────────────

function RecipientsDropdown({
  users,
  selected,
  onChange,
}: {
  users: UserOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
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
    ? "כולם"
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
        <span className="text-muted-foreground text-[10px]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border bg-background shadow-lg"
          style={{ maxHeight: 220, overflowY: "auto" }}
        >
          {/* כולם */}
          <DropdownRow
            label="כולם"
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
        {checked && "✓"}
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
