"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ProjectRow = Record<string, unknown>;
type Option = { id: string; label: string };
type SortMode = "recent" | "profit_desc";

const defaultStatusOptions = ["planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "renovation", "event"];

function getString(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "string") return value;
  return null;
}

function getNumber(row: ProjectRow, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function projectDisplayName(row: ProjectRow) {
  return getString(row, "name") ?? "פרויקט";
}

function clientDisplayName(row: ProjectRow) {
  return getString(row, "customer_name") ?? "-";
}

function statusValue(row: ProjectRow) {
  return getString(row, "status") ?? "unknown";
}

function statusLabel(status: string) {
  switch (status) {
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
    case "unknown":
      return "לא ידוע";
    default:
      return status;
  }
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "renovation":
      return "שיפוץ";
    case "event":
      return "אירוע";
    default:
      return value;
  }
}

function profitValue(row: ProjectRow) {
  const direct = getNumber(row, "gross_profit");
  if (direct !== null) return direct;

  const actualPrice = getNumber(row, "actual_price");
  const expenses = getNumber(row, "total_expenses");
  if (actualPrice !== null && expenses !== null) return actualPrice - expenses;
  return null;
}

export default function ProjectsClient({
  initialProjects,
  customerOptions,
  managerOptions,
}: {
  initialProjects: ProjectRow[];
  customerOptions: Option[];
  managerOptions: Option[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createProjectType, setCreateProjectType] = useState(defaultProjectTypeOptions[0]);
  const [createStatus, setCreateStatus] = useState(defaultStatusOptions[0]);
  const [createAgreedBasePrice, setCreateAgreedBasePrice] = useState("");
  const [createActualPrice, setCreateActualPrice] = useState("");
  const [createExpensesSeparately, setCreateExpensesSeparately] = useState(false);
  const [createProjectManagerId, setCreateProjectManagerId] = useState("");
  const [createStartDate, setCreateStartDate] = useState("");
  const [createEndDate, setCreateEndDate] = useState("");
  const [createNotes, setCreateNotes] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = projects;

    if (q) {
      list = list.filter((row) => {
        const name = projectDisplayName(row).toLowerCase();
        const client = clientDisplayName(row).toLowerCase();
        return name.includes(q) || client.includes(q);
      });
    }

    if (status !== "all") {
      list = list.filter((row) => statusValue(row) === status);
    }

    if (sort === "profit_desc") {
      list = [...list].sort(
        (a, b) => (profitValue(b) ?? -Infinity) - (profitValue(a) ?? -Infinity)
      );
    }

    return list;
  }, [projects, query, sort, status]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((row) => set.add(statusValue(row)));
    defaultStatusOptions.forEach((value) => set.add(value));
    return Array.from(set).sort();
  }, [projects]);

  const projectTypeOptions = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((row) => {
      const value = getString(row, "project_type");
      if (value) set.add(value);
    });
    defaultProjectTypeOptions.forEach((value) => set.add(value));
    return Array.from(set).sort();
  }, [projects]);

  async function createProject() {
    if (createSubmitting) return;
    setCreateError(null);

    const trimmedName = createName.trim();
    const agreed = Number(createAgreedBasePrice);
    const actual = Number(createActualPrice);

    if (!trimmedName) {
      setCreateError("שם פרויקט הוא שדה חובה.");
      return;
    }
    if (!createCustomerId) {
      setCreateError("לקוח הוא שדה חובה.");
      return;
    }
    if (!createStartDate) {
      setCreateError("תאריך התחלה הוא שדה חובה.");
      return;
    }
    if (!Number.isFinite(agreed) || !Number.isFinite(actual)) {
      setCreateError("המחירים חייבים להיות מספרים תקינים.");
      return;
    }

    setCreateSubmitting(true);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: createCustomerId,
          name: trimmedName,
          project_type: createProjectType,
          status: createStatus,
          agreed_base_price: agreed,
          actual_price: actual,
          expenses_billed_separately: createExpensesSeparately,
          project_manager_id: createProjectManagerId || null,
          start_date: createStartDate,
          end_date: createEndDate || null,
          notes: createNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        project: ProjectRow;
      }>;

      if (!res.ok) {
        setCreateError(json.error ?? "יצירת הפרויקט נכשלה.");
        return;
      }

      if (json.project) {
        setProjects((prev) => [json.project as ProjectRow, ...prev]);
      }

      setCreateOpen(false);
      setCreateName("");
      setCreateCustomerId("");
      setCreateProjectType(projectTypeOptions[0] ?? defaultProjectTypeOptions[0]);
      setCreateStatus(defaultStatusOptions[0]);
      setCreateAgreedBasePrice("");
      setCreateActualPrice("");
      setCreateExpensesSeparately(false);
      setCreateProjectManagerId("");
      setCreateStartDate("");
      setCreateEndDate("");
      setCreateNotes("");
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
      setCreateError(message);
    } finally {
      setCreateSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground">חיפוש</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי לקוח או פרויקט..."
            className="mt-1 h-11"
          />
        </div>

        <div className="flex gap-3">
          <div className="min-w-[10rem]">
            <label className="text-sm text-muted-foreground">סטטוס</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">הכל</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[10rem]">
            <label className="text-sm text-muted-foreground">מיון</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="profit_desc">רווח (גבוה לנמוך)</option>
            </select>
          </div>

          <div className="min-w-[10rem]">
            <label className="text-sm text-muted-foreground opacity-0">הוספה</label>
            <Button type="button" className="h-11 w-full" onClick={() => setCreateOpen(true)}>
              הוספת פרויקט
            </Button>
          </div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">נמצאו {rows.length} פרויקטים</div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const currentStatus = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");

          return (
            <Link key={id} href={`/projects/${id}`} prefetch className="block">
              <Card className="transition-shadow hover:shadow-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{projectDisplayName(row)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">לקוח</span>
                    <span className="truncate">{clientDisplayName(row)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">סטטוס</span>
                    <span className="truncate">{statusLabel(currentStatus)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">רווח</span>
                    <span className={profit !== null && profit < 0 ? "text-destructive" : ""}>
                      {profit === null ? "-" : formatIls(profit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">משימות פתוחות</span>
                    <span>{openTasks === null ? "-" : openTasks}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>הוספת פרויקט חדש</DialogTitle>
            <DialogDescription>מלאו את השדות הנדרשים ליצירת פרויקט.</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createProject();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">שם פרויקט *</label>
                <Input value={createName} onChange={(e) => setCreateName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">לקוח *</label>
                <select
                  value={createCustomerId}
                  onChange={(e) => setCreateCustomerId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">בחר לקוח...</option>
                  {customerOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פרויקט *</label>
                <select
                  value={createProjectType}
                  onChange={(e) => setCreateProjectType(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {projectTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {projectTypeLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">סטטוס *</label>
                <select
                  value={createStatus}
                  onChange={(e) => setCreateStatus(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {defaultStatusOptions.map((v) => (
                    <option key={v} value={v}>
                      {statusLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">מחיר בסיס מוסכם *</label>
                <Input
                  inputMode="decimal"
                  value={createAgreedBasePrice}
                  onChange={(e) => setCreateAgreedBasePrice(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">מחיר בפועל *</label>
                <Input
                  inputMode="decimal"
                  value={createActualPrice}
                  onChange={(e) => setCreateActualPrice(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה *</label>
                <Input
                  type="date"
                  value={createStartDate}
                  onChange={(e) => setCreateStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <Input
                  type="date"
                  value={createEndDate}
                  onChange={(e) => setCreateEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">מנהל פרויקט</label>
              <select
                value={createProjectManagerId}
                onChange={(e) => setCreateProjectManagerId(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">ללא שיוך</option>
                {managerOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createExpensesSeparately}
                onChange={(e) => setCreateExpensesSeparately(e.target.checked)}
              />
              <span>חיוב הוצאות בנפרד</span>
            </label>

            <div className="space-y-1">
              <label className="text-sm font-medium">תיאור / הערות</label>
              <Textarea value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={4} />
            </div>

            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={createSubmitting}>
                {createSubmitting ? "יוצר..." : "יצירת פרויקט"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

