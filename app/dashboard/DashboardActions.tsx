"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  FolderKanban,
  Landmark,
  ListTodo,
  ShoppingCart,
} from "lucide-react";
import NewOrderClient from "@/app/sales/orders/new/NewOrderClient";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Row = Record<string, unknown>;

type ProjectOption = {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
};

type UserOption = {
  id: string;
  label: string;
};

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function nextMonth(dateString: string) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString().slice(0, 10);
}

const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-background/80 px-4 py-2 text-sm shadow-sm outline-none transition-all focus:border-destructive/40 focus:ring-2 focus:ring-ring";

export default function DashboardActions({
  customers,
  products,
  projects,
  users,
  currentUserId,
}: {
  customers: Row[];
  products: Row[];
  projects: ProjectOption[];
  users: UserOption[];
  currentUserId?: string;
}) {
  const router = useRouter();

  const [orderOpen, setOrderOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [incomeOpen, setIncomeOpen] = useState(false);

  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectCustomerId, setProjectCustomerId] = useState("");
  const [projectType, setProjectType] = useState("logistics");
  const [projectStatus, setProjectStatus] = useState("planned");
  const [projectPrice, setProjectPrice] = useState("");
  const [projectManagerId, setProjectManagerId] = useState(currentUserId ?? "");
  const [projectStartDate, setProjectStartDate] = useState(getTodayDate());
  const [projectEndDate, setProjectEndDate] = useState(nextMonth(getTodayDate()));
  const [projectNotes, setProjectNotes] = useState("");

  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskProjectId, setTaskProjectId] = useState(projects[0]?.id ?? "");
  const [taskSubject, setTaskSubject] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskDueDate, setTaskDueDate] = useState(getTodayDate());
  const [taskAssignedUserId, setTaskAssignedUserId] = useState(currentUserId ?? "");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskStatus, setTaskStatus] = useState("todo");

  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [expenseProjectId, setExpenseProjectId] = useState(projects[0]?.id ?? "");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");

  const [incomeSubmitting, setIncomeSubmitting] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeProjectId, setIncomeProjectId] = useState(projects[0]?.id ?? "");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(getTodayDate());
  const [incomeMethod, setIncomeMethod] = useState("bank_transfer");
  const [incomeReference, setIncomeReference] = useState("");
  const [incomeNotes, setIncomeNotes] = useState("");
  const [financeNavLoading, setFinanceNavLoading] = useState(false);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );

  function resetProjectForm() {
    setProjectError(null);
    setProjectName("");
    setProjectCustomerId("");
    setProjectType("logistics");
    setProjectStatus("planned");
    setProjectPrice("");
    setProjectManagerId(currentUserId ?? "");
    setProjectStartDate(getTodayDate());
    setProjectEndDate(nextMonth(getTodayDate()));
    setProjectNotes("");
  }

  function resetTaskForm() {
    setTaskError(null);
    setTaskProjectId(projects[0]?.id ?? "");
    setTaskSubject("");
    setTaskDescription("");
    setTaskDueDate(getTodayDate());
    setTaskAssignedUserId(currentUserId ?? "");
    setTaskPriority("medium");
    setTaskStatus("todo");
  }

  function resetExpenseForm() {
    setExpenseError(null);
    setExpenseProjectId(projects[0]?.id ?? "");
    setExpenseAmount("");
    setExpenseCategory("");
    setExpenseDate(getTodayDate());
    setExpenseDescription("");
    setExpenseNotes("");
  }

  function resetIncomeForm() {
    setIncomeError(null);
    setIncomeProjectId(projects[0]?.id ?? "");
    setIncomeAmount("");
    setIncomeDate(getTodayDate());
    setIncomeMethod("bank_transfer");
    setIncomeReference("");
    setIncomeNotes("");
  }

  async function createProject() {
    setProjectError(null);
    if (!projectName.trim() || !projectCustomerId) {
      setProjectError("יש לבחור לקוח ולמלא שם פרויקט.");
      return;
    }

    setProjectSubmitting(true);
    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: projectCustomerId,
          name: projectName.trim(),
          project_type: projectType,
          status: projectStatus,
          agreed_base_price: projectPrice.trim() ? Number(projectPrice) : 0,
          actual_price: projectPrice.trim() ? Number(projectPrice) : 0,
          project_manager_id: projectManagerId || null,
          start_date: projectStartDate || null,
          end_date: projectEndDate || null,
          notes: projectNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; project?: Row };
      if (!res.ok || !json.project) {
        setProjectError(json.error ?? "יצירת הפרויקט נכשלה.");
        return;
      }

      setProjectOpen(false);
      resetProjectForm();
      router.refresh();
      toast.success("הפרויקט נשמר");
    } catch (error: unknown) {
      setProjectError(error instanceof Error ? error.message : "שגיאה לא ידועה");
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function createTask() {
    setTaskError(null);
    const selectedProject = projectById.get(taskProjectId);
    if (!selectedProject || !taskSubject.trim() || !taskAssignedUserId || !taskDueDate) {
      setTaskError("יש לבחור פרויקט, אחראי, תאריך יעד ונושא.");
      return;
    }

    setTaskSubmitting(true);
    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProject.id,
          customer_id: selectedProject.customerId,
          subject: taskSubject.trim(),
          description: taskDescription.trim() || null,
          due_date: taskDueDate,
          assigned_user_id: taskAssignedUserId,
          priority: taskPriority,
          status: taskStatus,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; task?: Row };
      if (!res.ok || !json.task) {
        setTaskError(json.error ?? "יצירת המשימה נכשלה.");
        return;
      }

      setTaskOpen(false);
      resetTaskForm();
      router.refresh();
      toast.success("המשימה נשמרה");
    } catch (error: unknown) {
      setTaskError(error instanceof Error ? error.message : "שגיאה לא ידועה");
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function createExpense() {
    setExpenseError(null);
    if (!expenseProjectId || !expenseCategory.trim() || !expenseDate) {
      setExpenseError("יש לבחור פרויקט, קטגוריה ותאריך.");
      return;
    }

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setExpenseError("יש להזין סכום הוצאה תקין.");
      return;
    }

    setExpenseSubmitting(true);
    try {
      const res = await fetch("/api/expenses/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: expenseProjectId,
          amount,
          category: expenseCategory.trim(),
          expense_date: expenseDate,
          description: expenseDescription.trim() || null,
          notes: expenseNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; expense?: Row };
      if (!res.ok || !json.expense) {
        setExpenseError(json.error ?? "הוספת ההוצאה נכשלה.");
        return;
      }

      setExpenseOpen(false);
      resetExpenseForm();
      router.refresh();
      toast.success("ההוצאה נשמרה");
    } catch (error: unknown) {
      setExpenseError(error instanceof Error ? error.message : "שגיאה לא ידועה");
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function createIncome() {
    setIncomeError(null);
    if (!incomeProjectId || !incomeDate || !incomeMethod.trim()) {
      setIncomeError("יש לבחור פרויקט, תאריך ואמצעי תשלום.");
      return;
    }

    const amount = Number(incomeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setIncomeError("יש להזין סכום הכנסה תקין.");
      return;
    }

    setIncomeSubmitting(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target_type: "project",
          target_id: incomeProjectId,
          amount_total: amount,
          payment_date: incomeDate,
          payment_method: incomeMethod,
          reference_number: incomeReference.trim() || null,
          notes: incomeNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; payment?: Row };
      if (!res.ok || !json.payment) {
        setIncomeError(json.error ?? "הוספת ההכנסה נכשלה.");
        return;
      }

      setIncomeOpen(false);
      resetIncomeForm();
      router.refresh();
      toast.success("ההכנסה נשמרה");
    } catch (error: unknown) {
      setIncomeError(error instanceof Error ? error.message : "שגיאה לא ידועה");
    } finally {
      setIncomeSubmitting(false);
    }
  }

  return (
    <>
      <AdaptiveGrid variant="quickActions">
        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => setOrderOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ShoppingCart className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">הזמנה חדשה</span>
            <span className="text-xs text-muted-foreground">פתיחת טופס הזמנה מהירה</span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => setProjectOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <FolderKanban className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">פרויקט חדש</span>
            <span className="text-xs text-muted-foreground">יצירה מהירה בלי לעזוב את הדשבורד</span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => setTaskOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ListTodo className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">משימה חדשה</span>
            <span className="text-xs text-muted-foreground">שיוך מהיר לפרויקט קיים</span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => {
            if (financeNavLoading) return;
            setFinanceNavLoading(true);
            emitNavigationStart();
            router.push("/financial");
          }}
          disabled={financeNavLoading}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <Landmark className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">פיננסים</span>
            <span className="text-xs text-muted-foreground">מעבר למסך הכספים המלא</span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => setExpenseOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ArrowDownCircle className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">הוצאה חדשה</span>
            <span className="text-xs text-muted-foreground">רישום הוצאה לפרויקט</span>
          </span>
        </Button>

        <Button
          type="button"
          variant="outline"
          className="aspect-square h-auto min-h-24 flex-col items-start justify-between rounded-2xl p-3 text-right"
          onClick={() => setIncomeOpen(true)}
        >
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <ArrowUpCircle className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start">
            <span className="font-semibold">הכנסה חדשה</span>
            <span className="text-xs text-muted-foreground">רישום תשלום לפרויקט</span>
          </span>
        </Button>
      </AdaptiveGrid>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <AdaptiveDialog size="newOrder">
          <DialogHeader>
            <DialogTitle>הזמנה חדשה</DialogTitle>
            <DialogDescription>פתיחת הזמנה מתוך הדשבורד בלי מעבר למסך המכירות.</DialogDescription>
          </DialogHeader>

          <NewOrderClient
            customers={customers}
            products={products}
            customersError={null}
            productsError={null}
            embedded
            onCancel={() => setOrderOpen(false)}
            onSubmitted={() => {
              setOrderOpen(false);
              router.refresh();
              toast.success("ההזמנה נשמרה");
            }}
          />
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={projectOpen}
        onOpenChange={(open) => {
          setProjectOpen(open);
          if (!open) resetProjectForm();
        }}
      >
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>פרויקט חדש</DialogTitle>
            <DialogDescription>טופס קצר לפתיחה מהירה של פרויקט חדש.</DialogDescription>
          </DialogHeader>

          <fieldset disabled={projectSubmitting} className="contents">
          <AdaptiveGrid variant="formTwoLoose">
            <label className="space-y-2 text-sm">
              <span>שם פרויקט</span>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
            </label>

            <label className="space-y-2 text-sm">
              <span>לקוח</span>
              <select
                className={fieldClass}
                value={projectCustomerId}
                onChange={(e) => setProjectCustomerId(e.target.value)}
              >
                <option value="">בחרו לקוח</option>
                {customers.map((customer) => {
                  const id = getString(customer, "id");
                  const name =
                    getString(customer, "name") ||
                    getString(customer, "name_for_invoice") ||
                    "לקוח";
                  return (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span>סוג פרויקט</span>
              <select
                className={fieldClass}
                value={projectType}
                onChange={(e) => setProjectType(e.target.value)}
              >
                <option value="logistics">לוגיסטיקה</option>
                <option value="construction">בנייה</option>
                <option value="moving">הובלה</option>
                <option value="home">בית</option>
                <option value="other">אחר</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span>סטטוס</span>
              <select
                className={fieldClass}
                value={projectStatus}
                onChange={(e) => setProjectStatus(e.target.value)}
              >
                <option value="planned">מתוכנן</option>
                <option value="active">פעיל</option>
                <option value="on_hold">בהמתנה</option>
                <option value="completed">הושלם</option>
                <option value="cancelled">בוטל</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span>מחיר בסיס</span>
              <Input
                type="number"
                min="0"
                value={projectPrice}
                onChange={(e) => setProjectPrice(e.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm">
              <span>מנהל פרויקט</span>
              <select
                className={fieldClass}
                value={projectManagerId}
                onChange={(e) => setProjectManagerId(e.target.value)}
              >
                <option value="">ללא שיוך</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span>תאריך התחלה</span>
              <Input
                type="date"
                value={projectStartDate}
                onChange={(e) => setProjectStartDate(e.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm">
              <span>תאריך סיום</span>
              <Input
                type="date"
                value={projectEndDate}
                onChange={(e) => setProjectEndDate(e.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm col-span-full">
              <span>הערות</span>
              <Textarea value={projectNotes} onChange={(e) => setProjectNotes(e.target.value)} />
            </label>
          </AdaptiveGrid>
          </fieldset>

          {projectError ? <p className="text-sm text-destructive">{projectError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setProjectOpen(false)} disabled={projectSubmitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void createProject()} disabled={projectSubmitting}>
              {projectSubmitting ? "שומר..." : "שמירת פרויקט"}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={taskOpen}
        onOpenChange={(open) => {
          setTaskOpen(open);
          if (!open) resetTaskForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>משימה חדשה</DialogTitle>
            <DialogDescription>פתיחה מהירה של משימה ושיוך לפרויקט קיים.</DialogDescription>
          </DialogHeader>

          <fieldset disabled={taskSubmitting} className="contents">
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span>פרויקט</span>
              <select
                className={fieldClass}
                value={taskProjectId}
                onChange={(e) => setTaskProjectId(e.target.value)}
              >
                <option value="">בחרו פרויקט</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} | {project.customerName}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span>נושא</span>
              <Input value={taskSubject} onChange={(e) => setTaskSubject(e.target.value)} />
            </label>

            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>תאריך יעד</span>
                <Input
                  type="date"
                  value={taskDueDate}
                  onChange={(e) => setTaskDueDate(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>אחראי</span>
                <select
                  className={fieldClass}
                  value={taskAssignedUserId}
                  onChange={(e) => setTaskAssignedUserId(e.target.value)}
                >
                  <option value="">בחרו אחראי</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </label>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>עדיפות</span>
                <select
                  className={fieldClass}
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value)}
                >
                  <option value="low">נמוכה</option>
                  <option value="medium">בינונית</option>
                  <option value="high">גבוהה</option>
                  <option value="urgent">דחופה</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>סטטוס</span>
                <select
                  className={fieldClass}
                  value={taskStatus}
                  onChange={(e) => setTaskStatus(e.target.value)}
                >
                  <option value="todo">לביצוע</option>
                  <option value="in_progress">בתהליך</option>
                  <option value="blocked">חסום</option>
                  <option value="done">בוצע</option>
                  <option value="cancelled">בוטל</option>
                </select>
              </label>
            </AdaptiveGrid>

            <label className="space-y-2 text-sm">
              <span>תיאור</span>
              <Textarea value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} />
            </label>
          </div>
          </fieldset>

          {taskError ? <p className="text-sm text-destructive">{taskError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTaskOpen(false)} disabled={taskSubmitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void createTask()} disabled={taskSubmitting}>
              {taskSubmitting ? "שומר..." : "שמירת משימה"}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={expenseOpen}
        onOpenChange={(open) => {
          setExpenseOpen(open);
          if (!open) resetExpenseForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>הוצאה חדשה</DialogTitle>
            <DialogDescription>רישום הוצאה חדשה ושיוך לפרויקט.</DialogDescription>
          </DialogHeader>

          <fieldset disabled={expenseSubmitting} className="contents">
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span>פרויקט</span>
              <select
                className={fieldClass}
                value={expenseProjectId}
                onChange={(e) => setExpenseProjectId(e.target.value)}
              >
                <option value="">בחרו פרויקט</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} | {project.customerName}
                  </option>
                ))}
              </select>
            </label>

            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>סכום</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>תאריך</span>
                <Input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </label>
            </AdaptiveGrid>

            <label className="space-y-2 text-sm">
              <span>קטגוריה</span>
              <Input value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} />
            </label>

            <label className="space-y-2 text-sm">
              <span>תיאור</span>
              <Input
                value={expenseDescription}
                onChange={(e) => setExpenseDescription(e.target.value)}
              />
            </label>

            <label className="space-y-2 text-sm">
              <span>הערות</span>
              <Textarea value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
            </label>
          </div>
          </fieldset>

          {expenseError ? <p className="text-sm text-destructive">{expenseError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setExpenseOpen(false)} disabled={expenseSubmitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void createExpense()} disabled={expenseSubmitting}>
              {expenseSubmitting ? "שומר..." : "שמירת הוצאה"}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={incomeOpen}
        onOpenChange={(open) => {
          setIncomeOpen(open);
          if (!open) resetIncomeForm();
        }}
      >
        <AdaptiveDialog size="formXl">
          <DialogHeader>
            <DialogTitle>הכנסה חדשה</DialogTitle>
            <DialogDescription>רישום הכנסה חדשה כתשלום לפרויקט.</DialogDescription>
          </DialogHeader>

          <fieldset disabled={incomeSubmitting} className="contents">
          <div className="grid gap-4">
            <label className="space-y-2 text-sm">
              <span>פרויקט</span>
              <select
                className={fieldClass}
                value={incomeProjectId}
                onChange={(e) => setIncomeProjectId(e.target.value)}
              >
                <option value="">בחרו פרויקט</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} | {project.customerName}
                  </option>
                ))}
              </select>
            </label>

            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>סכום</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={incomeAmount}
                  onChange={(e) => setIncomeAmount(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>תאריך</span>
                <Input
                  type="date"
                  value={incomeDate}
                  onChange={(e) => setIncomeDate(e.target.value)}
                />
              </label>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>אמצעי תשלום</span>
                <select
                  className={fieldClass}
                  value={incomeMethod}
                  onChange={(e) => setIncomeMethod(e.target.value)}
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="cash">Cash</option>
                  <option value="credit_card">Credit card</option>
                  <option value="check">Check</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>אסמכתא</span>
                <Input
                  value={incomeReference}
                  onChange={(e) => setIncomeReference(e.target.value)}
                />
              </label>
            </AdaptiveGrid>

            <label className="space-y-2 text-sm">
              <span>הערות</span>
              <Textarea value={incomeNotes} onChange={(e) => setIncomeNotes(e.target.value)} />
            </label>
          </div>
          </fieldset>

          {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIncomeOpen(false)} disabled={incomeSubmitting}>
              ביטול
            </Button>
            <Button type="button" onClick={() => void createIncome()} disabled={incomeSubmitting}>
              {incomeSubmitting ? "שומר..." : "שמירת הכנסה"}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
