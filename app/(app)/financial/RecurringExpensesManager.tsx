"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AddDateIcon, AddReminderIcon, DeleteIcon, EditIcon, ExternalLinkIcon, InfoIcon, MoreIcon, RecurringIcon, SpinnerIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MetaRow } from "@/components/ui/meta-row";
import { NativeSelect } from "@/components/ui/native-select";
import { toHebrewError } from "@/lib/error-messages";
import { deleteRecurringExpenseTemplate } from "@/lib/recurring/deleteTemplate";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import ReminderFormDialog from "@/components/reminders/ReminderFormDialog";
import type { Account } from "@/lib/accounts";
import { DeleteButton, EditButton } from "@/components/ui/icon-button";
import { useUndoOverlay } from "@/hooks/useUndoOverlay";
import { scheduleDeferredDelete } from "@/lib/undo-engine";
import { OUTFLOW_SOURCE_KIND_LABEL, type OutflowSourceRow } from "@/lib/outflow-source-settings";
import { buildFixedPaymentRows, summarizeFixedPayments, type FixedPaymentRow } from "@/lib/fixed-payments";
import { useOutflowSources } from "./useOutflowSources";
import { useBackfillMissing } from "./useBackfillMissing";

const ExpenseDialog = dynamic(
  () => import("@/components/expenses/ExpenseDialog").then((mod) => mod.ExpenseDialog),
  { loading: () => null }
);

// ════════════════════════════════════════════════════════════════════════════
// "תשלומים קבועים" — ONE list of everything that leaves the business on a fixed
// rhythm, sorted by the day of the month it leaves on:
//
//   • recurring-expense TEMPLATES (הוצאות קבועות) — owned here: full edit,
//     delete, per-bill reminder, "fill in missing months"
//   • the OTHER SOURCES the payments board draws — a worker's monthly salary
//     (payroll), a loan's instalment plan (the loan page), a card's monthly
//     charge (statements). Their amounts and dates are managed THERE (למקור);
//     here only the planning layer around each: active on the board, alert N
//     work days before, the account it leaves from.
//
// The board reads by day, so this list reads by day too — a bill on the 10th
// sits next to the salary on the 10th, whatever kind it is.
// ════════════════════════════════════════════════════════════════════════════

type Option = {
  id: string;
  label: string;
};

type Frequency = "monthly" | "yearly";

export type RecurringExpenseTemplateItem = {
  id: string;
  template_name: string;
  category: string;
  amount: number;
  is_variable_amount: boolean;
  auto_paid: boolean;
  reminder_work_days_before: number | null;
  description_template: string | null;
  notes_template: string | null;
  business_domain: string;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  account_id: string | null;
  included_in_base_price: boolean;
  billed_to_customer: boolean;
  project_expense_notes_template: string | null;
  frequency: Frequency;
  interval_months: number;
  create_day_of_month: number;
  expense_day_of_month: number;
  create_month_of_year: number | null;
  expense_month_of_year: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
};

/** A source row's direction; older rows without the field are outgoing. */
function rowDirection(row: OutflowSourceRow): "out" | "in" {
  return row.direction === "in" ? "in" : "out";
}

type Props = {
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  orders: Option[];
  properties: Option[];
  accounts: Account[];
  missingSchema?: boolean;
  /**
   * Which way the money goes, from the hub's switch. The same control that
   * scopes the board scopes this list: both answer "what moves, and when".
   * Defaults to outgoing so the tab's other caller keeps its behaviour.
   */
  direction?: "out" | "in" | "all";
};

