"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel, isExpenseBusinessDomain } from "@/lib/expenses";
import { findDuplicate, norm, shiftIso, type ExistingExpense } from "@/lib/financial/cardImport";

type Option = { id: string; name: string };

export type StatementRowView = {
  id: string;
  expenseId: string | null;
  expenseExists: boolean;
  expenseDate: string;
  transactionDate: string;
  amount: number;
  description: string;
  category: string;
  businessDomain: string;
  projectId: string;
  propertyId: string;
  notes: string;
  assignmentRaw: string;
  include: boolean;
  // Income side — a row can also be recorded as a customer payment (independent of the expense).
  incomePaymentId: string | null;
  incomeExists: boolean;
  incomeAmount: number;
};

// Payment methods offered for statement income (no check flow here — use the financial page for that).
const INCOME_METHODS: { value: string; label: string }[] = [
  { value: "credit_card", label: "כרטיס אשראי" },
  { value: "bank_transfer", label: "העברה בנקאית" },
  { value: "cash", label: "מזומן" },
  { value: "bit", label: "ביט" },
];

type IncomeForm = {
  businessDomain: string;
  projectId: string;
  orderId: string;
  propertyId: string;
  amount: string;
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  notes: string;
};

type Statement = {
  id: string;
  fileName: string;
  source: "excel" | "pdf";
  createdCount: number;
  totalRows: number;
  createdAt: string;
  markedDone: boolean;
};

// Fixed dedup window (days) — matches the importer's default.
const DUP_WINDOW = 3;

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 }).format(value);
}

