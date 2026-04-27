"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import DeleteProjectButton from "@/app/projects/DeleteProjectButton";

type Option = {
  id: string;
  label: string;
};

type ProjectDetails = {
  id: string;
  name: string;
  customer_id: string;
  status: string;
  project_type: string;
  agreed_base_price: number | string | null;
  actual_price: number | string | null;
  expenses_billed_separately: boolean | null;
  project_manager_id: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
};

const defaultStatusOptions = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "construction", "moving", "other", "home"];

function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusLabel(status: string) {
  switch (status) {
    case "quote":
      return "הצעת מחיר";
    case "planned":
      return "מתוכנן";
    case "active":
      return "פעיל";
    case "on_hold":
      return "בהמתנה";
    case "completed":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return status;
  }
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "construction":
      return "בנייה";
    case "moving":
      return "הובלה";
    case "other":
      return "אחר";
    case "home":
      return "בית";
    default:
      return value;
  }
}

export default function ProjectDetailsActions({
  project,
  customerOptions,
  managerOptions,
}: {
  project: ProjectDetails;
  customerOptions: Option[];
  managerOptions: Option[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editName, setEditName] = useState(project.name);
  const [editCustomerId, setEditCustomerId] = useState(project.customer_id);
  const [editProjectType, setEditProjectType] = useState(project.project_type);
  const [editStatus, setEditStatus] = useState(project.status);
  const [editAgreedBasePrice, setEditAgreedBasePrice] = useState(
    String(toNumber(project.agreed_base_price) ?? 0)
  );
  const [editExpensesSeparately, setEditExpensesSeparately] = useState(
    project.expenses_billed_separately === true
  );
  const [editProjectManagerId, setEditProjectManagerId] = useState(project.project_manager_id ?? "");
  const [editStartDate, setEditStartDate] = useState(project.start_date ?? "");
  const [editEndDate, setEditEndDate] = useState(project.end_date ?? "");
  const [editNotes, setEditNotes] = useState(project.notes ?? "");

  const mergedCustomerOptions = useMemo(() => {
    const selectedMissing =
      editCustomerId && !customerOptions.some((customer) => customer.id === editCustomerId);
    if (!selectedMissing) return customerOptions;
    return [{ id: editCustomerId, label: "לקוח נוכחי" }, ...customerOptions];
  }, [customerOptions, editCustomerId]);

  async function saveProjectEdit() {
    if (editSubmitting) return;
    setEditError(null);

    if (!project.id || !editName.trim() || !editCustomerId) {
      setEditError("יש למלא שדות חובה.");
      return;
    }

    const agreed = editAgreedBasePrice.trim() ? Number(editAgreedBasePrice) : 0;
    if (!Number.isFinite(agreed) || agreed < 0) {
      setEditError("מחיר בסיס אינו תקין.");
      return;
    }

    setEditSubmitting(true);
    try {
      const res = await fetch("/api/projects/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          customer_id: editCustomerId,
          name: editName.trim(),
          project_type: editProjectType,
          status: editStatus,
          agreed_base_price: agreed,
          actual_price: agreed,
          expenses_billed_separately: editExpensesSeparately,
          project_manager_id: editProjectManagerId || null,
          start_date: editStartDate || null,
          end_date: editEndDate || null,
          notes: editNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; project?: unknown };
      if (!res.ok || !json.project) {
        setEditError(json.error ?? "עדכון פרויקט נכשל.");
        return;
      }

      setEditOpen(false);
      router.refresh();
    } catch (error: unknown) {
      setEditError(error instanceof Error ? error.message : "שגיאה לא ידועה");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="h-4 w-4" />
          <span>עריכה</span>
        </Button>
        <DeleteProjectButton
          projectId={project.id}
          projectName={project.name}
          redirectTo="/projects"
          size="sm"
        >
          <Trash2 className="h-4 w-4" />
          <span>מחיקה</span>
        </DeleteProjectButton>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>עריכת פרויקט</DialogTitle>
            <DialogDescription>עדכון פרטי הפרויקט מתוך מסך הפרטים.</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveProjectEdit();
            }}
          >
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">שם פרויקט *</label>
                <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">לקוח *</label>
                <select
                  value={editCustomerId}
                  onChange={(event) => setEditCustomerId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">בחירת לקוח...</option>
                  {mergedCustomerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.label}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פרויקט *</label>
                <select
                  value={editProjectType}
                  onChange={(event) => setEditProjectType(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {defaultProjectTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {projectTypeLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סטטוס *</label>
                <select
                  value={editStatus}
                  onChange={(event) => setEditStatus(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {defaultStatusOptions.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <Input
                inputMode="decimal"
                value={editAgreedBasePrice}
                onChange={(event) => setEditAgreedBasePrice(event.target.value)}
              />
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <Input
                  type="date"
                  value={editStartDate}
                  onChange={(event) => setEditStartDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <Input
                  type="date"
                  value={editEndDate}
                  onChange={(event) => setEditEndDate(event.target.value)}
                />
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מנהל פרויקט</label>
              <select
                value={editProjectManagerId}
                onChange={(event) => setEditProjectManagerId(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">ללא שיוך</option>
                {managerOptions.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editExpensesSeparately}
                onChange={(event) => setEditExpensesSeparately(event.target.checked)}
              />
              <span>חיוב הוצאות בנפרד</span>
            </label>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                rows={3}
              />
            </div>

            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(false)}
                disabled={editSubmitting}
              >
                ביטול
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
