"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { DateInput } from "@/components/ui/date-input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormDialog } from "@/components/ui/form-dialog";
import { ACCOUNT_KINDS, getAccountKindLabel, type Account } from "@/lib/accounts";
import { toHebrewError } from "@/lib/error-messages";

const ils = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

type FormState = {
  id: string | null;
  name: string;
  kind: string;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
  notes: string;
};

function emptyForm(): FormState {
  return { id: null, name: "", kind: "bank", openingBalance: "", openingDate: "", isActive: true, notes: "" };
}

function toForm(account: Account): FormState {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    openingBalance: String(account.openingBalance ?? 0),
    openingDate: account.openingDate,
    isActive: account.isActive,
    notes: account.notes ?? "",
  };
}

export default function AccountsCard({ initialAccounts }: { initialAccounts: Account[] }) {
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(account: Account) {
    setForm(toForm(account));
    setDialogOpen(true);
  }

  async function refresh() {
    const res = await fetch("/api/financial/accounts");
    const json = (await res.json().catch(() => null)) as { accounts?: Account[] } | null;
    if (res.ok && json?.accounts) setAccounts(json.accounts);
  }

  const balanceNum = Number(form.openingBalance);
  const invalid =
    !form.name.trim() ||
    !form.openingDate.trim() ||
    !Number.isFinite(balanceNum);

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const payload = {
        id: form.id ?? undefined,
        name: form.name.trim(),
        kind: form.kind,
        opening_balance: balanceNum,
        opening_date: form.openingDate,
        is_active: form.isActive,
        notes: form.notes.trim() || null,
      };
      const res = await fetch("/api/financial/accounts", {
        method: form.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(toHebrewError(json?.error, "שמירת החשבון נכשלה."));
        return;
      }
      toast.success(form.id ? "החשבון עודכן" : "החשבון נוצר");
      setDialogOpen(false);
      await refresh();
    } catch (e: unknown) {
      toast.error(toHebrewError(e, "שמירת החשבון נכשלה."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/financial/accounts?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast.error(toHebrewError(json?.error, "מחיקת החשבון נכשלה."));
        return;
      }
      toast.success("החשבון נמחק");
      setDeleteTarget(null);
      await refresh();
    } catch (e: unknown) {
      toast.error(toHebrewError(e, "מחיקת החשבון נכשלה."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>חשבונות</CardTitle>
        <CardDescription>
          הגדר את חשבונות הבנק והמזומן של העסק. כל חשבון מחזיק יתרת פתיחה נכון לתאריך מסוים, ועליה
          מצטברות התנועות שמשויכות אליו — כך מתקבלת היתרה העדכנית.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            עדיין לא הוגדרו חשבונות. הוסף חשבון בנק או קופת מזומן כדי להתחיל לעקוב אחר היתרה.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{account.name}</span>
                    <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                      {getAccountKindLabel(account.kind)}
                    </span>
                    {!account.isActive && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                        לא פעיל
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    יתרת פתיחה {ils.format(account.openingBalance)} · נכון ל-{account.openingDate}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => openEdit(account)}>
                    עריכה
                  </Button>
                  <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteTarget(account)}>
                    מחיקה
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button type="button" onClick={openCreate}>
          הוספת חשבון
        </Button>
      </CardContent>

      {/* Create / edit dialog */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={form.id ? "עריכת חשבון" : "חשבון חדש"}
        description="יתרת הפתיחה היא הסכום האמיתי בחשבון בתאריך הפתיחה. תנועות לפני תאריך זה נחשבות כבר ככלולות בה."
        size="formMd"
        onSubmit={() => void save()}
        submitLabel="שמירה"
        busyLabel="שומר..."
        busy={saving}
        submitDisabled={invalid}
      >
            <div className="space-y-1">
              <label className="text-sm font-medium">שם החשבון</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">סוג</label>
              <div className="flex gap-1 rounded-lg border bg-secondary/40 p-1">
                {ACCOUNT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, kind: k.value }))}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      form.kind === k.value
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">יתרת פתיחה</label>
                <CurrencyInput
                  value={form.openingBalance}
                  onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך פתיחה</label>
                <DateInput
                  value={form.openingDate}
                  onChange={(e) => setForm((f) => ({ ...f, openingDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            {form.id && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                חשבון פעיל
              </label>
            )}
      </FormDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
        title="מחיקת חשבון"
        description={
          deleteTarget
            ? `למחוק את "${deleteTarget.name}"? התנועות שמשויכות אליו יישארו אך יאבדו את השיוך לחשבון. אפשר במקום זאת לסמן את החשבון כלא פעיל.`
            : ""
        }
        confirmLabel="מחיקה"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}
