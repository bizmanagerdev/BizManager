"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CHECKLIST_ENTITY_TYPES,
  countDocumentsUsingCategory,
  fetchDocumentCategories,
  findOrphanCategories,
  saveDocumentCategory,
  setDocumentCategoryActive,
  type ChecklistEntityType,
  type DocumentCategoryRow,
} from "@/lib/documents/categories";

// Admin editor for the document-category registry. It lives on /documents —
// the page it governs — the same way DunningStagesEditor lives on /collections
// rather than in the settings screen.
//
// Deliberately NOT the delete-then-insert of saveDunningStages: every row's
// `code` is referenced by documents.document_type, so retiring a category is a
// deactivation, and the editor shows how many files it would orphan first.

const ENTITY_LABEL: Record<ChecklistEntityType, string> = {
  vehicle: "רכב",
  property: "נכס",
  project: "פרויקט",
  customer: "לקוח",
};

export default function DocumentCategoriesEditor() {
  const [rows, setRows] = useState<DocumentCategoryRow[] | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [retiring, setRetiring] = useState<{ row: DocumentCategoryRow; usage: number } | null>(null);
  const [orphans, setOrphans] = useState<Array<{ code: string; count: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    fetchDocumentCategories()
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        // Values sitting in documents.document_type that no row claims — they
        // would otherwise be invisible here while still showing in the archive.
        return findOrphanCategories(data).then((found) => {
          if (!cancelled) setOrphans(found);
        });
      })
      .catch(() => setRows([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const userRows = useMemo(() => (rows ?? []).filter((r) => r.kind === "user"), [rows]);
  const systemRows = useMemo(() => (rows ?? []).filter((r) => r.kind === "system"), [rows]);

  function update(code: string, patch: Partial<DocumentCategoryRow>) {
    setRows((prev) => prev?.map((r) => (r.code === code ? { ...r, ...patch } : r)) ?? prev);
    setDirty((prev) => new Set(prev).add(code));
  }

  function toggleRequired(row: DocumentCategoryRow, entity: ChecklistEntityType) {
    const next = row.required_for.includes(entity)
      ? row.required_for.filter((e) => e !== entity)
      : [...row.required_for, entity];
    update(row.code, { required_for: next });
  }

  async function save() {
    if (!rows || dirty.size === 0 || saving) return;
    setSaving(true);
    try {
      const changed = rows.filter((r) => dirty.has(r.code));
      const results = await Promise.all(changed.map((r) => saveDocumentCategory(r)));
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        toast.error(`שמירת ${failed} קטגוריות נכשלה`);
        return;
      }
      setDirty(new Set());
      toast.success("הקטגוריות נשמרו");
    } finally {
      setSaving(false);
    }
  }

  async function askRetire(row: DocumentCategoryRow) {
    const usage = await countDocumentsUsingCategory(row.code);
    setRetiring({ row, usage });
  }

  async function confirmRetire() {
    if (!retiring) return;
    const { row } = retiring;
    const next = !row.active;
    const ok = await setDocumentCategoryActive(row.code, next);
    setRetiring(null);
    if (!ok) {
      toast.error("העדכון נכשל");
      return;
    }
    setRows((prev) => prev?.map((r) => (r.code === row.code ? { ...r, active: next } : r)) ?? prev);
    toast.success(next ? "הקטגוריה הופעלה" : "הקטגוריה הוסרה מהרשימות");
  }

  if (!rows) return <div className="text-xs text-muted-foreground">טוען…</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        קטגוריה כאן היא לא רק תווית — היא קובעת מה המערכת עושה עם המסמך: מעקב תוקף שולח התראה לפני
        שהמסמך פג, מסמך נדרש מופיע כחסר בכרטיס של הרכב או הנכס, ומסמך כספי אמור להיות משויך לתנועה
        בספרים.
      </p>

      <div className="space-y-2">
        {userRows.map((row) => (
          <div
            key={row.code}
            className={`rounded-xl border p-3 ${row.active ? "bg-card" : "bg-muted/40 opacity-70"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={row.label}
                onChange={(e) => update(row.code, { label: e.target.value })}
                className="min-w-0 flex-1"
                aria-label={`שם הקטגוריה ${row.code}`}
              />
              <Button
                type="button"
                size="sm"
                variant={row.active ? "secondary" : "default"}
                onClick={() => void askRetire(row)}
              >
                {row.active ? "הסרה מהרשימות" : "החזרה לרשימות"}
              </Button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.tracks_expiry}
                  onChange={(e) => update(row.code, { tracks_expiry: e.target.checked })}
                />
                מעקב תוקף
              </label>
              {row.tracks_expiry ? (
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  התראה
                  <Input
                    inputMode="numeric"
                    value={String(row.expiry_lead_days)}
                    onChange={(e) =>
                      update(row.code, { expiry_lead_days: Number(e.target.value) || 0 })
                    }
                    className="w-16"
                    aria-label="ימים לפני פקיעת התוקף"
                  />
                  ימים לפני
                </label>
              ) : null}

              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={row.is_money_doc}
                  onChange={(e) => update(row.code, { is_money_doc: e.target.checked })}
                />
                מסמך כספי
              </label>

              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted-foreground">נדרש עבור:</span>
                {CHECKLIST_ENTITY_TYPES.map((entity) => (
                  <label key={entity} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={row.required_for.includes(entity)}
                      onChange={() => toggleRequired(row, entity)}
                    />
                    {ENTITY_LABEL[entity]}
                  </label>
                ))}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => void save()} disabled={dirty.size === 0 || saving}>
          {saving ? "שומר…" : "שמירת שינויים"}
        </Button>
        {dirty.size > 0 ? (
          <span className="text-xs text-muted-foreground">{dirty.size} קטגוריות שונו</span>
        ) : null}
      </div>

      {orphans.length > 0 ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-3">
          <div className="text-sm font-medium">קטגוריות שאינן ברשימה</div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            הערכים האלה מופיעים על מסמכים קיימים אבל אין להם שורה כאן, ולכן הם לא עושים כלום. אפשר
            להוסיף אותם כקטגוריה או לשנות את הקטגוריה של המסמכים בארכיון.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {orphans.map((orphan) => (
              <li key={orphan.code} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5">{orphan.code}</code>
                <span className="text-muted-foreground">{orphan.count} מסמכים</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {systemRows.length > 0 ? (
        <details className="rounded-xl border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium">
            קטגוריות מערכת ({systemRows.length})
          </summary>
          <p className="mt-2 text-[11px] text-muted-foreground">
            אלה נכתבות אוטומטית על ידי המערכת (צרופות, צילומי משלוח, מסמכי מורנינג) ולא ניתן לבחור בהן
            בהעלאה. אפשר לשנות את השם שמוצג, אבל לא את הקוד — הקוד של צילום רכב למשל קובע מי רשאי
            לראות את הקובץ.
          </p>
          <div className="mt-2 space-y-1.5">
            {systemRows.map((row) => (
              <div key={row.code} className="flex flex-wrap items-center gap-2">
                <Input
                  value={row.label}
                  onChange={(e) => update(row.code, { label: e.target.value })}
                  className="min-w-0 flex-1"
                  aria-label={`שם הקטגוריה ${row.code}`}
                />
                <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {row.code}
                </code>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(open) => {
          if (!open) setRetiring(null);
        }}
        title={retiring?.row.active ? "הסרת קטגוריה מהרשימות" : "החזרת קטגוריה לרשימות"}
        description={
          retiring?.row.active
            ? retiring.usage > 0
              ? `${retiring.usage} מסמכים משתמשים בקטגוריה "${retiring.row.label}". הם לא ישתנו וימשיכו להופיע עם הקטגוריה הזו — היא פשוט לא תוצע יותר בהעלאה חדשה.`
              : `הקטגוריה "${retiring?.row.label}" לא תוצע יותר בהעלאה חדשה.`
            : `הקטגוריה "${retiring?.row.label}" תחזור להיות זמינה בהעלאה.`
        }
        confirmLabel={retiring?.row.active ? "הסרה" : "החזרה"}
        onConfirm={() => void confirmRetire()}
      />
    </div>
  );
}