const MONTH_OPTIONS = [
  { value: "1", label: "ינואר" },
  { value: "2", label: "פברואר" },
  { value: "3", label: "מרץ" },
  { value: "4", label: "אפריל" },
  { value: "5", label: "מאי" },
  { value: "6", label: "יוני" },
  { value: "7", label: "יולי" },
  { value: "8", label: "אוגוסט" },
  { value: "9", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
] as const;

const REMINDER_CHOICES: Array<{ value: number; label: string }> = [
  { value: 0, label: "ללא תזכורת" },
  { value: 1, label: "יום עבודה לפני" },
  { value: 2, label: "2 ימי עבודה לפני" },
  { value: 3, label: "3 ימי עבודה לפני" },
  { value: 5, label: "5 ימי עבודה לפני" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function fmtDay(iso: string) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

// The recurring payment timing, NOT a concrete date — a monthly bill leaves on
// the same day every month (show just the day), a yearly one on a day+month.
function payScheduleLabel(t: RecurringExpenseTemplateItem): string {
  const day = t.expense_day_of_month || 1;
  if (t.frequency === "yearly") {
    const monthLabel = MONTH_OPTIONS.find((m) => m.value === String(t.expense_month_of_year ?? ""))?.label ?? "";
    return monthLabel ? `${day} ב${monthLabel}` : `${day} לחודש`;
  }
  const n = Math.max(1, t.interval_months || 1);
  if (n === 1) return `${day} לכל חודש`;
  if (n === 2) return `${day}, כל חודשיים`;
  return `${day}, כל ${n} חודשים`;
}

// Cadence sub-label under the day-of-month in the מועד column ("לכל חודש" etc.).
function moedSubLabel(t: RecurringExpenseTemplateItem): string {
  if (t.frequency === "yearly") {
    const monthLabel = MONTH_OPTIONS.find((m) => m.value === String(t.expense_month_of_year ?? ""))?.label ?? "";
    return monthLabel ? `ב${monthLabel}` : "בשנה";
  }
  const n = Math.max(1, t.interval_months || 1);
  if (n === 1) return "לכל חודש";
  if (n === 2) return "כל חודשיים";
  return `כל ${n} חודשים`;
}

// The sub-line under the template name: the description, and only when it adds
// information beyond the name (a bill named "ארנונה" with description "ארנונה"
// shows just the name). Category is a classification for reports — not shown here.
function secondaryLines(t: RecurringExpenseTemplateItem): string[] {
  const name = t.template_name?.trim() ?? "";
  const desc = t.description_template?.trim() ?? "";
  return desc && desc !== name ? [desc] : [];
}

// Where a source's own numbers live — said plainly, since this list can't edit them.
const SOURCE_OWNER: Record<OutflowSourceRow["kind"], string> = {
  salary: "מנוהל בשכר",
  loan: "מנוהל בדף ההלוואה",
  card: "מנוהל בדפי האשראי",
  rent: "מנוהל בחוזה השכירות",
  loan_in: "מנוהל בדף ההלוואה",
  settlement: "מגיע מחברת הסליקה",
};

function sourceBoardHref(row: OutflowSourceRow) {
  if (!row.focusId || !row.nextDate) return null;
  return `/financial/payments-calendar?focus=${encodeURIComponent(row.focusId)}&month=${row.nextDate.slice(0, 7)}`;
}

type UnifiedRow = FixedPaymentRow;

/** The per-row inline state: the three fields every row edits in place. */
type RowControls = { reminder: number; accountId: string; active: boolean; saving: boolean };
type EditField = "account" | "reminder" | "active";
/** Table-only hooks into an inline control: focus it on mount, and hear about a save. */
type ControlHooks<T extends HTMLElement> = { ref?: (el: T | null) => void; onSaved?: () => void };

export default function RecurringExpensesManager(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const templates = useUndoOverlay(props.templates, (t) => t.id, "recurring-expense-template");
  const sources = useOutflowSources();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringExpenseTemplateItem | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [remindTemplate, setRemindTemplate] = useState<RecurringExpenseTemplateItem | null>(null);
  const [accountFilter, setAccountFilter] = useState("");
  // "" = all kinds; "template" = הוצאה קבועה; otherwise a source kind.
  const [kindFilter, setKindFilter] = useState<"" | "template" | OutflowSourceRow["kind"]>("");

  // "השלמת חיובים חסרים" for a single row (the page header has the all-templates one).
  const backfill = useBackfillMissing();

  // ── Inline settings on TEMPLATE rows ─────────────────────────────────────
  // Account, reminder and active edit in place on every row — a bill exactly
  // like a salary or a card — so the list never shows the same field as text
  // on one row and a control on the next. A change re-saves the template
  // through the dialog's own route with all its other fields untouched (the
  // amount, day and name still edit through עריכה). Optimistic; reverts on error.
  const [templateState, setTemplateState] = useState<Record<string, RowControls>>({});
  const templateStateOf = (t: RecurringExpenseTemplateItem): RowControls =>
    templateState[t.id] ?? { reminder: t.reminder_work_days_before ?? 0, accountId: t.account_id ?? "", active: t.is_active, saving: false };
  async function saveTemplate(t: RecurringExpenseTemplateItem, patch: Partial<Pick<RowControls, "reminder" | "accountId" | "active">>) {
    const before = templateStateOf(t);
    const next = { ...before, ...patch, saving: true };
    setTemplateState((m) => ({ ...m, [t.id]: next }));
    try {
      const res = await fetch("/api/recurring-expenses/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: t.id,
          template_name: t.template_name,
          category: t.category,
          amount: t.amount,
          is_variable_amount: t.is_variable_amount,
          auto_paid: t.auto_paid,
          reminder_work_days_before: next.reminder || null,
          description_template: t.description_template,
          notes_template: t.notes_template,
          business_domain: t.business_domain,
          project_id: t.project_id,
          order_id: t.order_id,
          property_id: t.property_id,
          account_id: next.accountId || null,
          included_in_base_price: t.included_in_base_price,
          billed_to_customer: t.billed_to_customer,
          project_expense_notes_template: t.project_expense_notes_template,
          frequency: t.frequency,
          interval_months: t.interval_months,
          create_day_of_month: t.create_day_of_month,
          expense_day_of_month: t.expense_day_of_month,
          create_month_of_year: t.create_month_of_year,
          expense_month_of_year: t.expense_month_of_year,
          start_date: t.start_date,
          end_date: t.end_date,
          is_active: next.active,
          amount_propagation: "none",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error("שמירת ההגדרה נכשלה", { description: toHebrewError(json.error, "") });
        setTemplateState((m) => ({ ...m, [t.id]: { ...before, saving: false } }));
        return;
      }
      setTemplateState((m) => ({ ...m, [t.id]: { ...next, saving: false } }));
      toast.success("נשמר");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("שמירת ההגדרה נכשלה", { description: toHebrewError(err, "") });
      setTemplateState((m) => ({ ...m, [t.id]: { ...before, saving: false } }));
    }
  }
  // Templates as the list sees them: the server rows with any just-saved
  // inline values applied, so filters and the summary follow immediately.
  const effectiveTemplates = useMemo(
    () =>
      templates.map((t) => {
        const st = templateState[t.id];
        return st
          ? { ...t, account_id: st.accountId || null, reminder_work_days_before: st.reminder || null, is_active: st.active }
          : t;
      }),
    [templates, templateState]
  );

  // Bank-account scope for the list + summary — templates by their account,
  // sources by the account set for them (or their own).
  // The same יוצא/נכנס/הכל switch that scopes the board scopes this list:
  // both answer "what money moves, and when".
  const direction = props.direction ?? "out";
  const sourceRows = useMemo(() => {
    const all = sources.rows ?? [];
    const dir = props.direction ?? "out";
    return dir === "all" ? all : all.filter((r) => rowDirection(r) === dir);
  }, [sources.rows, props.direction]);
  // Recurring BILLS are outgoing by definition, so the נכנס view has none.
  const showTemplates = direction !== "in";
  const filteredTemplates = useMemo(
    () =>
      kindFilter && kindFilter !== "template"
        ? []
        : accountFilter
          ? effectiveTemplates.filter((t) => t.account_id === accountFilter)
          : effectiveTemplates,
    [effectiveTemplates, accountFilter, kindFilter]
  );
  const filteredSources = useMemo(
    () =>
      kindFilter === "template"
        ? []
        : sourceRows.filter(
            (r) =>
              (!kindFilter || r.kind === kindFilter) &&
              (!accountFilter || (sources.stateOf(r).accountId || "") === accountFilter)
          ),
    // stateOf reads the per-row state map; its identity changes with every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceRows, accountFilter, kindFilter, sources.stateOf]
  );

  // One list, by the day of the month the money leaves (lib/fixed-payments).
  const rows = useMemo<UnifiedRow[]>(
    () => buildFixedPaymentRows(showTemplates ? filteredTemplates : [], filteredSources),
    [showTemplates, filteredTemplates, filteredSources]
  );

  // The monthly-commitment pill (lib/fixed-payments): only what really leaves
  // every month is summed; one-off loans, hourly workers and cards are counted.
  const summary = useMemo(
    () => summarizeFixedPayments(filteredTemplates, filteredSources, (s) => sources.stateOf(s).active),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredTemplates, filteredSources, sources.stateOf]
  );

  function openEdit(template: RecurringExpenseTemplateItem) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }

  function remove() {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    scheduleDeferredDelete({
      scope: "recurring-expense-template",
      id,
      message: "ההוצאה הקבועה נמחקה",
      onCommit: async () => {
        const result = await deleteRecurringExpenseTemplate(id);
        if (!result.ok) return { ok: false, error: toHebrewError(result.error, "מחיקת ההוצאה הקבועה נכשלה.") };
        startTransition(() => { router.refresh(); });
        return { ok: true };
      },
    });
  }

  // The account filter IS the חשבון column's header on desktop (no separate
  // "חשבון:" row); on phones it sits above the cards.
  const accountFilterSelect = (className: string) => (
    <NativeSelect
      dense
      value={accountFilter}
      onChange={(e) => setAccountFilter(e.target.value)}
      aria-label="סינון לפי חשבון"
      className={`text-foreground ${className}`}
    >
      <option value="">כל החשבונות</option>
      {props.accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </NativeSelect>
  );

  // The type filter IS the סוג column's header, like the account filter.
  const kindFilterSelect = (className: string) => (
    <NativeSelect
      dense
      value={kindFilter}
      onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
      aria-label="סינון לפי סוג"
      className={`text-foreground ${className}`}
    >
      <option value="">כל הסוגים</option>
      <option value="template">הוצאה קבועה</option>
      {(Object.keys(OUTFLOW_SOURCE_KIND_LABEL) as Array<OutflowSourceRow["kind"]>).map((k) => (
        <option key={k} value={k}>{OUTFLOW_SOURCE_KIND_LABEL[k]}</option>
      ))}
    </NativeSelect>
  );

  // ── Cell renderers shared by the table and the cards ────────────────────
  const linkedLabelOf = (template: RecurringExpenseTemplateItem) =>
    template.project_id
      ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
      : template.property_id
        ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
        : template.order_id
          ? props.orders.find((item) => item.id === template.order_id)?.label ?? "הזמנה"
          : null;

  const kindBadge = (row: UnifiedRow) =>
    row.kind === "template" ? (
      <Badge variant="neutral">הוצאה קבועה</Badge>
    ) : (
      <Badge variant="neutral">{OUTFLOW_SOURCE_KIND_LABEL[row.source.kind]}</Badge>
    );

  const nameCell = (row: UnifiedRow) => {
    if (row.kind === "template") {
      const t = row.template;
      return (
        <>
          <div className="flex items-center gap-1.5">
            <RecurringIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="font-semibold">{t.template_name}</span>
          </div>
          {secondaryLines(t).map((line, i) => (
            <div key={i} className="text-xs text-muted-foreground">{line}</div>
          ))}
        </>
      );
    }
    const s = row.source;
    const href = sourceBoardHref(s);
    return (
      <>
        <div className="font-semibold">{s.name}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {s.nextDate ? (
            <>
              <span>הבא:</span>
              {href ? (
                <Link href={href} className="font-medium tabular-nums text-secondary underline-offset-2 hover:underline">
                  {fmtDay(s.nextDate)}
                </Link>
              ) : (
                <span className="tabular-nums">{fmtDay(s.nextDate)}</span>
              )}
            </>
          ) : null}
          {s.settled ? <Badge variant="success">שולם לחודש זה</Badge> : null}
        </div>
      </>
    );
  };

  const moedCell = (row: UnifiedRow) =>
    row.kind === "template" ? (
      <>
        <div className="text-lg font-bold tabular-nums leading-none">{row.template.expense_day_of_month}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{moedSubLabel(row.template)}</div>
      </>
    ) : (
      <>
        <div className="text-lg font-bold tabular-nums leading-none">{row.day === 32 ? "—" : row.day}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{row.source.scheduleLabel}</div>
      </>
    );

  const domainCell = (row: UnifiedRow) => {
    if (row.kind === "template") {
      const linked = linkedLabelOf(row.template);
      return (
        <>
          <div>{getBusinessDomainLabel(row.template.business_domain)}</div>
          {linked ? <Badge variant="neutral" className="mt-1">{linked}</Badge> : null}
        </>
      );
    }
    return <span className="text-muted-foreground">{SOURCE_OWNER[row.source.kind]}</span>;
  };

  // Amount, with how it leaves as a caption: a standing order (הוראת קבע) or a
  // card charge (אוטומטי) needs no confirmation — worth a word, not a column.
  const amountCell = (row: UnifiedRow) => {
    const auto = row.kind === "template" ? (row.template.auto_paid ? "הוראת קבע" : null) : row.source.kind === "card" ? "אוטומטי" : null;
    const caption = auto ? <div className="text-[11px] font-normal text-muted-foreground">{auto}</div> : null;
    if (row.kind === "template") {
      const t = row.template;
      return (
        <div>
          {t.is_variable_amount ? (
            <div className="flex items-center justify-end gap-1.5">
              {t.amount > 0 ? <span className="font-semibold tabular-nums">~{formatCurrency(t.amount)}</span> : null}
              <Badge variant="warning">משתנה</Badge>
            </div>
          ) : (
            <span className="font-semibold tabular-nums">{formatCurrency(t.amount)}</span>
          )}
          {caption}
        </div>
      );
    }
    const s = row.source;
    return (
      <div>
        {s.amount != null && s.amount > 0 ? (
          <span className="font-semibold tabular-nums">{formatCurrency(s.amount)}</span>
        ) : (
          <Badge variant="warning">משתנה</Badge>
        )}
        {caption}
      </div>
    );
  };

  // The three inline fields, addressed the same way whatever the row is.
  const controlsOf = (row: UnifiedRow) =>
    row.kind === "template"
      ? {
          name: row.template.template_name,
          st: templateStateOf(row.template),
          save: (patch: Partial<Pick<RowControls, "reminder" | "accountId" | "active">>) => void saveTemplate(row.template, patch),
        }
      : {
          name: row.source.name,
          st: sources.stateOf(row.source),
          save: (patch: Partial<Pick<RowControls, "reminder" | "accountId" | "active">>) => void sources.save(row.source, patch),
        };

  // A control fills its cell. In the table those columns have FIXED widths
  // (see <th>) and the read-mode text wears the select's exact box, so a row
  // swapping between text and controls never moves the table.
  const SELECT_WIDTH = "w-full";

  const accountCell = (row: UnifiedRow, hooks: ControlHooks<HTMLSelectElement> = {}) => {
    const { name, st, save } = controlsOf(row);
    return (
      <NativeSelect
        dense
        ref={hooks.ref}
        className={SELECT_WIDTH}
        value={st.accountId}
        disabled={st.saving}
        aria-label={`חשבון — ${name}`}
        onChange={(e) => {
          save({ accountId: e.target.value });
          hooks.onSaved?.();
        }}
      >
        <option value="">ללא חשבון</option>
        {props.accounts.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </NativeSelect>
    );
  };

  const reminderChoicesFor = (current: number) =>
    REMINDER_CHOICES.some((c) => c.value === current)
      ? REMINDER_CHOICES
      : [...REMINDER_CHOICES, { value: current, label: `${current} ימי עבודה לפני` }].sort((a, b) => a.value - b.value);

  const reminderCell = (row: UnifiedRow, hooks: ControlHooks<HTMLSelectElement> = {}) => {
    const { name, st, save } = controlsOf(row);
    return (
      <NativeSelect
        dense
        ref={hooks.ref}
        className={SELECT_WIDTH}
        value={String(st.reminder)}
        disabled={st.saving}
        aria-label={`תזכורת — ${name}`}
        onChange={(e) => {
          save({ reminder: Number(e.target.value) });
          hooks.onSaved?.();
        }}
      >
        {reminderChoicesFor(st.reminder).map((c) => (
          <option key={c.value} value={String(c.value)}>{c.label}</option>
        ))}
      </NativeSelect>
    );
  };

  // Same switch on every row (role=switch), so it reads as one family.
  const activeCell = (row: UnifiedRow, hooks: ControlHooks<HTMLButtonElement> = {}) => {
    const { name, st, save } = controlsOf(row);
    return (
      <button
        type="button"
        ref={hooks.ref}
        role="switch"
        aria-checked={st.active}
        aria-label={`פעיל — ${name}`}
        disabled={st.saving}
        onClick={() => {
          save({ active: !st.active });
          hooks.onSaved?.();
        }}
        className="flex h-9 items-center gap-2 text-xs font-medium text-muted-foreground disabled:opacity-60"
      >
        <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${st.active ? "bg-primary" : "bg-muted-foreground/30"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${st.active ? "right-0.5" : "right-[18px]"}`} />
        </span>
        {st.active ? "פעיל" : "לא פעיל"}
      </button>
    );
  };

  const actionsCell = (row: UnifiedRow) => {
    if (row.kind === "template") {
      const t = row.template;
      return (
        <div className="flex items-center gap-1">
          <Button type="button" size="icon-sm" variant="secondary" onClick={() => setRemindTemplate(t)} title="תזכורת" aria-label="תזכורת">
            <AddReminderIcon className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="secondary"
            onClick={() => void backfill.open({ id: t.id, label: t.template_name })}
            title="השלמת חיובים חסרים"
            aria-label="השלמת חיובים חסרים"
          >
            <AddDateIcon className="h-4 w-4" />
          </Button>
          <EditButton onClick={() => openEdit(t)} label="עריכה" />
          <DeleteButton onClick={() => setConfirmDeleteId(t.id)} />
        </div>
      );
    }
    return (
      <Button asChild type="button" size="icon-sm" variant="secondary" title="למקור" aria-label="למקור">
        <Link href={row.source.href}><ExternalLinkIcon className="h-4 w-4" /></Link>
      </Button>
    );
  };

  // Desktop table: every row's actions behind ONE ⋯ button (same as the
  // תנועות table), so the row stays one line and the table never needs a side
  // scroll. The mobile cards have the room and keep the buttons inline.
  const rowMenu = (row: UnifiedRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title="פעולות"
          aria-label={`פעולות — ${row.kind === "template" ? row.template.template_name : row.source.name}`}
        >
          <MoreIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {row.kind === "template" ? (
          <>
            <DropdownMenuItem onClick={() => setRemindTemplate(row.template)}>
              <AddReminderIcon className="me-2 h-4 w-4" />
              תזכורת
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void backfill.open({ id: row.template.id, label: row.template.template_name })}>
              <AddDateIcon className="me-2 h-4 w-4" />
              השלמת חיובים חסרים
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openEdit(row.template)}>
              <EditIcon className="me-2 h-4 w-4" />
              עריכה
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setConfirmDeleteId(row.template.id)} className="text-destructive focus:text-destructive">
              <DeleteIcon className="me-2 h-4 w-4" />
              מחיקה
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem asChild>
            <Link href={row.source.href}>
              <ExternalLinkIcon className="me-2 h-4 w-4" />
              למקור
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ── Desktop table: read by default, edit on demand ──────────────────────
  // Thirty rows × two selects + a switch is a form, and a list you mostly READ
  // shouldn't shout that every cell is editable. So the table shows the three
  // values as plain text; clicking one (or tabbing onto it) swaps THAT ROW to
  // its controls, focused on the value you picked. The row returns to text
  // once a value is saved, on Escape, or when focus leaves it. The mobile cards
  // keep their controls — one card at a time is not a wall of them.
  const [editing, setEditing] = useState<{ rowId: string; field: EditField; open: boolean } | null>(null);

  // Focus the picked control once when it mounts; a mouse click also opens a
  // select's option list so the click that asked for it isn't wasted.
  const focusOnMount = <T extends HTMLElement>(open: boolean) => (el: T | null) => {
    if (!el || el.dataset.focused) return;
    el.dataset.focused = "1";
    el.focus();
    if (open && el instanceof HTMLSelectElement) {
      try {
        (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
      } catch {
        // showPicker is best-effort (older browsers / no user activation).
      }
    }
  };

  // True when the row has nowhere to store what the controls would change.
  const isReadOnlySource = (row: UnifiedRow) => row.kind === "source" && row.source.configurable === false;

  const tableCell = (row: UnifiedRow, field: EditField) => {
    const { name, st } = controlsOf(row);
    // An incoming source has nowhere to store an account, a reminder or an
    // on/off flag (outflow_source_settings only knows the three outgoing
    // kinds), so the cell states the fact instead of offering a control that
    // would throw the change away.
    if (isReadOnlySource(row)) {
      return (
        <span className="flex h-9 items-center px-3 text-sm text-muted-foreground">
          {field === "active" ? "פעיל" : "—"}
        </span>
      );
    }
    if (editing?.rowId === row.id) {
      const focus = editing.field === field ? focusOnMount(editing.open) : undefined;
      const done = () => setEditing(null);
      if (field === "account") return accountCell(row, { ref: focus, onSaved: done });
      if (field === "reminder") return reminderCell(row, { ref: focus, onSaved: done });
      return activeCell(row, { ref: focus, onSaved: done });
    }
    const text =
      field === "account" ? (
        st.accountId ? (
          props.accounts.find((a) => a.id === st.accountId)?.name ?? "חשבון לא ידוע"
        ) : (
          <span className="text-muted-foreground">ללא חשבון</span>
        )
      ) : field === "reminder" ? (
        st.reminder ? (
          reminderChoicesFor(st.reminder).find((c) => c.value === st.reminder)?.label
        ) : (
          <span className="text-muted-foreground">ללא תזכורת</span>
        )
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${st.active ? "bg-success" : "bg-muted-foreground/40"}`} />
          {st.active ? "פעיל" : "לא פעיל"}
        </span>
      );
    const fieldLabel = field === "account" ? "חשבון" : field === "reminder" ? "תזכורת" : "פעיל";
    return (
      <button
        type="button"
        disabled={st.saving}
        // Mouse: skip the focus hop and open the control straight away.
        // Keyboard: focus alone swaps the row, without popping a picker.
        onMouseDown={(e) => {
          e.preventDefault();
          setEditing({ rowId: row.id, field, open: true });
        }}
        onFocus={() => setEditing({ rowId: row.id, field, open: false })}
        aria-label={`${fieldLabel} — ${name}: עריכה`}
        // Same box as the dense select / the switch (h-9, border, px-3), with
        // the border hidden until hover — so the swap changes nothing's size.
        className={`flex h-9 w-full items-center rounded-lg border border-transparent text-right text-sm transition-colors hover:border-input hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
          field === "active" ? "" : "px-3"
        }`}
      >
        <span className="truncate">{text}</span>
      </button>
    );
  };

  const isOff = (row: UnifiedRow) => !controlsOf(row).st.active;

  const hasAnything = templates.length > 0 || sourceRows.length > 0;

  return (
    <div dir="rtl" className="space-y-4 text-right">
      {/* Summary — the headline figure and what it counts, on dark; what it
          leaves OUT gets its own light line below, in readable type: an
          exclusion is a fact about the number, not a footnote. */}
      {hasAnything ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 rounded-xl bg-foreground px-4 py-2.5 text-background">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {/* Salaries / loans load client-side after the templates, so a total
                  shown before they arrive is only part of the sum and then jumps.
                  Hold a same-size placeholder until the whole number is known. */}
              {sources.loading ? (
                <div className="h-7 w-32 animate-pulse rounded-md bg-background/20" aria-label="טוען סכום" />
              ) : (
                <div className="text-xl font-bold tabular-nums">{formatCurrency(summary.monthlyTotal)}</div>
              )}
              <div className="text-xs opacity-70">סה״כ התחייבות חודשית קבועה · רק מה שיוצא כל חודש</div>
            </div>
            <div className="text-xs opacity-90">
              {sources.loading ? (
                <span className="inline-flex items-center gap-2">
                  <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                  טוען משכורות, הלוואות וכרטיסים...
                </span>
              ) : (
                <MetaRow
                  items={[
                    `${summary.activeCount} הוצאות קבועות`,
                    summary.monthlySourceCount ? `${summary.monthlySourceCount} משכורות והלוואות חודשיות` : null,
                    summary.variableCount ? `${summary.variableCount} בסכום משתנה` : null,
                  ]}
                />
              )}
            </div>
          </div>
          {!sources.loading && (summary.oneOffLoanCount || summary.hourlyCount || summary.cardCount) ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">לא נכלל בסכום: </span>
              <MetaRow
                className="inline"
                items={[
                  summary.oneOffLoanCount ? `${summary.oneOffLoanCount} הלוואות בהחזר חד-פעמי` : null,
                  summary.hourlyCount ? `${summary.hourlyCount} עובדים לפי שעות` : null,
                  summary.cardCount ? `${summary.cardCount} כרטיסי אשראי — הסכום ידוע רק כשהדף מעובד` : null,
                ]}
              />
            </p>
          ) : null}
        </div>
      ) : null}


      {props.missingSchema ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            צריך קודם להריץ את [db/sql/create_recurring_expense_templates.sql] כדי לנהל הוצאות קבועות.
          </CardContent>
        </Card>
      ) : null}

      {sources.error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">
            משכורות, הלוואות וכרטיסים לא נטענו: {sources.error}
          </CardContent>
        </Card>
      ) : null}

      {!hasAnything && !sources.loading ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            אין עדיין תשלומים קבועים. אפשר להתחיל משכירות, ביטוחים, רכב, אינטרנט או כל הוצאה שחוזרת כל חודש או כל שנה;
            משכורות חודשיות, הלוואות פעילות וכרטיסי אשראי יופיעו כאן מעצמם.
          </CardContent>
        </Card>
      ) : !hasAnything && sources.loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            <span>טוען משכורות, הלוואות וכרטיסים...</span>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          {/* The filters live in the table header, which isn't shown when nothing
              matches — so the way back is offered right here. */}
          <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-muted-foreground">
            <span>אין תשלומים קבועים לפי הסינון שנבחר.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => { setAccountFilter(""); setKindFilter(""); }}>
              ניקוי סינון
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="@container space-y-2">
          {/* One quiet row above the list: ⓘ with the explanation (nobody reads
              three grey lines above a table), and — where there is no column
              header to hold it — the account filter. */}
          <div className="flex items-center justify-between gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground" aria-label="מה יש ברשימה הזו?">
                  <InfoIcon className="h-4 w-4" />
                  <span className="text-xs">מה יש כאן?</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3 text-sm leading-relaxed">
                הוצאות קבועות נערכות כאן במלואן. משכורות, החזרי הלוואות וחיובי כרטיס מגיעים מהשכר, מדפי ההלוואות ומדפי האשראי —
                הסכום והמועד נקבעים שם. כאן, לכל שורה: אם היא פעילה בלוח, התזכורת (ימי עבודה לפני — שישי ושבת לא נספרים) והחשבון שממנו הכסף יוצא.
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex flex-wrap items-center gap-2 @5xl:hidden">
              {kindFilterSelect("w-auto min-w-[9rem]")}
              {props.accounts.length > 0 ? accountFilterSelect("w-auto min-w-[10rem]") : null}
            </div>
          </div>

          {/* Cards — until the container is wide enough for the table. The
              breakpoint is in rem, so a large text setting flips to cards too. */}
          <div className="space-y-2 @5xl:hidden">
            {rows.map((row) => (
              <Card key={row.id} className={`overflow-hidden ${isOff(row) ? "opacity-60" : ""}`}>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-primary">
                      מועד תשלום: <span className="tabular-nums">{row.kind === "template" ? payScheduleLabel(row.template) : row.source.scheduleLabel}</span>
                    </div>
                    {kindBadge(row)}
                  </div>
                  <div className="space-y-1">{nameCell(row)}</div>
                  <div className="text-xs text-muted-foreground">{domainCell(row)}</div>
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <div>סכום: <span className="text-foreground">{amountCell(row)}</span></div>
                      {row.kind === "template" ? (
                      <>
                        <div>
                          טווח: <span className="text-foreground">{row.template.start_date || "ללא התחלה"} | {row.template.end_date || "ללא סוף"}</span>
                        </div>
                        {row.template.notes_template ? (
                          <div>הערות: <span className="text-foreground">{row.template.notes_template}</span></div>
                        ) : null}
                      </>
                    ) : null}
                    <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">חשבון</span>
                        {accountCell(row)}
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">תזכורת</span>
                        {reminderCell(row)}
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {activeCell(row)}
                    {actionsCell(row)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Table — once the container is wide enough (a rem breakpoint, so it
              also yields to cards under a large text setting). Cells wrap rather
              than the table growing past the page — no side scroll. */}
          <div className="hidden max-h-[70vh] overflow-y-auto rounded-xl border @5xl:block">
            <table dir="rtl" className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b-2 bg-muted text-xs font-semibold text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">מועד תשלום</th>
                  <th className="w-[10rem] min-w-[10rem] px-3 py-2 text-right font-medium">{kindFilterSelect("w-full")}</th>
                  <th className="px-3 py-2 text-right font-medium">שם ותיאור</th>
                  <th className="px-3 py-2 text-right font-medium">תחום · שיוך</th>
                  <th className="px-3 py-2 text-right font-medium">סכום</th>
                  <th className="w-[12rem] min-w-[12rem] px-3 py-2 text-right font-medium">
                    {props.accounts.length > 0 ? accountFilterSelect("w-full") : "חשבון"}
                  </th>
                  <th className="w-[11rem] min-w-[11rem] px-3 py-2 text-right font-medium">תזכורת</th>
                  <th className="w-[7rem] min-w-[7rem] px-3 py-2 text-right font-medium">פעיל</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`align-top hover:bg-secondary/10 ${isOff(row) ? "opacity-60" : ""} ${editing?.rowId === row.id ? "bg-secondary/5" : ""}`}
                    onBlur={(e) => {
                      if (editing?.rowId === row.id && !e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && editing?.rowId === row.id) setEditing(null);
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-2">{moedCell(row)}</td>
                    <td className="px-3 py-2">{kindBadge(row)}</td>
                    <td className="px-3 py-2">{nameCell(row)}</td>
                    <td className="px-3 py-2">{domainCell(row)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{amountCell(row)}</td>
                    <td className="px-3 py-2">{tableCell(row, "account")}</td>
                    <td className="px-3 py-2">{tableCell(row, "reminder")}</td>
                    <td className="px-3 py-2">{tableCell(row, "active")}</td>
                    <td className="w-10 px-1 py-2">{rowMenu(row)}</td>
                  </tr>
                ))}
                {sources.loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <SpinnerIcon className="h-3.5 w-3.5 animate-spin" />
                        טוען משכורות, הלוואות וכרטיסים...
                      </span>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingRecurringTemplate={editingTemplate}
        defaultRecurring={!editingTemplate}
        recurringProjects={props.projects}
        recurringOrders={props.orders}
        recurringProperties={props.properties}
        onSaved={() => {
          setDialogOpen(false);
          startTransition(() => { router.refresh(); });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteId)}
        onOpenChange={(next) => { if (!next) setConfirmDeleteId(null); }}
        title="מחיקת הוצאה קבועה"
        description="ההוצאה הקבועה תימחק ולא ייווצרו ממנה הוצאות חדשות. הוצאות שכבר נוצרו יישארו."
        confirmLabel="מחיקה"
        destructive
        onConfirm={remove}
      />

      {backfill.dialog}

      <ReminderFormDialog
        mode="create"
        open={Boolean(remindTemplate)}
        onOpenChange={(o) => { if (!o) setRemindTemplate(null); }}
        category="task"
        defaultNote={remindTemplate ? `הוצאה קבועה: ${remindTemplate.template_name}` : undefined}
        onSaved={() => setRemindTemplate(null)}
      />
    </div>
  );
}
