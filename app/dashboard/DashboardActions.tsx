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
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
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
  type?: string;
  customerId: string;
  customerName: string;
};

type UserOption = {
  id: string;
  label: string;
};

type EntityOption = {
  id: string;
  name: string;
  subtitle?: string;
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

const DASHBOARD_EXPENSE_CATEGORY_OPTIONS = [
  "\u05e9\u05db\u05e8 \u05e2\u05d5\u05d1\u05d3",
  "\u05e8\u05db\u05e9",
  "\u05ea\u05d7\u05d1\u05d5\u05e8\u05d4",
  "\u05d0\u05d5\u05db\u05dc",
  "\u05d0\u05d7\u05e8",
] as const;
const OTHER_EXPENSE_CATEGORY = "\u05d0\u05d7\u05e8";
const HEBREW = {
  saveErrorUnknown: "\u05e9\u05d2\u05d9\u05d0\u05d4 \u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2\u05d4",
  cancel: "\u05d1\u05d9\u05d8\u05d5\u05dc",
  saving: "\u05e9\u05d5\u05de\u05e8...",
  customerFallback: "\u05dc\u05e7\u05d5\u05d7",
  selectCustomer: "\u05d1\u05d7\u05e8\u05d5 \u05dc\u05e7\u05d5\u05d7",
  selectProject: "\u05d1\u05d7\u05e8\u05d5 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  orderNew: "\u05d4\u05d6\u05de\u05e0\u05d4 \u05d7\u05d3\u05e9\u05d4",
  orderQuickOpen: "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d8\u05d5\u05e4\u05e1 \u05d4\u05d6\u05de\u05e0\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4",
  orderDialogDescription:
    "\u05e4\u05ea\u05d9\u05d7\u05ea \u05d4\u05d6\u05de\u05e0\u05d4 \u05de\u05ea\u05d5\u05da \u05d4\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3 \u05d1\u05dc\u05d9 \u05de\u05e2\u05d1\u05e8 \u05dc\u05de\u05e1\u05da \u05d4\u05de\u05db\u05d9\u05e8\u05d5\u05ea.",
  orderSaved: "\u05d4\u05d4\u05d6\u05de\u05e0\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  projectNew: "\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d7\u05d3\u05e9",
  projectQuickCreate:
    "\u05d9\u05e6\u05d9\u05e8\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05d1\u05dc\u05d9 \u05dc\u05e2\u05d6\u05d5\u05d1 \u05d0\u05ea \u05d4\u05d3\u05e9\u05d1\u05d5\u05e8\u05d3",
  projectDialogDescription:
    "\u05d8\u05d5\u05e4\u05e1 \u05e7\u05e6\u05e8 \u05dc\u05e4\u05ea\u05d9\u05d7\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05e9\u05dc \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05d7\u05d3\u05e9.",
  projectName: "\u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  customer: "\u05dc\u05e7\u05d5\u05d7",
  projectType: "\u05e1\u05d5\u05d2 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  logistics: "\u05dc\u05d5\u05d2\u05d9\u05e1\u05d8\u05d9\u05e7\u05d4",
  moving: "\u05d4\u05d5\u05d1\u05dc\u05d4",
  renovation: "\u05e9\u05d9\u05e4\u05d5\u05e6\u05d9\u05dd",
  status: "\u05e1\u05d8\u05d8\u05d5\u05e1",
  statusPlanned: "\u05de\u05ea\u05d5\u05db\u05e0\u05df",
  statusActive: "\u05e4\u05e2\u05d9\u05dc",
  statusOnHold: "\u05d1\u05d4\u05de\u05ea\u05e0\u05d4",
  statusCompleted: "\u05d4\u05d5\u05e9\u05dc\u05dd",
  statusCancelled: "\u05d1\u05d5\u05d8\u05dc",
  basePrice: "\u05de\u05d7\u05d9\u05e8 \u05d1\u05e1\u05d9\u05e1",
  projectManager: "\u05de\u05e0\u05d4\u05dc \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  unassigned: "\u05dc\u05dc\u05d0 \u05e9\u05d9\u05d5\u05da",
  startDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05d4\u05ea\u05d7\u05dc\u05d4",
  endDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05e1\u05d9\u05d5\u05dd",
  notes: "\u05d4\u05e2\u05e8\u05d5\u05ea",
  saveProject: "\u05e9\u05de\u05d9\u05e8\u05ea \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  projectRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05dc\u05e7\u05d5\u05d7 \u05d5\u05dc\u05de\u05dc\u05d0 \u05e9\u05dd \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8.",
  projectCreateFailed: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e0\u05db\u05e9\u05dc\u05d4.",
  projectSaved: "\u05d4\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e0\u05e9\u05de\u05e8",
  taskNew: "\u05de\u05e9\u05d9\u05de\u05d4 \u05d7\u05d3\u05e9\u05d4",
  taskQuickAssign:
    "\u05e9\u05d9\u05d5\u05da \u05de\u05d4\u05d9\u05e8 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e7\u05d9\u05d9\u05dd",
  taskDialogDescription:
    "\u05e4\u05ea\u05d9\u05d7\u05d4 \u05de\u05d4\u05d9\u05e8\u05d4 \u05e9\u05dc \u05de\u05e9\u05d9\u05de\u05d4 \u05d5\u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8 \u05e7\u05d9\u05d9\u05dd.",
  project: "\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  subject: "\u05e0\u05d5\u05e9\u05d0",
  dueDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05d9\u05e2\u05d3",
  assignee: "\u05d0\u05d7\u05e8\u05d0\u05d9",
  selectAssignee: "\u05d1\u05d7\u05e8\u05d5 \u05d0\u05d7\u05e8\u05d0\u05d9",
  saveTask: "\u05e9\u05de\u05d9\u05e8\u05ea \u05de\u05e9\u05d9\u05de\u05d4",
  taskRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05d0\u05d7\u05e8\u05d0\u05d9, \u05ea\u05d0\u05e8\u05d9\u05da \u05d9\u05e2\u05d3 \u05d5\u05e0\u05d5\u05e9\u05d0.",
  taskCreateFailed: "\u05d9\u05e6\u05d9\u05e8\u05ea \u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  taskSaved: "\u05d4\u05de\u05e9\u05d9\u05de\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  financial: "\u05e4\u05d9\u05e0\u05e0\u05e1\u05d9\u05dd",
  financialOpen:
    "\u05de\u05e2\u05d1\u05e8 \u05dc\u05de\u05e1\u05da \u05d4\u05db\u05e1\u05e4\u05d9\u05dd \u05d4\u05de\u05dc\u05d0",
  expenseNew: "\u05d4\u05d5\u05e6\u05d0\u05d4 \u05d7\u05d3\u05e9\u05d4",
  expenseQuickRegister: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  expenseDialogDescription:
    "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05d5\u05e9\u05d9\u05d5\u05da \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8.",
  amount: "\u05e1\u05db\u05d5\u05dd",
  date: "\u05ea\u05d0\u05e8\u05d9\u05da",
  category: "\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4",
  selectCategory: "\u05d1\u05d7\u05e8\u05d5 \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4",
  otherCategoryPrompt: "\u05de\u05d4 \u05d4\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4?",
  description: "\u05ea\u05d9\u05d0\u05d5\u05e8",
  includedInBase: "\u05e0\u05db\u05dc\u05dc \u05d1\u05d1\u05e1\u05d9\u05e1",
  billedToCustomer: "\u05dc\u05d7\u05d9\u05d5\u05d1 \u05dc\u05e7\u05d5\u05d7",
  includesVat: "\u05db\u05d5\u05dc\u05dc \u05de\u05e2\u05f4\u05de 18%",
  saveExpense: "\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05d5\u05e6\u05d0\u05d4",
  expenseRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4 \u05d5\u05ea\u05d0\u05e8\u05d9\u05da.",
  expenseInvalidAmount: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e1\u05db\u05d5\u05dd \u05d4\u05d5\u05e6\u05d0\u05d4 \u05ea\u05e7\u05d9\u05df.",
  expenseCreateFailed: "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  expenseSaved: "\u05d4\u05d4\u05d5\u05e6\u05d0\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
  incomeNew: "\u05d4\u05db\u05e0\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4",
  incomeQuickRegister: "\u05e8\u05d9\u05e9\u05d5\u05dd \u05ea\u05e9\u05dc\u05d5\u05dd \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8",
  incomeDialogDescription:
    "\u05e8\u05d9\u05e9\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05db\u05ea\u05e9\u05dc\u05d5\u05dd \u05dc\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8.",
  paymentMethod: "\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd",
  paymentDueDate: "\u05ea\u05d0\u05e8\u05d9\u05da \u05e4\u05d9\u05e8\u05e2\u05d5\u05df",
  bankTransfer: "\u05d4\u05e2\u05d1\u05e8\u05d4 \u05d1\u05e0\u05e7\u05d0\u05d9\u05ea",
  cash: "\u05de\u05d6\u05d5\u05de\u05df",
  check: "\u05e6'\u05e7",
  creditCard: "\u05db\u05e8\u05d8\u05d9\u05e1 \u05d0\u05e9\u05e8\u05d0\u05d9",
  other: "\u05d0\u05d7\u05e8",
  reference: "\u05d0\u05e1\u05de\u05db\u05ea\u05d0",
  saveIncome: "\u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05db\u05e0\u05e1\u05d4",
  incomeRequired:
    "\u05d9\u05e9 \u05dc\u05d1\u05d7\u05d5\u05e8 \u05e4\u05e8\u05d5\u05d9\u05e7\u05d8, \u05ea\u05d0\u05e8\u05d9\u05da \u05d5\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd.",
  incomeInvalidAmount: "\u05d9\u05e9 \u05dc\u05d4\u05d6\u05d9\u05df \u05e1\u05db\u05d5\u05dd \u05d4\u05db\u05e0\u05e1\u05d4 \u05ea\u05e7\u05d9\u05df.",
  incomeCreateFailed: "\u05d4\u05d5\u05e1\u05e4\u05ea \u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4.",
  incomeSaved: "\u05d4\u05d4\u05db\u05e0\u05e1\u05d4 \u05e0\u05e9\u05de\u05e8\u05d4",
} as const;

export default function DashboardActions({
  customers,
  products,
  projects,
  orders,
  properties,
  users,
  currentUserId,
}: {
  customers: Row[];
  products: Row[];
  projects: ProjectOption[];
  orders: EntityOption[];
  properties: EntityOption[];
  users: UserOption[];
  currentUserId?: string;
}) {
  const router = useRouter();
  void orders;
  void properties;

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
  const [expenseCategoryOther, setExpenseCategoryOther] = useState("");
  const [expenseDate, setExpenseDate] = useState(getTodayDate());
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [expenseIncludedInBase, setExpenseIncludedInBase] = useState(false);
  const [expenseBilledToCustomer, setExpenseBilledToCustomer] = useState(false);

  const [incomeSubmitting, setIncomeSubmitting] = useState(false);
  const [incomeError, setIncomeError] = useState<string | null>(null);
  const [incomeProjectId, setIncomeProjectId] = useState(projects[0]?.id ?? "");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeDate, setIncomeDate] = useState(getTodayDate());
  const [incomeMethod, setIncomeMethod] = useState("bank_transfer");
  const [incomeDueDate, setIncomeDueDate] = useState("");
  const [incomeRequiresSplit, setIncomeRequiresSplit] = useState(false);
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
    setExpenseCategoryOther("");
    setExpenseDate(getTodayDate());
    setExpenseDescription("");
    setExpenseNotes("");
    setExpenseIncludedInBase(false);
    setExpenseBilledToCustomer(false);
  }

  function resetIncomeForm() {
    setIncomeError(null);
    setIncomeProjectId(projects[0]?.id ?? "");
    setIncomeAmount("");
    setIncomeDate(getTodayDate());
    setIncomeMethod("bank_transfer");
    setIncomeDueDate("");
    setIncomeRequiresSplit(false);
    setIncomeReference("");
    setIncomeNotes("");
  }

  async function createProject() {
    setProjectError(null);
    if (!projectName.trim() || !projectCustomerId) {
      setProjectError(HEBREW.projectRequired);
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
        setProjectError(json.error ?? HEBREW.projectCreateFailed);
        return;
      }

      setProjectOpen(false);
      resetProjectForm();
      router.refresh();
      toast.success(HEBREW.projectSaved);
    } catch (error: unknown) {
      setProjectError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setProjectSubmitting(false);
    }
  }

  async function createTask() {
    setTaskError(null);
    const selectedProject = projectById.get(taskProjectId);
    if (!selectedProject || !taskSubject.trim() || !taskAssignedUserId || !taskDueDate) {
      setTaskError(HEBREW.taskRequired);
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
        setTaskError(json.error ?? HEBREW.taskCreateFailed);
        return;
      }

      setTaskOpen(false);
      resetTaskForm();
      router.refresh();
      toast.success(HEBREW.taskSaved);
    } catch (error: unknown) {
      setTaskError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function createExpense() {
    setExpenseError(null);
    const finalExpenseCategory =
      expenseCategory === OTHER_EXPENSE_CATEGORY ? expenseCategoryOther.trim() : expenseCategory.trim();
    if (!expenseProjectId || !finalExpenseCategory || !expenseDate) {
      setExpenseError(HEBREW.expenseRequired);
      return;
    }

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setExpenseError(HEBREW.expenseInvalidAmount);
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
          category: finalExpenseCategory,
          expense_date: expenseDate,
          description: expenseDescription.trim() || null,
          notes: expenseNotes.trim() || null,
          included_in_base_price: expenseIncludedInBase,
          billed_to_customer: expenseBilledToCustomer,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; expense?: Row };
      if (!res.ok || !json.expense) {
        setExpenseError(json.error ?? HEBREW.expenseCreateFailed);
        return;
      }

      setExpenseOpen(false);
      resetExpenseForm();
      router.refresh();
      toast.success(HEBREW.expenseSaved);
    } catch (error: unknown) {
      setExpenseError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
    } finally {
      setExpenseSubmitting(false);
    }
  }

  async function createIncome() {
    setIncomeError(null);
    if (!incomeProjectId || !incomeDate || !incomeMethod.trim()) {
      setIncomeError(HEBREW.incomeRequired);
      return;
    }
    if (incomeMethod === "check" && !incomeDueDate) {
      setIncomeError(`${HEBREW.incomeRequired} (${HEBREW.paymentDueDate})`);
      return;
    }

    const amount = Number(incomeAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setIncomeError(HEBREW.incomeInvalidAmount);
      return;
    }

    setIncomeSubmitting(true);
    try {
      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_domain: mapProjectTypeToExpenseDomain(projectById.get(incomeProjectId)?.type ?? null),
          project_id: incomeProjectId,
          amount_total: amount,
          payment_date: incomeDate,
          due_date: incomeMethod === "check" ? incomeDueDate : null,
          requires_split: incomeRequiresSplit,
          payment_method: incomeMethod,
          reference_number: incomeReference.trim() || null,
          notes: incomeNotes.trim() || null,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { error?: string; payment?: Row };
      if (!res.ok || !json.payment) {
        setIncomeError(json.error ?? HEBREW.incomeCreateFailed);
        return;
      }

      setIncomeOpen(false);
      resetIncomeForm();
      router.refresh();
      toast.success(HEBREW.incomeSaved);
    } catch (error: unknown) {
      setIncomeError(error instanceof Error ? error.message : HEBREW.saveErrorUnknown);
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
            <span className="font-semibold">{HEBREW.orderNew}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.orderQuickOpen}</span>
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
            <span className="font-semibold">{HEBREW.projectNew}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.projectQuickCreate}</span>
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
            <span className="font-semibold">{HEBREW.taskNew}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.taskQuickAssign}</span>
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
            <span className="font-semibold">{HEBREW.financial}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.financialOpen}</span>
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
            <span className="font-semibold">{HEBREW.expenseNew}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.expenseQuickRegister}</span>
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
            <span className="font-semibold">{HEBREW.incomeNew}</span>
            <span className="text-xs text-muted-foreground">{HEBREW.incomeQuickRegister}</span>
          </span>
        </Button>
      </AdaptiveGrid>

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <AdaptiveDialog size="newOrder">
          <DialogHeader>
            <DialogTitle>{HEBREW.orderNew}</DialogTitle>
            <DialogDescription>{HEBREW.orderDialogDescription}</DialogDescription>
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
              toast.success(HEBREW.orderSaved);
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
            <DialogTitle>{HEBREW.projectNew}</DialogTitle>
            <DialogDescription>{HEBREW.projectDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={projectSubmitting} className="contents">
            <AdaptiveGrid variant="formTwoLoose">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectName}</span>
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.customer}</span>
                <select
                  className={fieldClass}
                  value={projectCustomerId}
                  onChange={(e) => setProjectCustomerId(e.target.value)}
                >
                  <option value="">{HEBREW.selectCustomer}</option>
                  {customers.map((customer) => {
                    const id = getString(customer, "id");
                    const name =
                      getString(customer, "name") ||
                      getString(customer, "name_for_invoice") ||
                      HEBREW.customerFallback;
                    return (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectType}</span>
                <select
                  className={fieldClass}
                  value={projectType}
                  onChange={(e) => setProjectType(e.target.value)}
                >
                  <option value="logistics">{HEBREW.logistics}</option>
                  <option value="moving">{HEBREW.moving}</option>
                  <option value="renovation">{HEBREW.renovation}</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.status}</span>
                <select
                  className={fieldClass}
                  value={projectStatus}
                  onChange={(e) => setProjectStatus(e.target.value)}
                >
                  <option value="planned">{HEBREW.statusPlanned}</option>
                  <option value="active">{HEBREW.statusActive}</option>
                  <option value="on_hold">{HEBREW.statusOnHold}</option>
                  <option value="completed">{HEBREW.statusCompleted}</option>
                  <option value="cancelled">{HEBREW.statusCancelled}</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.basePrice}</span>
                <Input
                  type="number"
                  min="0"
                  value={projectPrice}
                  onChange={(e) => setProjectPrice(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.projectManager}</span>
                <select
                  className={fieldClass}
                  value={projectManagerId}
                  onChange={(e) => setProjectManagerId(e.target.value)}
                >
                  <option value="">{HEBREW.unassigned}</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.startDate}</span>
                <Input
                  type="date"
                  value={projectStartDate}
                  onChange={(e) => setProjectStartDate(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.endDate}</span>
                <Input
                  type="date"
                  value={projectEndDate}
                  onChange={(e) => setProjectEndDate(e.target.value)}
                />
              </label>

              <label className="space-y-2 text-sm col-span-full">
                <span>{HEBREW.notes}</span>
                <Textarea value={projectNotes} onChange={(e) => setProjectNotes(e.target.value)} />
              </label>
            </AdaptiveGrid>
          </fieldset>

          {projectError ? <p className="text-sm text-destructive">{projectError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setProjectOpen(false)} disabled={projectSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createProject()} disabled={projectSubmitting}>
              {projectSubmitting ? HEBREW.saving : HEBREW.saveProject}
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
            <DialogTitle>{HEBREW.taskNew}</DialogTitle>
            <DialogDescription>{HEBREW.taskDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={taskSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.project}</span>
                <select
                  className={fieldClass}
                  value={taskProjectId}
                  onChange={(e) => setTaskProjectId(e.target.value)}
                >
                  <option value="">{HEBREW.selectProject}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} | {project.customerName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.subject}</span>
                <Input value={taskSubject} onChange={(e) => setTaskSubject(e.target.value)} />
              </label>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.dueDate}</span>
                  <Input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.assignee}</span>
                  <select
                    className={fieldClass}
                    value={taskAssignedUserId}
                    onChange={(e) => setTaskAssignedUserId(e.target.value)}
                  >
                    <option value="">{HEBREW.selectAssignee}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.label}
                      </option>
                    ))}
                  </select>
                </label>
              </AdaptiveGrid>
            </div>
          </fieldset>

          {taskError ? <p className="text-sm text-destructive">{taskError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setTaskOpen(false)} disabled={taskSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createTask()} disabled={taskSubmitting}>
              {taskSubmitting ? HEBREW.saving : HEBREW.saveTask}
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
            <DialogTitle>{HEBREW.expenseNew}</DialogTitle>
            <DialogDescription>{HEBREW.expenseDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={expenseSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.project}</span>
                <select
                  className={fieldClass}
                  value={expenseProjectId}
                  onChange={(e) => setExpenseProjectId(e.target.value)}
                >
                  <option value="">{HEBREW.selectProject}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} | {project.customerName}
                    </option>
                  ))}
                </select>
              </label>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.amount}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.date}</span>
                  <Input
                    type="date"
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                  />
                </label>
              </AdaptiveGrid>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.category}</span>
                <select
                  className={fieldClass}
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                >
                  <option value="">{HEBREW.selectCategory}</option>
                  {DASHBOARD_EXPENSE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              {expenseCategory === OTHER_EXPENSE_CATEGORY ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.otherCategoryPrompt}</span>
                  <Input
                    value={expenseCategoryOther}
                    onChange={(e) => setExpenseCategoryOther(e.target.value)}
                  />
                </label>
              ) : null}

              <label className="space-y-2 text-sm">
                <span>{HEBREW.description}</span>
                <Input
                  value={expenseDescription}
                  onChange={(e) => setExpenseDescription(e.target.value)}
                />
              </label>

              <div className="flex flex-col gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={expenseIncludedInBase}
                    onChange={(e) => setExpenseIncludedInBase(e.target.checked)}
                  />
                  <span>{HEBREW.includedInBase}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={expenseBilledToCustomer}
                    onChange={(e) => setExpenseBilledToCustomer(e.target.checked)}
                  />
                  <span>{HEBREW.billedToCustomer}</span>
                </label>
              </div>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.notes}</span>
                <Textarea value={expenseNotes} onChange={(e) => setExpenseNotes(e.target.value)} />
              </label>
            </div>
          </fieldset>

          {expenseError ? <p className="text-sm text-destructive">{expenseError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setExpenseOpen(false)} disabled={expenseSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createExpense()} disabled={expenseSubmitting}>
              {expenseSubmitting ? HEBREW.saving : HEBREW.saveExpense}
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
            <DialogTitle>{HEBREW.incomeNew}</DialogTitle>
            <DialogDescription>{HEBREW.incomeDialogDescription}</DialogDescription>
          </DialogHeader>

          <fieldset disabled={incomeSubmitting} className="contents">
            <div className="grid gap-4">
              <label className="space-y-2 text-sm">
                <span>{HEBREW.project}</span>
                <select
                  className={fieldClass}
                  value={incomeProjectId}
                  onChange={(e) => setIncomeProjectId(e.target.value)}
                >
                  <option value="">{HEBREW.selectProject}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name} | {project.customerName}
                    </option>
                  ))}
                </select>
              </label>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.amount}</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={incomeAmount}
                    onChange={(e) => setIncomeAmount(e.target.value)}
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span>{HEBREW.date}</span>
                  <Input
                    type="date"
                    value={incomeDate}
                    onChange={(e) => setIncomeDate(e.target.value)}
                  />
                </label>
              </AdaptiveGrid>

              <AdaptiveGrid variant="formTwoLoose">
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.paymentMethod}</span>
                  <select
                    className={fieldClass}
                    value={incomeMethod}
                    onChange={(e) => setIncomeMethod(e.target.value)}
                  >
                    <option value="bank_transfer">{HEBREW.bankTransfer}</option>
                    <option value="cash">{HEBREW.cash}</option>
                    <option value="check">{HEBREW.check}</option>
                    <option value="credit_card">{HEBREW.creditCard}</option>
                    <option value="other">{HEBREW.other}</option>
                  </select>
                  {incomeMethod === "check" ? (
                    <span className="block text-xs text-muted-foreground">
                      {"צ'ק יירשם כממתין לפירעון עד תאריך הפירעון."}
                    </span>
                  ) : null}
                </label>

                <label className="space-y-2 text-sm">
                  <span>{incomeMethod === "check" ? HEBREW.paymentDueDate : HEBREW.reference}</span>
                  {incomeMethod === "check" ? (
                    <Input
                      type="date"
                      value={incomeDueDate}
                      onChange={(e) => setIncomeDueDate(e.target.value)}
                    />
                  ) : (
                    <Input
                      value={incomeReference}
                      onChange={(e) => setIncomeReference(e.target.value)}
                    />
                  )}
                </label>
              </AdaptiveGrid>

              {incomeMethod === "check" ? (
                <label className="space-y-2 text-sm">
                  <span>{HEBREW.reference}</span>
                  <Input
                    value={incomeReference}
                    onChange={(e) => setIncomeReference(e.target.value)}
                  />
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={incomeRequiresSplit}
                  onChange={(e) => setIncomeRequiresSplit(e.target.checked)}
                />
                <span>{HEBREW.includesVat}</span>
              </label>

              <label className="space-y-2 text-sm">
                <span>{HEBREW.notes}</span>
                <Textarea value={incomeNotes} onChange={(e) => setIncomeNotes(e.target.value)} />
              </label>
            </div>
          </fieldset>

          {incomeError ? <p className="text-sm text-destructive">{incomeError}</p> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setIncomeOpen(false)} disabled={incomeSubmitting}>
              {HEBREW.cancel}
            </Button>
            <Button type="button" onClick={() => void createIncome()} disabled={incomeSubmitting}>
              {incomeSubmitting ? HEBREW.saving : HEBREW.saveIncome}
            </Button>
          </div>
        </AdaptiveDialog>
      </Dialog>
    </>
  );
}
