"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
type Option = { id: string; label: string; phone?: string | null; email?: string | null };
type SortMode = "recent" | "profit_desc";

const defaultStatusOptions = ["planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "construction", "moving", "other", "home"];
const cityOptions = [
  "ירושלים",
  "בני ברק",
  "אלעד",
  "ביתר עילית",
  "בית שמש",
  "אשדוד",
  "דימונה",
  "מירון",
  "פתח תקווה",
  "תל אביב",
  "חיפה",
  "נתניה",
  "באר שבע",
  "ראשון לציון",
  "אחר",
];

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

function profitValue(row: ProjectRow) {
  const direct = getNumber(row, "gross_profit");
  if (direct !== null) return direct;

  const actualPrice = getNumber(row, "actual_price");
  const expenses = getNumber(row, "total_expenses");
  if (actualPrice !== null && expenses !== null) return actualPrice - expenses;
  return null;
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function oneMonthFrom(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export default function ProjectsClient({
  initialProjects,
  customerOptions,
  managerOptions,
  currentUserId,
}: {
  initialProjects: ProjectRow[];
  customerOptions: Option[];
  managerOptions: Option[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillHandled = useRef(false);
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("recent");

  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createCustomerId, setCreateCustomerId] = useState("");
  const [createCustomerQuery, setCreateCustomerQuery] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [createProjectType, setCreateProjectType] = useState(defaultProjectTypeOptions[0]);
  const [createStatus, setCreateStatus] = useState(defaultStatusOptions[0]);
  const [createAgreedBasePrice, setCreateAgreedBasePrice] = useState("");
  const [createExpensesSeparately, setCreateExpensesSeparately] = useState(false);
  const [createProjectManagerId, setCreateProjectManagerId] = useState(currentUserId ?? "");
  const [createStartDate, setCreateStartDate] = useState(todayIso());
  const [createEndDate, setCreateEndDate] = useState(oneMonthFrom(todayIso()));
  const [createNotes, setCreateNotes] = useState("");

  const [customerOptionsState, setCustomerOptionsState] = useState<Option[]>(customerOptions);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [createCustomerPhone, setCreateCustomerPhone] = useState("");
  const [createCustomerEmail, setCreateCustomerEmail] = useState("");
  const [createCustomerCity, setCreateCustomerCity] = useState("");
  const [createCustomerCityOther, setCreateCustomerCityOther] = useState("");
  const [createCustomerAddress, setCreateCustomerAddress] = useState("");
  const [createCustomerNotes, setCreateCustomerNotes] = useState("");
  const [createCustomerError, setCreateCustomerError] = useState<string | null>(null);
  const [createCustomerSubmitting, setCreateCustomerSubmitting] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editCustomerId, setEditCustomerId] = useState("");
  const [editProjectType, setEditProjectType] = useState(defaultProjectTypeOptions[0]);
  const [editStatus, setEditStatus] = useState(defaultStatusOptions[0]);
  const [editAgreedBasePrice, setEditAgreedBasePrice] = useState("");
  const [editExpensesSeparately, setEditExpensesSeparately] = useState(false);
  const [editProjectManagerId, setEditProjectManagerId] = useState("");
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editNotes, setEditNotes] = useState("");

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

  const filteredCustomerOptions = useMemo(() => {
    const q = createCustomerQuery.trim().toLowerCase();
    const qPhone = normalizePhone(createCustomerQuery);
    if (!q && !qPhone) return customerOptionsState.slice(0, 50);

    return customerOptionsState
      .filter((customer) => {
        const byName = customer.label.toLowerCase().includes(q);
        const byEmail = (customer.email ?? "").toLowerCase().includes(q);
        const byPhone = (customer.phone ? normalizePhone(customer.phone) : "").includes(qPhone);
        return byName || byEmail || (qPhone ? byPhone : false);
      })
      .slice(0, 50);
  }, [createCustomerQuery, customerOptionsState]);

  const selectedCustomer = customerOptionsState.find((row) => row.id === createCustomerId) ?? null;

  useEffect(() => {
    if (prefillHandled.current) return;

    const prefillCustomerId = (searchParams.get("customer_id") ?? "").trim();
    const shouldOpenCreate = (searchParams.get("create") ?? "").trim() === "1";

    if (prefillCustomerId) {
      const matched = customerOptionsState.find((row) => row.id === prefillCustomerId) ?? null;
      setCreateCustomerId(prefillCustomerId);
      setCreateCustomerQuery(matched?.label ?? "");
      setCreateOpen(true);
    } else if (shouldOpenCreate) {
      setCreateOpen(true);
    }

    prefillHandled.current = true;
  }, [customerOptionsState, searchParams]);

  async function createCustomer() {
    if (createCustomerSubmitting) return;
    setCreateCustomerError(null);

    const name = createCustomerName.trim();
    const email = createCustomerEmail.trim();
    const city =
      createCustomerCity === "אחר"
        ? createCustomerCityOther.trim()
        : createCustomerCity.trim();
    const address = createCustomerAddress.trim();

    if (!name) {
      setCreateCustomerError("יש להזין שם לקוח.");
      return;
    }
    if (!email) {
      setCreateCustomerError("יש להזין אימייל לקוח.");
      return;
    }
    if (!city) {
      setCreateCustomerError("יש לבחור עיר.");
      return;
    }
    if (!address) {
      setCreateCustomerError("יש להזין כתובת.");
      return;
    }

    setCreateCustomerSubmitting(true);
    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          phone: createCustomerPhone.trim() || null,
          email,
          city,
          address,
          notes: createCustomerNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        customer?: ProjectRow;
      };

      if (!res.ok || !json.customer) {
        setCreateCustomerError(json.error ?? "יצירת לקוח נכשלה.");
        return;
      }

      const newCustomer: Option = {
        id: getString(json.customer, "id") ?? "",
        label:
          getString(json.customer, "name") ??
          getString(json.customer, "name_for_invoice") ??
          name,
        phone: getString(json.customer, "phone"),
        email: getString(json.customer, "email"),
      };

      if (newCustomer.id) {
        setCustomerOptionsState((prev) => [newCustomer, ...prev]);
        setCreateCustomerId(newCustomer.id);
        setCreateCustomerQuery(newCustomer.label);
      }

      setCreateCustomerOpen(false);
      setCreateCustomerName("");
      setCreateCustomerPhone("");
      setCreateCustomerEmail("");
      setCreateCustomerCity("");
      setCreateCustomerCityOther("");
      setCreateCustomerAddress("");
      setCreateCustomerNotes("");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
      setCreateCustomerError(message);
    } finally {
      setCreateCustomerSubmitting(false);
    }
  }

  async function createProject() {
    if (createSubmitting) return;
    setCreateError(null);

    const trimmedName = createName.trim();
    const agreed = createAgreedBasePrice.trim() ? Number(createAgreedBasePrice) : 0;
    const actual = agreed;

    if (!trimmedName) {
      setCreateError("שם פרויקט הוא שדה חובה.");
      return;
    }
    if (!createCustomerId) {
      setCreateError("לקוח הוא שדה חובה.");
      return;
    }
    if (!Number.isFinite(agreed) || agreed < 0 || !Number.isFinite(actual)) {
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
          start_date: createStartDate || null,
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
      setCreateCustomerQuery("");
      setCustomerPickerOpen(false);
      setCreateProjectType(projectTypeOptions[0] ?? defaultProjectTypeOptions[0]);
      setCreateStatus(defaultStatusOptions[0]);
      setCreateAgreedBasePrice("");
      setCreateExpensesSeparately(false);
      setCreateProjectManagerId(currentUserId ?? "");
      const now = todayIso();
      setCreateStartDate(now);
      setCreateEndDate(oneMonthFrom(now));
      setCreateNotes("");
      router.refresh();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "שגיאה לא ידועה";
      setCreateError(message);
    } finally {
      setCreateSubmitting(false);
    }
  }

  function openEditProject(row: ProjectRow) {
    setEditError(null);
    setEditId(getString(row, "id") ?? "");
    setEditName(getString(row, "name") ?? "");
    setEditCustomerId(getString(row, "customer_id") ?? "");
    setEditProjectType(getString(row, "project_type") ?? defaultProjectTypeOptions[0]);
    setEditStatus(getString(row, "status") ?? defaultStatusOptions[0]);
    setEditAgreedBasePrice(String(getNumber(row, "agreed_base_price") ?? 0));
    setEditExpensesSeparately(row["expenses_billed_separately"] === true);
    setEditProjectManagerId(getString(row, "project_manager_id") ?? "");
    setEditStartDate(getString(row, "start_date") ?? "");
    setEditEndDate(getString(row, "end_date") ?? "");
    setEditNotes(getString(row, "notes") ?? "");
    setEditOpen(true);
  }

  async function saveProjectEdit() {
    if (editSubmitting) return;
    setEditError(null);

    if (!editId || !editName.trim() || !editCustomerId) {
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
          id: editId,
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

      const json = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        project: ProjectRow;
      }>;

      if (!res.ok || !json.project) {
        setEditError(json.error ?? "עדכון פרויקט נכשל.");
        return;
      }

      setProjects((prev) =>
        prev.map((row) => {
          const id = getString(row, "id") ?? "";
          return id === editId ? (json.project as ProjectRow) : row;
        })
      );
      setEditOpen(false);
    } catch (e: unknown) {
      setEditError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setEditSubmitting(false);
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

      <div className="space-y-3">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const currentStatus = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");

          return (
            <div key={id} className="flex items-stretch gap-2">
              <Link
                href={`/projects/${id}`}
                prefetch
                className="block flex-1"
                onClick={() => emitNavigationStart()}
              >
                <Card className="h-full transition-shadow hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="text-base font-semibold">{projectDisplayName(row)}</div>
                        <div className="text-sm text-muted-foreground">
                          לקוח: {clientDisplayName(row)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">סטטוס:</span>
                          <span>{statusLabel(currentStatus)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">רווח:</span>
                          <span className={profit !== null && profit < 0 ? "text-destructive" : ""}>
                            {profit === null ? "-" : formatIls(profit)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">משימות פתוחות:</span>
                          <span>{openTasks === null ? "-" : openTasks}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">סוג:</span>
                          <span>{projectTypeLabel(getString(row, "project_type") ?? "")}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <div className="flex shrink-0 items-center">
                <Button type="button" variant="outline" size="sm" onClick={() => openEditProject(row)}>
                  עריכת פרויקט
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
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
                <div className="flex items-center justify-between rounded-md border p-2">
                  <p className="text-xs text-muted-foreground">
                    {selectedCustomer ? `נבחר: ${selectedCustomer.label}` : "לא נבחר לקוח"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCustomerPickerOpen((prev) => !prev)}
                  >
                    {customerPickerOpen ? "סגירת בחירה" : "בחירת לקוח"}
                  </Button>
                </div>

                {customerPickerOpen ? (
                  <div className="space-y-2 rounded-md border p-2">
                    <Input
                      value={createCustomerQuery}
                      onChange={(e) => setCreateCustomerQuery(e.target.value)}
                      placeholder="חיפוש לפי שם / טלפון / אימייל"
                    />
                    <div className="max-h-56 space-y-2 overflow-y-auto">
                      {filteredCustomerOptions.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => {
                            setCreateCustomerId(customer.id);
                            setCreateCustomerQuery(customer.label);
                            setCustomerPickerOpen(false);
                          }}
                          className={`w-full rounded-md border p-2 text-right text-sm transition-colors ${
                            customer.id === createCustomerId
                              ? "border-primary bg-primary/5"
                              : "hover:bg-muted/50"
                          }`}
                        >
                          <div className="font-medium">{customer.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {customer.phone ? `טלפון: ${customer.phone}` : "טלפון: -"}
                            {customer.email ? ` | אימייל: ${customer.email}` : ""}
                          </div>
                        </button>
                      ))}
                      {filteredCustomerOptions.length === 0 ? (
                        <p className="p-2 text-xs text-muted-foreground">לא נמצאו לקוחות.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateCustomerOpen(true)}
                  >
                    לקוח חדש
                  </Button>
                </div>
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

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <Input
                inputMode="decimal"
                value={createAgreedBasePrice}
                onChange={(e) => setCreateAgreedBasePrice(e.target.value)}
                placeholder="אופציונלי, ברירת מחדל 0"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <Input
                  type="date"
                  value={createStartDate}
                  onChange={(e) => setCreateStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום (אופציונלי)</label>
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
            {createSubmitting ? (
              <p className="text-xs text-muted-foreground">הפרויקט נוצר כעת, נא להמתין...</p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>עריכת פרויקט</DialogTitle>
            <DialogDescription>עדכון פרטי פרויקט קיים.</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProjectEdit();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">שם פרויקט *</label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">לקוח *</label>
                <select
                  value={editCustomerId}
                  onChange={(e) => setEditCustomerId(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">בחירת לקוח...</option>
                  {customerOptionsState.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פרויקט *</label>
                <select
                  value={editProjectType}
                  onChange={(e) => setEditProjectType(e.target.value)}
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
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
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

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <Input
                inputMode="decimal"
                value={editAgreedBasePrice}
                onChange={(e) => setEditAgreedBasePrice(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <Input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">מנהל פרויקט</label>
              <select
                value={editProjectManagerId}
                onChange={(e) => setEditProjectManagerId(e.target.value)}
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
                checked={editExpensesSeparately}
                onChange={(e) => setEditExpensesSeparately(e.target.checked)}
              />
              <span>חיוב הוצאות בנפרד</span>
            </label>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
            </div>

            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createCustomerOpen} onOpenChange={setCreateCustomerOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>הוספת לקוח חדש</DialogTitle>
            <DialogDescription>
              הלקוח לא נמצא? אפשר ליצור אותו ישירות כאן. שדות חובה: שם, אימייל, עיר וכתובת.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createCustomer();
            }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium">שם לקוח *</label>
              <Input
                value={createCustomerName}
                onChange={(e) => setCreateCustomerName(e.target.value)}
                placeholder="שם מלא או שם חברה"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">טלפון</label>
              <Input
                value={createCustomerPhone}
                onChange={(e) => setCreateCustomerPhone(e.target.value)}
                placeholder="0501234567"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">אימייל *</label>
              <Input
                value={createCustomerEmail}
                onChange={(e) => setCreateCustomerEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">עיר *</label>
              <select
                value={createCustomerCity}
                onChange={(e) => setCreateCustomerCity(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">בחר עיר...</option>
                {cityOptions.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </div>

            {createCustomerCity === "אחר" ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">עיר (הקלדה חופשית) *</label>
                <Input
                  value={createCustomerCityOther}
                  onChange={(e) => setCreateCustomerCityOther(e.target.value)}
                  placeholder="הזן עיר"
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-sm font-medium">כתובת *</label>
              <Input
                value={createCustomerAddress}
                onChange={(e) => setCreateCustomerAddress(e.target.value)}
                placeholder="רחוב, מספר בית, דירה"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea
                value={createCustomerNotes}
                onChange={(e) => setCreateCustomerNotes(e.target.value)}
                rows={3}
                placeholder="הערות על הלקוח (אופציונלי)"
              />
            </div>

            {createCustomerError ? (
              <p className="text-sm text-destructive">{createCustomerError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateCustomerOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={createCustomerSubmitting}>
                {createCustomerSubmitting ? "שומר..." : "שמירת לקוח"}
              </Button>
            </DialogFooter>
            {createCustomerSubmitting ? (
              <p className="text-xs text-muted-foreground">הלקוח נוצר כעת, נא להמתין...</p>
            ) : null}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}