function formatIsoDisplay(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1].slice(-2)}` : iso || "—";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}

type RowMode = "draft" | "created" | "deleted";
function rowMode(row: StatementRowView): RowMode {
  if (row.expenseExists) return "created";
  if (row.expenseId) return "deleted"; // had an expense, since deleted
  return "draft"; // never materialized — assignable here
}

// A row whose original שיוך is an "X" (marked as not the cardholder's / not mine).
function isXRow(assignmentRaw: string): boolean {
  const v = norm(assignmentRaw);
  return v.toLowerCase() === "x" || v === "✗" || v === "✖";
}

export default function StatementDetailClient({
  statement,
  rows: initialRows,
  projects,
  properties,
  orders,
  fileUrl,
}: {
  statement: Statement;
  rows: StatementRowView[];
  projects: Option[];
  properties: Option[];
  orders: Option[];
  fileUrl: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<StatementRowView[]>(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StatementRowView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [markedDone, setMarkedDone] = useState(statement.markedDone);
  const [markingDone, setMarkingDone] = useState(false);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<string | null>(null);
  const bypassGuard = useRef(false);

  const [dupByRowId, setDupByRowId] = useState<Record<string, ExistingExpense | null>>({});
  // Rows the user dismissed as "not a duplicate" — stay un-flagged even when the scan re-runs.
  const [ignoredDupIds, setIgnoredDupIds] = useState<Set<string>>(() => new Set());

  // Income dialog (per-row or per-card).
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [incomeRowIds, setIncomeRowIds] = useState<string[]>([]);
  const [incomeTitle, setIncomeTitle] = useState("");
  const [incomeForm, setIncomeForm] = useState<IncomeForm | null>(null);
  const [incomeSaving, setIncomeSaving] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "";

  const todayIso = new Date().toISOString().slice(0, 10);

  // Cards (by category) whose income total is built from the rows marked for expense — the
  // "להוצאה" checkbox (include flag). Positive, included, and not already turned into income.
  // X / "לא לתעד" rows are unchecked by default, so they drop out automatically.
  const incomeCards = useMemo(() => {
    const map = new Map<string, { rowIds: string[]; sum: number; maxDate: string }>();
    for (const r of rows) {
      if (!(r.amount > 0) || r.incomeExists || !r.include) continue;
      const key = r.category || "כרטיס אשראי";
      const cur = map.get(key) ?? { rowIds: [], sum: 0, maxDate: "" };
      cur.rowIds.push(r.id);
      cur.sum += r.amount;
      const d = r.expenseDate || r.transactionDate;
      if (d > cur.maxDate) cur.maxDate = d;
      map.set(key, cur);
    }
    return [...map.entries()].map(([label, v]) => ({ label, ...v }));
  }, [rows]);

  function openIncome(title: string, rowIds: string[], amount: number, date: string, reference: string) {
    setIncomeTitle(title);
    setIncomeRowIds(rowIds);
    setIncomeForm({
      businessDomain: "",
      projectId: "",
      orderId: "",
      propertyId: "",
      amount: amount > 0 ? String(amount) : "",
      paymentDate: date || todayIso,
      paymentMethod: "credit_card",
      referenceNumber: reference,
      notes: "",
    });
    setIncomeError(null);
    setIncomeOpen(true);
  }

  function openRowIncome(row: StatementRowView) {
    openIncome(
      `הכנסה משורה: ${row.description || "ללא שם"}`,
      [row.id],
      row.amount,
      row.transactionDate || row.expenseDate,
      row.description || ""
    );
  }

  function openCardIncome(card: { label: string; rowIds: string[]; sum: number; maxDate: string }) {
    openIncome(`הכנסה מכרטיס: ${card.label} (${card.rowIds.length} שורות)`, card.rowIds, card.sum, card.maxDate, card.label);
  }

  async function submitIncome() {
    if (!incomeForm || incomeSaving) return;
    const domain = incomeForm.businessDomain;
    if (!isExpenseBusinessDomain(domain)) {
      setIncomeError("יש לבחור תחום עסקי.");
      return;
    }
    const amountNum = Number(incomeForm.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setIncomeError("יש להזין סכום תקין.");
      return;
    }
    if (!incomeForm.paymentDate) {
      setIncomeError("יש לבחור תאריך.");
      return;
    }
    setIncomeSaving(true);
    setIncomeError(null);
    try {
      const res = await fetch("/api/expenses/statement-rows/create-income", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          row_ids: incomeRowIds,
          business_domain: domain,
          project_id: domain === "logistics_projects" ? incomeForm.projectId || null : null,
          order_id: domain === "sales" ? incomeForm.orderId || null : null,
          property_id: domain === "property_management" ? incomeForm.propertyId || null : null,
          amount_total: amountNum,
          payment_date: incomeForm.paymentDate,
          payment_method: incomeForm.paymentMethod,
          reference_number: incomeForm.referenceNumber.trim() || null,
          notes: incomeForm.notes.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { payment_id?: string; error?: string };
      if (!res.ok || !data.payment_id) {
        setIncomeError(toHebrewError(data.error, "יצירת ההכנסה נכשלה."));
        return;
      }
      // Optimistic: mark the linked rows as income, then refresh from the server.
      const linked = new Set(incomeRowIds);
      setRows((prev) =>
        prev.map((r) =>
          linked.has(r.id) ? { ...r, incomePaymentId: data.payment_id ?? r.incomePaymentId, incomeExists: true, incomeAmount: amountNum } : r
        )
      );
      setIncomeOpen(false);
      setIncomeForm(null);
      router.refresh();
    } catch {
      setIncomeError("יצירת ההכנסה נכשלה.");
    } finally {
      setIncomeSaving(false);
    }
  }

  function patchIncome(patch: Partial<IncomeForm>) {
    setIncomeForm((f) => (f ? { ...f, ...patch } : f));
  }

  // Re-sync from the server after a router.refresh() (e.g. once expenses are created), then
  // re-run the duplicate scan against current expenses.
  useEffect(() => {
    setRows(initialRows);
    void checkDuplicates(initialRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRows]);

  // Flag not-yet-created rows that look like an existing expense (so they're not duplicated).
  async function checkDuplicates(list: StatementRowView[]) {
    const candidates = list.filter((r) => !r.expenseExists && !r.expenseId);
    const dates = candidates
      .flatMap((r) => [r.transactionDate, r.expenseDate])
      .filter(Boolean)
      .sort();
    if (dates.length === 0) {
      setDupByRowId({});
      return;
    }
    try {
      const from = shiftIso(dates[0], -DUP_WINDOW);
      const to = shiftIso(dates[dates.length - 1], DUP_WINDOW);
      const res = await fetch("/api/expenses/check-duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { expenses?: ExistingExpense[] };
      const existing: ExistingExpense[] = (data.expenses ?? []).map((e) => ({
        id: typeof e.id === "string" ? e.id : undefined,
        expense_date: String(e.expense_date ?? "").slice(0, 10),
        transaction_date: e.transaction_date ? String(e.transaction_date).slice(0, 10) : null,
        amount: Number(e.amount),
        description: String(e.description ?? ""),
      }));
      const map: Record<string, ExistingExpense | null> = {};
      for (const r of candidates) {
        if (ignoredDupIds.has(r.id)) {
          map[r.id] = null; // dismissed as "not a duplicate"
          continue;
        }
        map[r.id] = findDuplicate(
          { amount: r.amount, billingDate: r.expenseDate, txnDate: r.transactionDate, description: r.description },
          existing,
          DUP_WINDOW
        );
      }
      setDupByRowId(map);
    } catch {
      /* duplicate flagging is best-effort */
    }
  }

  function payloadFor(row: StatementRowView) {
    return {
      row_id: row.id,
      business_domain: row.businessDomain,
      project_id: row.businessDomain === "logistics_projects" ? row.projectId || null : null,
      property_id: row.businessDomain === "property_management" ? row.propertyId || null : null,
      amount: row.amount,
      category: row.category,
      description: row.description,
      notes: row.notes,
      expense_date: row.expenseDate,
      transaction_date: row.transactionDate || null,
      include: row.include,
    };
  }

  // Inline edit (domain / project / property / include) with optimistic update + revert.
  async function saveRowInline(rowId: string, patch: Partial<StatementRowView>) {
    const prev = rows;
    const target = prev.find((r) => r.id === rowId);
    if (!target) return;
    const merged: StatementRowView = { ...target, ...patch };
    setRows(prev.map((r) => (r.id === rowId ? merged : r)));
    setSavingRowId(rowId);
    setRowError(null);
    try {
      const res = await fetch("/api/expenses/statement-rows/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payloadFor(merged)),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRows(prev);
        setRowError(toHebrewError(data.error, "העדכון נכשל."));
      }
    } catch {
      setRows(prev);
      setRowError("העדכון נכשל.");
    } finally {
      setSavingRowId(null);
    }
  }

  function setRowDomain(rowId: string, domain: string) {
    void saveRowInline(rowId, { businessDomain: domain, projectId: "", propertyId: "" });
  }

  // Eligible for expense creation: a draft row that's included, assigned, and positive.
  const eligibleRows = useMemo(
    () =>
      rows.filter(
        (r) => !r.expenseExists && !r.expenseId && r.include && isExpenseBusinessDomain(r.businessDomain) && r.amount > 0
      ),
    [rows]
  );
  const createdLocal = rows.filter((r) => r.expenseExists).length;
  const dupRowIds = useMemo(
    () => rows.filter((r) => !r.expenseExists && !r.expenseId && dupByRowId[r.id]).map((r) => r.id),
    [rows, dupByRowId]
  );
  const showAssignmentRef = rows.some((r) => r.assignmentRaw);
  const showDupCol = dupRowIds.length > 0;

  // Set the include flag on many rows at once (optimistic, then persist in parallel). Doing it
  // in one setRows avoids the stale-snapshot overwrite of looping per-row saves.
  async function bulkSetInclude(targetIds: string[], next: boolean) {
    const ids = new Set(targetIds);
    if (ids.size === 0) return;
    const prev = rows;
    const updated = rows.map((r) => (ids.has(r.id) ? { ...r, include: next } : r));
    setRows(updated);
    setRowError(null);
    try {
      const oks = await Promise.all(
        updated
          .filter((r) => ids.has(r.id))
          .map((r) =>
            fetch("/api/expenses/statement-rows/update", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payloadFor(r)),
            })
              .then((res) => res.ok)
              .catch(() => false)
          )
      );
      if (oks.some((ok) => !ok)) {
        setRows(prev);
        setRowError("חלק מהשורות לא עודכנו.");
      }
    } catch {
      setRows(prev);
      setRowError("עדכון השורות נכשל.");
    }
  }

  async function uncheckDuplicates() {
    const ids = rows.filter((r) => dupRowIds.includes(r.id) && r.include).map((r) => r.id);
    await bulkSetInclude(ids, false);
  }

  // Dismiss a false-positive duplicate flag for one row (it's not actually a duplicate).
  function ignoreDup(rowId: string) {
    setIgnoredDupIds((prev) => new Set(prev).add(rowId));
    setDupByRowId((prev) => ({ ...prev, [rowId]: null }));
  }

  // Confirm a flagged row IS a duplicate: link it to the existing expense so it reads as
  // "created" (already accounted for) instead of staying pending.
  async function markExisting(row: StatementRowView, dup: ExistingExpense) {
    if (!dup.id) {
      setRowError("לא נמצא מזהה ההוצאה הקיימת — נסה/י לבדוק כפילויות מחדש.");
      return;
    }
    const prev = rows;
    setRows(prev.map((r) => (r.id === row.id ? { ...r, expenseId: dup.id ?? null, expenseExists: true } : r)));
    setSavingRowId(row.id);
    setRowError(null);
    try {
      const res = await fetch("/api/expenses/statement-rows/link-existing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ row_id: row.id, expense_id: dup.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRows(prev);
        setRowError(toHebrewError(data.error, "הקישור נכשל."));
        return;
      }
      router.refresh();
    } catch {
      setRows(prev);
      setRowError("הקישור נכשל.");
    } finally {
      setSavingRowId(null);
    }
  }

  // Draft rows marked "X". The toggle unchecks them all (or re-checks if none are checked).
  const xDraftRows = useMemo(
    () => rows.filter((r) => !r.expenseExists && !r.expenseId && isXRow(r.assignmentRaw)),
    [rows]
  );
  const checkedXCount = xDraftRows.filter((r) => r.include).length;
  // Toggle is "on" (X rows excluded) when none of them are still checked.
  const xExcluded = xDraftRows.length > 0 && checkedXCount === 0;

  // Progress buckets — shown in the summary bar so the user can see where they left off.
  const progressCounts = useMemo(() => {
    let created = 0, ready = 0, needsDomain = 0, excluded = 0;
    for (const r of rows) {
      const m = rowMode(r);
      if (m === "created") { created++; continue; }
      if (m === "deleted") continue;
      if (!r.include) { excluded++; continue; }
      if (r.businessDomain) ready++;
      else needsDomain++;
    }
    return { created, ready, needsDomain, excluded };
  }, [rows]);
  const hasPending = progressCounts.ready > 0 || progressCounts.needsDomain > 0;

  // Navigation guard — fires for browser refresh/close AND Next.js client-side link clicks.
  useEffect(() => {
    if (!hasPending) return;

    // Browser refresh / close / address-bar navigation.
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", onBeforeUnload);

    // Browser back/forward button: push a history entry so we can intercept the popstate.
    history.pushState(null, "", window.location.href);
    const onPopState = () => {
      if (bypassGuard.current) return; // user already confirmed leave — let it through
      history.pushState(null, "", window.location.href);
      setLeaveTarget(null);
      setShowLeaveConfirm(true);
    };
    window.addEventListener("popstate", onPopState);

    // Next.js Link / <a> clicks — capture phase so we see them before React's handler.
    const onDocumentClick = (e: MouseEvent) => {
      if (bypassGuard.current) return;
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor || !anchor.href) return;
      try {
        const dest = new URL(anchor.href);
        if (dest.origin !== window.location.origin) return;
        if (dest.pathname === window.location.pathname) return;
        e.preventDefault();
        e.stopPropagation();
        setLeaveTarget(dest.pathname + dest.search);
        setShowLeaveConfirm(true);
      } catch {
        // Malformed href — let it through.
      }
    };
    document.addEventListener("click", onDocumentClick, true);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("click", onDocumentClick, true);
    };
  }, [hasPending]);

  async function toggleXRows() {
    if (xDraftRows.length === 0) return;
    const next = xExcluded; // currently excluded → re-check all; otherwise uncheck all
    const ids = xDraftRows.filter((r) => r.include !== next).map((r) => r.id);
    await bulkSetInclude(ids, next);
  }

  async function deleteStatement() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/expenses/statement-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement_id: statement.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setDeleteError(toHebrewError(data.error, "המחיקה נכשלה."));
        setDeleting(false);
        return;
      }
      router.push("/financial/statements");
    } catch {
      setDeleteError("המחיקה נכשלה.");
      setDeleting(false);
    }
  }

  async function toggleDone() {
    if (markingDone) return;
    const next = !markedDone;
    setMarkingDone(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/expenses/statement-mark-done", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement_id: statement.id, done: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCreateError(toHebrewError(data.error, "עדכון הסטטוס נכשל."));
        return;
      }
      setMarkedDone(next);
      // Invalidate the cached list route so the "בוצע" status shows there too.
      router.refresh();
    } catch {
      setCreateError("עדכון הסטטוס נכשל.");
    } finally {
      setMarkingDone(false);
    }
  }

  async function createExpenses() {
    if (creating || eligibleRows.length === 0) return;
    setCreating(true);
    setCreateError(null);
    setCreateNotice(null);
    try {
      const res = await fetch("/api/expenses/statement-rows/create-expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement_id: statement.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        created?: number;
        skipped?: number;
        errors?: { id: string; message: string }[];
        error?: string;
      };
      if (!res.ok) {
        setCreateError(toHebrewError(data.error, "יצירת ההוצאות נכשלה."));
        return;
      }
      const parts = [`נוצרו ${data.created ?? 0} הוצאות`];
      if (data.skipped) parts.push(`${data.skipped} דולגו`);
      if (data.errors && data.errors.length) parts.push(`${data.errors.length} שגיאות`);
      setCreateNotice(parts.join(" · "));
      router.refresh();
    } catch {
      setCreateError("יצירת ההוצאות נכשלה.");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(row: StatementRowView) {
    if (rowMode(row) === "deleted") return;
    setError(null);
    setEditingId(row.id);
    setDraft({ ...row });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setError(null);
  }

  function patchDraft(patch: Partial<StatementRowView>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  async function saveDialog() {
    if (!draft || saving) return;
    if (!draft.expenseDate) {
      setError("יש להזין תאריך.");
      return;
    }
    // A row that already created an expense must keep a valid domain (the expense needs one).
    if (draft.expenseExists && !isExpenseBusinessDomain(draft.businessDomain)) {
      setError("יש לבחור תחום עסקי.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/expenses/statement-rows/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          row_id: draft.id,
          business_domain: draft.businessDomain,
          project_id: draft.businessDomain === "logistics_projects" ? draft.projectId || null : null,
          property_id: draft.businessDomain === "property_management" ? draft.propertyId || null : null,
          amount: draft.amount,
          category: draft.category,
          description: draft.description,
          notes: draft.notes,
          expense_date: draft.expenseDate,
          transaction_date: draft.transactionDate || null,
          include: draft.include,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(toHebrewError(data.error, "העדכון נכשל."));
        return;
      }
      const normalized: StatementRowView = {
        ...draft,
        projectId: draft.businessDomain === "logistics_projects" ? draft.projectId : "",
        propertyId: draft.businessDomain === "property_management" ? draft.propertyId : "",
      };
      setRows((prev) => prev.map((r) => (r.id === normalized.id ? normalized : r)));
      cancelEdit();
    } catch {
      setError("העדכון נכשל.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{statement.fileName || "פירוט אשראי"}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(statement.createdAt)} · {statement.source === "pdf" ? "PDF" : "Excel/CSV"} ·{" "}
            {createdLocal} מתוך {rows.length} הוצאות נוצרו
            {markedDone ? (
              <span className="ms-2 rounded bg-success-soft px-1.5 py-0.5 text-xs text-success-soft-foreground">בוצע</span>
            ) : createdLocal === 0 ? (
              <span className="ms-2 rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning-soft-foreground">
                ממתין לשיוך
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={markedDone ? "outline" : "secondary"} size="sm" onClick={() => void toggleDone()} disabled={markingDone}>
            {markingDone ? "שומר..." : markedDone ? "בטל סימון בוצע" : "סמן כבוצע"}
          </Button>
          {fileUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={fileUrl} target="_blank" rel="noreferrer">
                הורדת הקובץ
              </a>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => { setDeleteError(null); setShowDeleteConfirm(true); }}
          >
            מחיקת פירוט
          </Button>
          <Button variant="outline" size="sm" onClick={() => { if (hasPending) { setLeaveTarget("/financial/statements"); setShowLeaveConfirm(true); } else { bypassGuard.current = true; router.push("/financial/statements"); } }}>
            חזרה לרשימה
          </Button>
        </div>

        {/* Delete confirmation */}
        {showDeleteConfirm ? (
          <div className="mt-3 w-full rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-right">
            <p className="font-medium text-destructive">מחיקת הפירוט</p>
            <p className="mt-1 text-muted-foreground">
              הפירוט ו-{rows.length} שורותיו יימחקו. ההוצאות שכבר נוצרו <strong>לא יימחקו</strong> — הן נשארות במערכת.
              לאחר המחיקה תוכל/י להעלות את הקובץ מחדש.
            </p>
            {deleteError ? <p className="mt-1 text-destructive">{deleteError}</p> : null}
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void deleteStatement()}
                disabled={deleting}
              >
                {deleting ? "מוחק..." : "כן, מחק את הפירוט"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
                ביטול
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Progress summary — shows where the user is holding at a glance */}
      <div className="flex flex-wrap gap-3 text-sm">
        <div className="flex items-center gap-1.5 rounded-md border bg-success-soft/20 px-3 py-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success-soft-foreground/60" />
          <span className="font-medium">{progressCounts.created}</span>
          <span className="text-muted-foreground">נוצרו</span>
        </div>
        {progressCounts.ready > 0 ? (
          <div className="flex items-center gap-1.5 rounded-md border bg-info-soft/20 px-3 py-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-info-soft-foreground/60" />
            <span className="font-medium">{progressCounts.ready}</span>
            <span className="text-muted-foreground">מוכנות ליצירה</span>
          </div>
        ) : null}
        {progressCounts.needsDomain > 0 ? (
          <div className="flex items-center gap-1.5 rounded-md border bg-warning-soft/20 px-3 py-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-warning-soft-foreground/60" />
            <span className="font-medium">{progressCounts.needsDomain}</span>
            <span className="text-muted-foreground">ממתינות לשיוך</span>
          </div>
        ) : null}
        {progressCounts.excluded > 0 ? (
          <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 opacity-60">
            <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
            <span className="font-medium">{progressCounts.excluded}</span>
            <span className="text-muted-foreground">לא לתיעוד</span>
          </div>
        ) : null}
      </div>

      {/* Action bar: assign hint on top, then helpers + the create CTA on a separate row */}
      <Card>
        <CardContent className="space-y-3 py-3">
          <div className="text-sm text-muted-foreground">
            בחר/י תחום עסקי לכל שורה (עמודת &quot;שיוך מקורי&quot; מציגה את מה שסומן בקובץ), ואז צור/י את ההוצאות.
            {dupRowIds.length > 0 ? (
              <span className="ms-1 text-warning-soft-foreground">זוהו {dupRowIds.length} כפילויות אפשריות מול הוצאות קיימות.</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {xDraftRows.length > 0 ? (
              <label className="flex items-center gap-2 text-sm" title="בטל את הסימון 'להוצאה' לכל שורות ה-X בבת אחת">
                <button
                  type="button"
                  role="switch"
                  aria-checked={xExcluded}
                  onClick={() => void toggleXRows()}
                  disabled={creating}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    xExcluded ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                >
                  <span
                    className={`absolute h-4 w-4 rounded-full bg-background shadow transition-all ${
                      xExcluded ? "left-0.5" : "right-0.5"
                    }`}
                  />
                </button>
                <span>בטל סימון שורות X ({xDraftRows.length})</span>
              </label>
            ) : null}
            {dupRowIds.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => void uncheckDuplicates()} disabled={creating}>
                אל תיצור הוצאה לכפילויות
              </Button>
            ) : null}
            </div>
            <Button
              size="sm"
              onClick={() => void createExpenses()}
              disabled={creating || savingRowId !== null || eligibleRows.length === 0}
            >
              {creating ? "יוצר..." : `צור הוצאות (${eligibleRows.length})`}
            </Button>
          </div>
        </CardContent>
      </Card>
      {createNotice ? <p className="text-sm text-success-soft-foreground">{createNotice}</p> : null}
      {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
      {rowError ? <p className="text-sm text-destructive">{rowError}</p> : null}

      {/* Income from cards: when a card's charges are really someone's payment for a job */}
      {incomeCards.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 py-3">
            <div className="text-sm font-medium">צור הכנסה מכרטיס</div>
            <p className="text-xs text-muted-foreground">
              אם ההוצאות בכרטיס הן למעשה תשלום של מישהו עבור עבודה — צור/י הכנסה אחת לכל הכרטיס (תקבול מהלקוח), בנוסף להוצאות.
              הסכום מחושב מהשורות המסומנות &quot;להוצאה&quot; (שורות X / &quot;לא לתעד&quot; שאינן מסומנות לא נכללות).
            </p>
            <div className="flex flex-wrap gap-2">
              {incomeCards.map((card) => (
                <Button key={card.label} variant="outline" size="sm" onClick={() => openCardIncome(card)}>
                  {card.label} · {formatCurrency(card.sum)} ({card.rowIds.length})
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">סטטוס</th>
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">בית עסק</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                  <th className="px-3 py-2 font-medium">קטגוריה</th>
                  {showAssignmentRef ? <th className="px-3 py-2 font-medium">שיוך מקורי</th> : null}
                  <th className="px-3 py-2 font-medium">תחום עסקי</th>
                  <th className="px-3 py-2 font-medium">שיוך (פרויקט/נכס)</th>
                  {showDupCol ? <th className="px-3 py-2 font-medium">כפילות?</th> : null}
                  <th className="px-3 py-2 font-medium">הכנסה</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const mode = rowMode(row);
                  const dup = mode === "draft" ? dupByRowId[row.id] : null;

                  // Row background: dup check overrides domain-readiness colors.
                  let rowBg = "";
                  if (mode === "created") rowBg = "bg-success-soft/20";
                  else if (mode === "deleted") rowBg = "opacity-50";
                  else if (!row.include) rowBg = "opacity-50";
                  else if (dup) rowBg = "bg-warning-soft/25";
                  else if (row.businessDomain) rowBg = "bg-info-soft/20";
                  else rowBg = "bg-warning-soft/15";

                  return (
                    <tr key={row.id} className={`align-top ${rowBg}`}>
                      {/* Status / include */}
                      <td className="px-3 py-2">
                        {mode === "created" ? (
                          <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs text-success-soft-foreground">נוצרה</span>
                        ) : mode === "deleted" ? (
                          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning-soft-foreground">נמחקה</span>
                        ) : (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={row.include}
                              disabled={savingRowId === row.id}
                              onChange={(e) => void saveRowInline(row.id, { include: e.target.checked })}
                            />
                            להוצאה
                          </label>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{formatIsoDisplay(row.expenseDate)}</td>
                      <td className="px-3 py-2">{row.description || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.category || "—"}</td>
                      {showAssignmentRef ? (
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{row.assignmentRaw || "—"}</td>
                      ) : null}
                      {/* Business domain */}
                      <td className="px-3 py-2">
                        {mode === "draft" ? (
                          <select
                            value={row.businessDomain}
                            disabled={savingRowId === row.id || !row.include}
                            onChange={(e) => setRowDomain(row.id, e.target.value)}
                            className="h-8 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                          >
                            <option value="">— בחר —</option>
                            {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                              <option key={d} value={d}>
                                {getBusinessDomainLabel(d)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          getBusinessDomainLabel(row.businessDomain)
                        )}
                      </td>
                      {/* Project / property */}
                      <td className="px-3 py-2">
                        {mode === "draft" && row.businessDomain === "logistics_projects" ? (
                          <ProjectPicker
                            value={row.projectId}
                            disabled={savingRowId === row.id || !row.include}
                            onChange={(projectId) => void saveRowInline(row.id, { projectId })}
                            emptyLabel="— ללא פרויקט —"
                            searchPlaceholder="חיפוש פרויקט..."
                            className="h-8 min-w-[9rem] rounded-md px-2 shadow-none"
                            projects={projects.map((p) => ({ id: p.id, label: p.name }))}
                          />
                        ) : mode === "draft" && row.businessDomain === "property_management" ? (
                          <SearchableSelect
                            value={row.propertyId}
                            disabled={savingRowId === row.id || !row.include}
                            onChange={(propertyId) => void saveRowInline(row.id, { propertyId })}
                            ariaLabel="שיוך נכס"
                            emptyOptionLabel="— ללא נכס —"
                            searchPlaceholder="חיפוש נכס..."
                            className="h-8 min-w-[9rem] rounded-md px-2 shadow-none"
                            options={properties.map((p) => ({ value: p.id, label: p.name }))}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {row.projectId ? projectName(row.projectId) : row.propertyId ? propertyName(row.propertyId) : "—"}
                          </span>
                        )}
                      </td>
                      {showDupCol ? (
                        <td className="px-3 py-2">
                          {dup ? (
                            <div className="space-y-1.5 min-w-[11rem]">
                              <span className="inline-block rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground">
                                כפילות אפשרית
                              </span>
                              <div className="rounded border border-warning-soft/50 bg-warning-soft/10 px-2 py-1 text-[11px] leading-snug">
                                <div className="font-medium text-foreground">{dup.description || "—"}</div>
                                <div className="text-muted-foreground">
                                  {formatIsoDisplay(dup.transaction_date || dup.expense_date)} · {formatCurrency(dup.amount)}
                                </div>
                              </div>
                              {dup.id ? (
                                <button
                                  type="button"
                                  onClick={() => void markExisting(row, dup)}
                                  disabled={savingRowId === row.id}
                                  className="block w-full whitespace-nowrap rounded border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                                >
                                  כן, כבר קיים
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => ignoreDup(row.id)}
                                className="block w-full whitespace-nowrap rounded border border-input px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                              >
                                לא כפילות
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      ) : null}
                      {/* Income */}
                      <td className="px-3 py-2">
                        {row.incomeExists ? (
                          <span
                            title={`נרשמה הכנסה: ${formatCurrency(row.incomeAmount)}`}
                            className="inline-block rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info-soft-foreground"
                          >
                            הכנסה ✓
                          </span>
                        ) : row.amount > 0 ? (
                          <button
                            type="button"
                            onClick={() => openRowIncome(row)}
                            title="צור הכנסה משורה זו"
                            className="whitespace-nowrap rounded border border-input px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                          >
                            צור הכנסה
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Edit */}
                      <td className="px-3 py-2 text-left">
                        {mode === "deleted" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            title="עריכה"
                            className="rounded p-1 hover:bg-muted"
                          >
                            <Pencil className="inline h-4 w-4 text-muted-foreground" aria-label="עריכה" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Leave-page guard dialog */}
      <Dialog open={showLeaveConfirm} onOpenChange={(open) => { if (!open) setShowLeaveConfirm(false); }}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>לצאת מהפירוט?</DialogTitle>
            <DialogDescription>
              יש {progressCounts.ready + progressCounts.needsDomain} שורות שטרם נוצרו כהוצאות
              {progressCounts.ready > 0 ? ` (${progressCounts.ready} מוכנות ליצירה` : ""}
              {progressCounts.needsDomain > 0 ? `${progressCounts.ready > 0 ? ", " : " ("}${progressCounts.needsDomain} ממתינות לשיוך` : ""}
              {(progressCounts.ready > 0 || progressCounts.needsDomain > 0) ? ")" : ""}.
              הנתונים שמורים — תוכל/י לחזור בכל עת.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row-reverse gap-2 pt-2">
            <Button onClick={() => setShowLeaveConfirm(false)}>
              המשך בפירוט
            </Button>
            <Button variant="outline" onClick={() => { bypassGuard.current = true; setShowLeaveConfirm(false); if (leaveTarget) router.push(leaveTarget); else history.back(); }}>
              צא/י בכל זאת
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open && !saving) cancelEdit(); }}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>עריכת שורה</DialogTitle>
            <DialogDescription>
              {draft?.expenseExists ? "העדכון יישמר בהוצאה המקושרת." : "השורה עדיין לא הומרה להוצאה — העדכון יישמר בפירוט."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="בית עסק">
                <Input value={draft.description} onChange={(e) => patchDraft({ description: e.target.value })} className="h-9" />
              </Field>
              <Field label="סכום">
                <CurrencyInput
                  type="number"
                  step="0.01"
                  value={Number.isFinite(draft.amount) ? draft.amount : 0}
                  onChange={(e) => patchDraft({ amount: Number(e.target.value) })}
                  className="h-9"
                />
              </Field>
              <Field label="קטגוריה (כרטיס)">
                <Input value={draft.category} onChange={(e) => patchDraft({ category: e.target.value })} className="h-9" />
              </Field>
              <Field label="תאריך חיוב">
                <Input
                  type="date"
                  value={draft.expenseDate}
                  onChange={(e) => patchDraft({ expenseDate: e.target.value })}
                  className="h-9"
                />
              </Field>
              <Field label="תאריך עסקה">
                <Input
                  type="date"
                  value={draft.transactionDate}
                  onChange={(e) => patchDraft({ transactionDate: e.target.value })}
                  className="h-9"
                />
              </Field>
              <Field label="תחום עסקי">
                <select
                  value={draft.businessDomain}
                  onChange={(e) => patchDraft({ businessDomain: e.target.value, projectId: "", propertyId: "" })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— בחר —</option>
                  {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {getBusinessDomainLabel(d)}
                    </option>
                  ))}
                </select>
              </Field>
              {draft.businessDomain === "logistics_projects" ? (
                <Field label="פרויקט">
                  <ProjectPicker
                    value={draft.projectId}
                    onChange={(projectId) => patchDraft({ projectId })}
                    emptyLabel="— ללא פרויקט —"
                    searchPlaceholder="חיפוש פרויקט..."
                    className="h-9 rounded-md px-2"
                    projects={projects.map((p) => ({ id: p.id, label: p.name }))}
                  />
                </Field>
              ) : draft.businessDomain === "property_management" ? (
                <Field label="נכס">
                  <SearchableSelect
                    value={draft.propertyId}
                    onChange={(propertyId) => patchDraft({ propertyId })}
                    ariaLabel="שיוך נכס"
                    emptyOptionLabel="— ללא נכס —"
                    searchPlaceholder="חיפוש נכס..."
                    className="h-9 rounded-md px-2"
                    options={properties.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
              ) : null}
              <Field label="הערה">
                <Input value={draft.notes} onChange={(e) => patchDraft({ notes: e.target.value })} className="h-9" />
              </Field>
            </div>
            {draft.assignmentRaw ? (
              <p className="text-xs text-muted-foreground">שיוך מקורי בקובץ: {draft.assignmentRaw}</p>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button onClick={() => void saveDialog()} disabled={saving}>
                {saving ? "שומר..." : "שמירה"}
              </Button>
              <Button variant="outline" onClick={cancelEdit} disabled={saving}>
                ביטול
              </Button>
            </div>
            </div>
          ) : null}
        </AdaptiveDialog>
      </Dialog>

      {/* Income dialog (per-row or per-card) */}
      <Dialog open={incomeOpen} onOpenChange={(open) => { if (!open && !incomeSaving) { setIncomeOpen(false); setIncomeForm(null); } }}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>צור הכנסה</DialogTitle>
            <DialogDescription>{incomeTitle} — נרשם כתקבול (ללא הפקת קבלה).</DialogDescription>
          </DialogHeader>
          {incomeForm ? (
            <div className="space-y-3">
              <Field label="תחום עסקי *">
                <select
                  value={incomeForm.businessDomain}
                  onChange={(e) => patchIncome({ businessDomain: e.target.value, projectId: "", orderId: "", propertyId: "" })}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">— בחר —</option>
                  {EXPENSE_BUSINESS_DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {getBusinessDomainLabel(d)}
                    </option>
                  ))}
                </select>
              </Field>

              {incomeForm.businessDomain === "logistics_projects" ? (
                <Field label="פרויקט">
                  <ProjectPicker
                    value={incomeForm.projectId}
                    onChange={(projectId) => patchIncome({ projectId })}
                    emptyLabel="— ללא פרויקט —"
                    searchPlaceholder="חיפוש פרויקט..."
                    className="h-9 rounded-md px-2"
                    projects={projects.map((p) => ({ id: p.id, label: p.name }))}
                  />
                </Field>
              ) : incomeForm.businessDomain === "sales" ? (
                <Field label="הזמנה (אופציונלי)">
                  <select
                    value={incomeForm.orderId}
                    onChange={(e) => patchIncome({ orderId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— כללי (ללא הזמנה) —</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : incomeForm.businessDomain === "property_management" ? (
                <Field label="נכס">
                  <SearchableSelect
                    value={incomeForm.propertyId}
                    onChange={(propertyId) => patchIncome({ propertyId })}
                    ariaLabel="שיוך נכס"
                    emptyOptionLabel="— ללא נכס —"
                    searchPlaceholder="חיפוש נכס..."
                    className="h-9 rounded-md px-2"
                    options={properties.map((p) => ({ value: p.id, label: p.name }))}
                  />
                </Field>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="סכום *">
                  <CurrencyInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={incomeForm.amount}
                    onChange={(e) => patchIncome({ amount: e.target.value })}
                    className="h-9"
                  />
                </Field>
                <Field label="תאריך *">
                  <Input
                    type="date"
                    value={incomeForm.paymentDate}
                    onChange={(e) => patchIncome({ paymentDate: e.target.value })}
                    className="h-9"
                  />
                </Field>
                <Field label="אמצעי תשלום">
                  <select
                    value={incomeForm.paymentMethod}
                    onChange={(e) => patchIncome({ paymentMethod: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {INCOME_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="אסמכתא">
                  <Input
                    value={incomeForm.referenceNumber}
                    onChange={(e) => patchIncome({ referenceNumber: e.target.value })}
                    className="h-9"
                  />
                </Field>
              </div>
              <Field label="הערה">
                <Input value={incomeForm.notes} onChange={(e) => patchIncome({ notes: e.target.value })} className="h-9" />
              </Field>

              {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}
              <div className="flex gap-2">
                <Button onClick={() => void submitIncome()} disabled={incomeSaving}>
                  {incomeSaving ? "יוצר..." : "צור הכנסה"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setIncomeOpen(false); setIncomeForm(null); }}
                  disabled={incomeSaving}
                >
                  ביטול
                </Button>
              </div>
            </div>
          ) : null}
        </AdaptiveDialog>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
