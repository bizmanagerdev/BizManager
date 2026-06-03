"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { EXPENSE_BUSINESS_DOMAINS, getBusinessDomainLabel } from "@/lib/expenses";

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
};

type Statement = {
  id: string;
  fileName: string;
  source: "excel" | "pdf";
  createdCount: number;
  totalRows: number;
  createdAt: string;
};

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

export default function StatementDetailClient({
  statement,
  rows: initialRows,
  projects,
  properties,
  fileUrl,
}: {
  statement: Statement;
  rows: StatementRowView[];
  projects: Option[];
  properties: Option[];
  fileUrl: string | null;
}) {
  const [rows, setRows] = useState<StatementRowView[]>(initialRows);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StatementRowView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  const propertyName = (id: string) => properties.find((p) => p.id === id)?.name ?? "";

  function startEdit(row: StatementRowView) {
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

  async function save() {
    if (!draft || saving) return;
    if (!draft.businessDomain) {
      setError("יש לבחור תחום עסקי.");
      return;
    }
    if (!draft.expenseDate) {
      setError("יש להזין תאריך.");
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
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "העדכון נכשל.");
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
          <h1 className="text-lg font-semibold">{statement.fileName || "דף אשראי"}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDateTime(statement.createdAt)} · {statement.source === "pdf" ? "PDF" : "Excel/CSV"} ·{" "}
            {statement.createdCount} הוצאות
          </p>
        </div>
        <div className="flex gap-2">
          {fileUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={fileUrl} target="_blank" rel="noreferrer">
                הורדת הקובץ
              </a>
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link href="/financial/statements">חזרה לרשימה</Link>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr className="text-right">
                  <th className="px-3 py-2 font-medium">תאריך</th>
                  <th className="px-3 py-2 font-medium">בית עסק</th>
                  <th className="px-3 py-2 font-medium">סכום</th>
                  <th className="px-3 py-2 font-medium">קטגוריה</th>
                  <th className="px-3 py-2 font-medium">תחום עסקי</th>
                  <th className="px-3 py-2 font-medium">פירוט</th>
                  <th className="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const editable = row.expenseExists;
                  return (
                    <tr
                      key={row.id}
                      onClick={editable ? () => startEdit(row) : undefined}
                      className={`align-top ${editable ? "cursor-pointer hover:bg-muted/40" : ""}`.trim()}
                    >
                      <td className="whitespace-nowrap px-3 py-2">{formatIsoDisplay(row.expenseDate)}</td>
                      <td className="px-3 py-2">{row.description || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-medium">{formatCurrency(row.amount)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{row.category || "—"}</td>
                      <td className="px-3 py-2">{getBusinessDomainLabel(row.businessDomain)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {row.projectId ? projectName(row.projectId) : row.propertyId ? propertyName(row.propertyId) : "—"}
                      </td>
                      <td className="px-3 py-2 text-left">
                        {!row.expenseExists ? (
                          <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning-soft-foreground">
                            נמחקה
                          </span>
                        ) : (
                          <Pencil className="inline h-4 w-4 text-muted-foreground" aria-label="עריכה" />
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

      {/* Edit dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open && !saving) cancelEdit(); }}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>עריכת שורה</DialogTitle>
            <DialogDescription>העדכון יישמר בהוצאה המקושרת.</DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="בית עסק">
                <Input value={draft.description} onChange={(e) => patchDraft({ description: e.target.value })} className="h-9" />
              </Field>
              <Field label="סכום">
                <Input
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
                  <select
                    value={draft.projectId}
                    onChange={(e) => patchDraft({ projectId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— ללא פרויקט —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : draft.businessDomain === "property_management" ? (
                <Field label="נכס">
                  <select
                    value={draft.propertyId}
                    onChange={(e) => patchDraft({ propertyId: e.target.value })}
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">— ללא נכס —</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="הערה">
                <Input value={draft.notes} onChange={(e) => patchDraft({ notes: e.target.value })} className="h-9" />
              </Field>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex gap-2">
              <Button onClick={() => void save()} disabled={saving}>
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
