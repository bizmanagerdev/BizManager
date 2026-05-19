"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clearDraft, loadDraft, offlineFetch, saveDraft } from "@/lib/offline-queue";
import { FileText, MessageCircle, Pencil, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { paymentStatusClasses } from "@/lib/orders/paymentStatus";
import {
  AdaptiveDialog,
  AdaptiveGrid,
  AdaptiveStack,
  PageStack,
} from "@/components/layout/page-layout";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileUploadActions } from "@/components/ui/file-upload-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DeleteProjectButton from "@/app/projects/DeleteProjectButton";
import { getProjectStatusLabel } from "@/lib/ui/status-colors";

type ProjectRow = Record<string, unknown>;
type Option = { id: string; label: string; phone?: string | null; email?: string | null };
type SortMode = "recent" | "start_date" | "start_date_desc" | "profit_desc";
type ProjectsView = "projects" | "quotes" | "closed";
type ProjectMonthlySummary = {
  month: string;
  startDate: string;
  endDate: string;
  totalProjects: number;
  byType: Array<{ type: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
  totals: {
    charged: number;
    paid: number;
    expenses: number;
    profit: number;
    basePrice: number;
    billedExtras: number;
    workerOwed: number;
  };
  quotes: {
    count: number;
    charged: number;
  };
};
type ContactDraft = {
  full_name: string;
  role: string;
  phone: string;
  email: string;
  whatsapp: string;
  notes: string;
  is_primary: boolean;
  active: boolean;
};

const defaultStatusOptions = ["quote", "planned", "active", "on_hold", "completed", "cancelled"];
const defaultProjectTypeOptions = ["logistics", "moving", "construction"];
const cityOptions = [
  "ירושלים",
  "בני ברק",
  "אלעד",
  "ביתר עילית",
  "מודיעין עילית",
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

function getStringArray(row: ProjectRow, key: string) {
  const value = row[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMovingProjectType(value: string) {
  return value === "moving";
}

function itemsToMoveToText(items: string[] | null | undefined) {
  return (items ?? []).join("\n");
}

function textToItemsToMove(value: string) {
  const items = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

async function uploadProjectDocument(projectId: string, file: File) {
  const form = new FormData();
  form.set("project_id", projectId);
  form.set("file", file);
  form.set("category", file.type.startsWith("image/") ? "project_photo" : "project_document");

  const res = await fetch("/api/projects/documents/upload", {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "העלאת הקובץ נכשלה.");
  }
}

function formatIls(amount: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function getDateValue(row: ProjectRow, key: string) {
  const value = getString(row, key);
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
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
  return status === "unknown" ? "לא ידוע" : getProjectStatusLabel(status);
}

function projectTypeLabel(value: string) {
  switch (value) {
    case "logistics":
      return "לוגיסטיקה";
    case "moving":
      return "הובלה";
    case "construction":
      return "שיפוצים";
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

function actualPriceValue(row: ProjectRow) {
  return getNumber(row, "actual_price") ?? getNumber(row, "agreed_base_price");
}

function normalizeProjectsView(value: string | null): ProjectsView {
  return value === "quotes" || value === "closed" ? value : "projects";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function paymentStatusValue(row: ProjectRow) {
  const value = getString(row, "payment_status_list");
  if (value === "paid" || value === "partial" || value === "unpaid" || value === "unpriced") {
    return value;
  }

  const paidTotal = getNumber(row, "paid_total") ?? 0;
  const amountDue = getNumber(row, "amount_due");
  const customerTotalPrice = getNumber(row, "customer_total_price");
  const actualPrice = getNumber(row, "actual_price");
  const agreedBasePrice = getNumber(row, "agreed_base_price");
  const expensesBilled = getNumber(row, "expenses_billed") ?? 0;
  const baseProjectPrice = agreedBasePrice ?? actualPrice ?? 0;
  const derivedCustomerTotalPrice = baseProjectPrice + expensesBilled;
  const dueBase =
    derivedCustomerTotalPrice > 0 ? derivedCustomerTotalPrice : customerTotalPrice ?? 0;
  const effectiveAmountDue = amountDue ?? dueBase;

  if (baseProjectPrice <= 0) return "unpriced";
  if (effectiveAmountDue <= 0 || paidTotal >= effectiveAmountDue) return "paid";
  if (paidTotal > 0) return "partial";
  return "unpaid";
}

function paymentStatusLabel(status: "paid" | "partial" | "unpaid" | "unpriced") {
  switch (status) {
    case "paid":
      return "שולם";
    case "partial":
      return "שולם חלקית";
    case "unpaid":
      return "לא שולם";
    case "unpriced":
      return "לא סוכם תשלום";
  }
}

function paymentStatusBadgeClasses(status: "paid" | "partial" | "unpaid" | "unpriced") {
  switch (status) {
    case "paid":
      return paymentStatusClasses("paid");
    case "partial":
      return paymentStatusClasses("partial");
    case "unpaid":
      return paymentStatusClasses("unpaid");
    case "unpriced":
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthIso() {
  return new Date().toISOString().slice(0, 7);
}

function oneMonthFrom(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultSortForTab(tab: ProjectsView): SortMode {
  return tab === "closed" ? "start_date_desc" : "start_date";
}

function defaultEndDateForProjectType(projectType: string, startDate: string) {
  if (isMovingProjectType(projectType)) return startDate;
  return oneMonthFrom(startDate);
}

function makeEmptyContactDraft(): ContactDraft {
  return {
    full_name: "",
    role: "",
    phone: "",
    email: "",
    whatsapp: "",
    notes: "",
    is_primary: false,
    active: true,
  };
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
  const [activeTab, setActiveTab] = useState<ProjectsView>(() =>
    normalizeProjectsView(searchParams.get("view"))
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>(defaultSortForTab("projects"));
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [monthlySummaryOpen, setMonthlySummaryOpen] = useState(false);
  const [monthlySummaryMonth, setMonthlySummaryMonth] = useState(currentMonthIso());
  const [monthlySummaryLoading, setMonthlySummaryLoading] = useState(false);
  const [monthlySummaryError, setMonthlySummaryError] = useState<string | null>(null);
  const [monthlySummary, setMonthlySummary] = useState<ProjectMonthlySummary | null>(null);

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
  const [createEndDate, setCreateEndDate] = useState(
    defaultEndDateForProjectType(defaultProjectTypeOptions[0] ?? "", todayIso())
  );
  const [createNotes, setCreateNotes] = useState("");
  const [createItemsToMove, setCreateItemsToMove] = useState("");
  const [createAttachmentFiles, setCreateAttachmentFiles] = useState<File[]>([]);

  const [customerOptionsState, setCustomerOptionsState] = useState<Option[]>(customerOptions);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createCustomerName, setCreateCustomerName] = useState("");
  const [createCustomerPhone, setCreateCustomerPhone] = useState("");
  const [createCustomerWhatsapp, setCreateCustomerWhatsapp] = useState("");
  const [createCustomerEmail, setCreateCustomerEmail] = useState("");
  const [createCustomerNameForInvoice, setCreateCustomerNameForInvoice] = useState("");
  const [createCustomerRegNumber, setCreateCustomerRegNumber] = useState("");
  const [createCustomerCity, setCreateCustomerCity] = useState("");
  const [createCustomerCityOther, setCreateCustomerCityOther] = useState("");
  const [createCustomerAddress, setCreateCustomerAddress] = useState("");
  const [createCustomerNotes, setCreateCustomerNotes] = useState("");
  const [createCustomerContacts, setCreateCustomerContacts] = useState<ContactDraft[]>([]);
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
  const [editItemsToMove, setEditItemsToMove] = useState("");
  const [approveQuoteOpen, setApproveQuoteOpen] = useState(false);
  const [approveQuoteSubmitting, setApproveQuoteSubmitting] = useState(false);
  const [approveQuoteError, setApproveQuoteError] = useState<string | null>(null);
  const [approveQuoteId, setApproveQuoteId] = useState("");
  const [approveQuoteName, setApproveQuoteName] = useState("");
  const [approveQuotePrice, setApproveQuotePrice] = useState("");

  function removeProject(id: string) {
    setProjects((prev) =>
      prev.filter((row) => {
        const rowId = getString(row, "id") ?? "";
        return rowId !== id;
      })
    );
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list =
      activeTab === "quotes"
        ? projects.filter((row) => statusValue(row) === "quote")
        : activeTab === "closed"
          ? projects.filter((row) => statusValue(row) === "completed")
          : projects.filter((row) => !["quote", "completed"].includes(statusValue(row)));

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
    } else if (sort === "start_date_desc") {
      list = [...list].sort((a, b) => getDateValue(b, "start_date") - getDateValue(a, "start_date"));
    } else if (sort === "start_date") {
      list = [...list].sort((a, b) => getDateValue(a, "start_date") - getDateValue(b, "start_date"));
    }

    return list;
  }, [activeTab, projects, query, sort, status]);

  const projectCount = useMemo(
    () => projects.filter((row) => !["quote", "completed"].includes(statusValue(row))).length,
    [projects]
  );
  const quoteCount = useMemo(
    () => projects.filter((row) => statusValue(row) === "quote").length,
    [projects]
  );
  const closedCount = useMemo(
    () => projects.filter((row) => statusValue(row) === "completed").length,
    [projects]
  );

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    projects
      .filter((row) =>
        activeTab === "quotes"
          ? statusValue(row) === "quote"
          : activeTab === "closed"
            ? statusValue(row) === "completed"
            : !["quote", "completed"].includes(statusValue(row))
      )
      .forEach((row) => set.add(statusValue(row)));
    defaultStatusOptions.forEach((value) => set.add(value));
    const filtered = Array.from(set).filter((value) =>
      activeTab === "quotes"
        ? value === "quote"
        : activeTab === "closed"
          ? value === "completed"
          : !["quote", "completed"].includes(value)
    );
    return filtered.sort();
  }, [activeTab, projects]);
  const hasImplicitTabStatus =
    (activeTab === "quotes" && status === "quote") ||
    (activeTab === "closed" && status === "completed");
  const hasActiveToolbarFilters =
    query.trim().length > 0 || (!hasImplicitTabStatus && status !== "all") || sort !== defaultSortForTab(activeTab);
  const activeFilterSummary = [
    query.trim() ? `חיפוש: ${query.trim()}` : null,
    !hasImplicitTabStatus && status !== "all" ? `סטטוס: ${statusLabel(status)}` : null,
    sort !== defaultSortForTab(activeTab)
      ? `מיון: ${
          sort === "recent"
            ? "אחרונים"
            : sort === "start_date"
              ? "תאריך התחלה - ישן לחדש"
              : sort === "start_date_desc"
                ? "תאריך התחלה - חדש לישן"
                : "רווח (גבוה לנמוך)"
        }`
      : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  const projectTypeOptions = useMemo(() => {
    return defaultProjectTypeOptions;
  }, []);

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
    const nextView = normalizeProjectsView(searchParams.get("view"));
    setActiveTab((current) => (current === nextView ? current : nextView));
  }, [searchParams]);

  useEffect(() => {
    if (activeTab === "quotes") {
      setStatus("quote");
      setSort(defaultSortForTab(activeTab));
      return;
    }
    if (activeTab === "closed") {
      setStatus("completed");
      setSort(defaultSortForTab(activeTab));
      return;
    }
    setSort(defaultSortForTab(activeTab));
    setStatus((current) => (current === "quote" || current === "completed" ? "all" : current));
  }, [activeTab]);

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = normalizeProjectsView(value);
      setActiveTab(nextTab);
      const params = new URLSearchParams(searchParams.toString());
      if (nextTab === "projects") {
        params.delete("view");
      } else {
        params.set("view", nextTab);
      }
      const queryString = params.toString();
      router.replace(queryString ? `/projects?${queryString}` : "/projects", { scroll: false });
    },
    [router, searchParams]
  );

  function defaultCreateStatusForTab(tab: ProjectsView) {
    return tab === "quotes" ? "quote" : "planned";
  }

  function resetFilters() {
    setQuery("");
    setSort(defaultSortForTab(activeTab));
    setStatus(activeTab === "quotes" ? "quote" : activeTab === "closed" ? "completed" : "all");
  }

  const openCreateDialog = useCallback((nextTab: ProjectsView = activeTab) => {
    setCreateError(null);
    setCreateStatus(defaultCreateStatusForTab(nextTab));
    setCreateOpen(true);
  }, [activeTab]);

  useEffect(() => {
    if (prefillHandled.current) return;

    const prefillCustomerId = (searchParams.get("customer_id") ?? "").trim();
    const shouldOpenCreate = (searchParams.get("create") ?? "").trim() === "1";

    if (prefillCustomerId && shouldOpenCreate) {
      const matched = customerOptionsState.find((row) => row.id === prefillCustomerId) ?? null;
      setCreateCustomerId(prefillCustomerId);
      setCreateCustomerQuery(matched?.label ?? "");
      openCreateDialog(activeTab);
    } else if (shouldOpenCreate) {
      openCreateDialog(activeTab);
    }

    prefillHandled.current = true;
  }, [activeTab, customerOptionsState, openCreateDialog, searchParams]);

  // Restore project create draft on mount (survives tab kills on mobile)
  useEffect(() => {
    const draft = loadDraft<{
      createName: string; createProjectType: string; createStatus: string;
      createAgreedBasePrice: string; createExpensesSeparately: boolean;
      createStartDate: string; createEndDate: string; createNotes: string;
      createItemsToMove: string; createProjectManagerId: string;
    }>("project-create");
    if (!draft) return;
    if (draft.createName) setCreateName(draft.createName);
    if (draft.createProjectType) setCreateProjectType(draft.createProjectType);
    if (draft.createStatus) setCreateStatus(draft.createStatus);
    if (draft.createAgreedBasePrice) setCreateAgreedBasePrice(draft.createAgreedBasePrice);
    if (draft.createExpensesSeparately !== undefined) setCreateExpensesSeparately(draft.createExpensesSeparately);
    if (draft.createStartDate) setCreateStartDate(draft.createStartDate);
    if (draft.createEndDate) setCreateEndDate(draft.createEndDate);
    if (draft.createNotes) setCreateNotes(draft.createNotes);
    if (draft.createItemsToMove) setCreateItemsToMove(draft.createItemsToMove);
    if (draft.createProjectManagerId) setCreateProjectManagerId(draft.createProjectManagerId);
  }, []);

  // Auto-save project create draft while dialog is open
  useEffect(() => {
    if (!createOpen) return;
    saveDraft("project-create", {
      createName, createProjectType, createStatus, createAgreedBasePrice,
      createExpensesSeparately, createStartDate, createEndDate, createNotes,
      createItemsToMove, createProjectManagerId,
    });
  }, [createOpen, createName, createProjectType, createStatus, createAgreedBasePrice,
      createExpensesSeparately, createStartDate, createEndDate, createNotes,
      createItemsToMove, createProjectManagerId]);

  function resetCreateCustomerForm() {
    setCreateCustomerName("");
    setCreateCustomerPhone("");
    setCreateCustomerWhatsapp("");
    setCreateCustomerEmail("");
    setCreateCustomerNameForInvoice("");
    setCreateCustomerRegNumber("");
    setCreateCustomerCity("");
    setCreateCustomerCityOther("");
    setCreateCustomerAddress("");
    setCreateCustomerNotes("");
    setCreateCustomerContacts([]);
  }

  function addCreateCustomerContact() {
    setCreateCustomerContacts((prev) => {
      const hasPrimary = prev.some((contact) => contact.is_primary);
      return [
        ...prev,
        {
          ...makeEmptyContactDraft(),
          is_primary: prev.length === 0 || !hasPrimary,
        },
      ];
    });
  }

  function updateCreateCustomerContact(index: number, patch: Partial<ContactDraft>) {
    setCreateCustomerContacts((prev) =>
      prev.map((contact, currentIndex) => {
        if (currentIndex !== index) {
          if (patch.is_primary) return { ...contact, is_primary: false };
          return contact;
        }
        const next = { ...contact, ...patch };
        if (patch.active === false) next.is_primary = false;
        return next;
      })
    );
  }

  function removeCreateCustomerContact(index: number) {
    setCreateCustomerContacts((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0 || next.some((contact) => contact.is_primary)) return next;
      return next.map((contact, currentIndex) =>
        currentIndex === 0 ? { ...contact, is_primary: true } : contact
      );
    });
  }

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
    if (!createCustomerPhone.trim()) {
      setCreateCustomerError("יש להזין מספר טלפון.");
      return;
    }
    if (!city) {
      setCreateCustomerError("יש לבחור עיר.");
      return;
    }

    const preparedContacts = createCustomerContacts
      .map((contact) => ({
        full_name: contact.full_name.trim(),
        role: contact.role.trim() || null,
        phone: contact.phone.trim() || null,
        email: contact.email.trim() || null,
        whatsapp: contact.whatsapp.trim() || null,
        notes: contact.notes.trim() || null,
        is_primary: contact.active ? contact.is_primary : false,
        active: contact.active,
      }))
      .filter(
        (contact) =>
          contact.full_name ||
          contact.role ||
          contact.phone ||
          contact.email ||
          contact.whatsapp ||
          contact.notes
      );
    const invalidContactIndex = preparedContacts.findIndex((contact) => !contact.full_name);
    if (invalidContactIndex >= 0) {
      setCreateCustomerError(`איש קשר ${invalidContactIndex + 1} חייב לכלול שם מלא.`);
      return;
    }
    const hasPrimaryContact = preparedContacts.some((contact) => contact.is_primary);
    const normalizedContacts = preparedContacts.map((contact, index) => ({
      ...contact,
      is_primary: hasPrimaryContact ? contact.is_primary : index === 0,
    }));

    setCreateCustomerSubmitting(true);
    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          name_for_invoice: createCustomerNameForInvoice.trim() || null,
          registration_number: createCustomerRegNumber.trim() || null,
          phone: createCustomerPhone.trim() || null,
          whatsapp: createCustomerWhatsapp.trim() || null,
          email: email || null,
          city,
          address: address || null,
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

      const customerId = getString(json.customer, "id") ?? "";

      for (const [index, contact] of normalizedContacts.entries()) {
        const contactRes = await fetch("/api/customer-contacts/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_id: customerId,
            ...contact,
          }),
        });

        const contactJson = (await contactRes.json().catch(() => ({}))) as {
          error?: string;
          contact?: ProjectRow;
        };

        if (!contactRes.ok || !contactJson.contact) {
          const detail = contact.full_name || `#${index + 1}`;
          if (typeof window !== "undefined") {
            window.alert(
              contactJson.error ?? `הלקוח נוצר, אבל איש הקשר ${detail} לא נוצר בהצלחה.`
            );
          }
          break;
        }
      }

      const newCustomer: Option = {
        id: customerId,
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
      resetCreateCustomerForm();
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
      const result = await offlineFetch("/api/projects/create", {
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
        items_to_move: textToItemsToMove(createItemsToMove),
      }, "פרויקט חדש");

      if (result.queued) {
        clearDraft("project-create");
        setCreateOpen(false);
        if (typeof window !== "undefined") window.alert("אין חיבור — הפרויקט ייווצר כשיחזור החיבור.");
        return;
      }
      if (!result.ok) {
        setCreateError(result.error ?? "יצירת הפרויקט נכשלה.");
        return;
      }
      const json = result.data as Partial<{ error: string; project: ProjectRow }>;

      if (json.project) {
        const createdProject = json.project as ProjectRow;
        const createdProjectId = getString(createdProject, "id");
        if (createdProjectId) {
          for (const file of createAttachmentFiles) {
            await uploadProjectDocument(createdProjectId, file);
          }
        }
        setProjects((prev) => [createdProject, ...prev]);
      }

      clearDraft("project-create");
      setCreateOpen(false);
      setCreateName("");
      setCreateCustomerId("");
      setCreateCustomerQuery("");
      setCustomerPickerOpen(false);
      setCreateProjectType(projectTypeOptions[0] ?? defaultProjectTypeOptions[0]);
      setCreateStatus(defaultCreateStatusForTab(activeTab));
      setCreateAgreedBasePrice("");
      setCreateExpensesSeparately(false);
      setCreateProjectManagerId(currentUserId ?? "");
      const now = todayIso();
      setCreateStartDate(now);
      setCreateEndDate(
        defaultEndDateForProjectType(projectTypeOptions[0] ?? defaultProjectTypeOptions[0] ?? "", now)
      );
      setCreateNotes("");
      setCreateItemsToMove("");
      setCreateAttachmentFiles([]);
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
    setEditItemsToMove(itemsToMoveToText(getStringArray(row, "items_to_move")));
    setEditOpen(true);
  }

  function openApproveQuote(row: ProjectRow) {
    setApproveQuoteError(null);
    setApproveQuoteId(getString(row, "id") ?? "");
    setApproveQuoteName(projectDisplayName(row));
    const currentPrice = getNumber(row, "agreed_base_price");
    setApproveQuotePrice(currentPrice !== null && currentPrice > 0 ? String(currentPrice) : "");
    setApproveQuoteOpen(true);
  }

  async function loadMonthlySummary() {
    if (monthlySummaryLoading) return;
    setMonthlySummaryError(null);
    setMonthlySummaryLoading(true);
    try {
      const res = await fetch("/api/projects/monthly-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month: monthlySummaryMonth }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      } & Partial<ProjectMonthlySummary>;
      if (!res.ok) {
        setMonthlySummaryError(json.error ?? "טעינת הסיכום נכשלה.");
        return;
      }
      setMonthlySummary(json as ProjectMonthlySummary);
    } catch (e: unknown) {
      setMonthlySummaryError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setMonthlySummaryLoading(false);
    }
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
          items_to_move: textToItemsToMove(editItemsToMove),
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

  async function approveQuote() {
    if (approveQuoteSubmitting) return;
    setApproveQuoteError(null);

    const agreed = approveQuotePrice.trim() ? Number(approveQuotePrice) : NaN;
    if (!approveQuoteId) {
      setApproveQuoteError("לא נבחרה הצעת מחיר.");
      return;
    }
    if (!Number.isFinite(agreed) || agreed <= 0) {
      setApproveQuoteError("יש להזין מחיר מוסכם גדול מ-0.");
      return;
    }

    setApproveQuoteSubmitting(true);
    try {
      const res = await fetch("/api/projects/approve-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: approveQuoteId,
          agreed_base_price: agreed,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as Partial<{
        error: string;
        project: ProjectRow;
      }>;

      if (!res.ok || !json.project) {
        setApproveQuoteError(json.error ?? "אישור הצעת המחיר נכשל.");
        return;
      }

      setProjects((prev) =>
        prev.map((row) => {
          const id = getString(row, "id") ?? "";
          return id === approveQuoteId ? (json.project as ProjectRow) : row;
        })
      );
      setApproveQuoteOpen(false);
      setApproveQuoteId("");
      setApproveQuoteName("");
      setApproveQuotePrice("");
      router.refresh();
    } catch (e: unknown) {
      setApproveQuoteError(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setApproveQuoteSubmitting(false);
    }
  }

  return (
    <PageStack>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="hidden items-center justify-center gap-3 md:flex">
          <TabsList className="flex w-fit max-w-full justify-center overflow-hidden">
            <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="quotes">
              הצעות ({quoteCount})
            </TabsTrigger>
            <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="projects">
              פרויקטים ({projectCount})
            </TabsTrigger>
            <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="closed">
              סגורים ({closedCount})
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsList className="mx-auto grid w-full grid-cols-3 justify-center overflow-hidden md:hidden">
          <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="quotes">
            הצעות ({quoteCount})
          </TabsTrigger>
          <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="projects">
            פרויקטים ({projectCount})
          </TabsTrigger>
          <TabsTrigger className="min-w-0 whitespace-normal px-3 text-center leading-tight" value="closed">
            סגורים ({closedCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-3 md:hidden">
        <Button type="button" className="h-11 w-full" onClick={() => openCreateDialog(activeTab)}>
          {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 justify-center gap-2"
            onClick={() => setMobileFiltersOpen((current) => !current)}
            aria-expanded={mobileFiltersOpen}
            aria-controls="projects-mobile-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {mobileFiltersOpen ? "הסתרת חיפוש וסינון" : "חיפוש וסינון"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setMonthlySummaryOpen(true);
              void loadMonthlySummary();
            }}
          >
            סיכום חודשי
          </Button>
        </div>

        {hasActiveToolbarFilters && !mobileFiltersOpen ? (
          <div className="rounded-xl border border-border/60 bg-card px-3 py-2 text-xs text-muted-foreground">
            {activeFilterSummary || "קיים חיפוש או סינון פעיל."}
          </div>
        ) : null}

        <div
          id="projects-mobile-filters"
          className={(
            `${mobileFiltersOpen ? "grid" : "hidden"} gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm`
          ).trim()}
        >
          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">חיפוש</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח או פרויקט..."
                className="h-11 pr-9"
              />
            </div>
          </div>

          <div className="min-w-0">
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

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              <option value="profit_desc">רווח (גבוה לנמוך)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="h-11" onClick={resetFilters}>
              איפוס מסננים
            </Button>
            <Button
              type="button"
              className="h-11"
              onClick={() => setMobileFiltersOpen(false)}
            >
              הצגת התוצאות
            </Button>
          </div>
        </div>
      </div>

      <AdaptiveStack
        variant="toolbar"
        className="hidden min-w-0 md:flex md:flex-col md:gap-4 xl:flex-row xl:items-end xl:justify-between xl:gap-6"
      >
        <AdaptiveGrid variant="projectsToolbarControls" className="min-w-0 lg:grid-cols-4">
          <div className="min-w-0 lg:col-span-2">
            <label className="text-sm text-muted-foreground">חיפוש</label>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי לקוח או פרויקט..."
                className="h-11 pr-9"
              />
            </div>
          </div>

          <div className="min-w-0">
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

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">מיון לפי</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה - ישן לחדש</option>
              <option value="start_date_desc">תאריך התחלה - חדש לישן</option>
              <option value="profit_desc">רווח (גבוה לנמוך)</option>
            </select>
          </div>

        </AdaptiveGrid>

        <div className="w-full xl:w-auto">
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:flex xl:w-auto">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full xl:w-auto"
              onClick={() => {
                setMonthlySummaryOpen(true);
                void loadMonthlySummary();
              }}
            >
              סיכום חודשי
            </Button>
            <Button type="button" className="h-11 w-full xl:w-auto" onClick={() => openCreateDialog(activeTab)}>
              {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
            </Button>
          </div>
        </div>
      </AdaptiveStack>

      <div className="text-sm text-muted-foreground">
        {activeTab === "quotes"
          ? `נמצאו ${rows.length} הצעות מחיר`
          : activeTab === "closed"
            ? `נמצאו ${rows.length} פרויקטים סגורים`
            : `נמצאו ${rows.length} פרויקטים`}
      </div>

      <Card className="hidden overflow-hidden border-border/70 shadow-sm xl:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="border-b border-border/70 text-right">
                <th className="px-4 py-3 font-medium">פרויקט</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">תאריך התחלה</th>
                <th className="px-4 py-3 font-medium">תשלום</th>
                <th className="px-4 py-3 font-medium">לקוח</th>
                <th className="px-4 py-3 font-medium">{activeTab === "quotes" ? "מחיר" : "מחיר / רווח"}</th>
                <th className="px-4 py-3 font-medium">משימות פתוחות</th>
                <th className="px-4 py-3 font-medium">{activeTab === "quotes" ? "אישור הצעה" : "מסמכים"}</th>
                <th className="px-4 py-3 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {rows.map((row) => {
                const id = getString(row, "id") ?? "";
                const profit = profitValue(row);
                const actualPrice = actualPriceValue(row);
                const currentStatus = statusValue(row);
                const openTasks = getNumber(row, "open_tasks");
                const paymentStatus = paymentStatusValue(row);
                const startDate = formatDate(getString(row, "start_date"));
                const detailHref = `/projects/${id}${activeTab === "projects" ? "" : `?view=${activeTab}`}`;

                return (
                  <tr key={`${id}-table`} className="align-top hover:bg-muted/20">
                    <td className="px-4 py-4">
                      <Link
                        href={detailHref}
                        prefetch
                        className="block min-w-[180px]"
                        onClick={() => emitNavigationStart()}
                      >
                        <div className="font-medium">{projectDisplayName(row)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">#{id.slice(0, 8)}</div>
                      </Link>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={currentStatus} type="project" />
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">{startDate}</td>
                    <td className="px-4 py-4">
                      <Badge className={paymentStatusBadgeClasses(paymentStatus)}>
                        {paymentStatusLabel(paymentStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">{clientDisplayName(row)}</td>
                    <td className="px-4 py-4">
                      {currentStatus === "quote" ? (
                        actualPrice === null ? "-" : formatIls(actualPrice)
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-xs text-muted-foreground">
                            מחיר: {actualPrice === null ? "-" : formatIls(actualPrice)}
                          </div>
                          <div className={profit !== null && profit < 0 ? "text-destructive" : ""}>
                            רווח: {profit === null ? "-" : formatIls(profit)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">{openTasks === null ? "-" : openTasks}</td>
                    <td className="px-4 py-4">
                      {currentStatus === "quote" ? (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="w-full min-w-[120px] xl:w-auto"
                          onClick={() => openApproveQuote(row)}
                        >
                          אישור הצעה
                        </Button>
                      ) : (
                        <div className="flex min-w-[100px] items-center gap-2">
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            aria-label="שליחת דף עבודה ב-WhatsApp"
                            title="שליחת דף עבודה ב-WhatsApp"
                          >
                            <Link
                              href={`/projects/${id}/export?mode=worker`}
                              prefetch
                              onClick={() => emitNavigationStart()}
                            >
                              <MessageCircle className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            asChild
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-xl"
                            aria-label="דף עבודה / שיתוף / הדפסה / הורדה"
                            title="דף עבודה / שיתוף / הדפסה / הורדה"
                          >
                            <Link
                              href={`/projects/${id}/export?mode=worker`}
                              prefetch
                              onClick={() => emitNavigationStart()}
                            >
                              <FileText className="h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[110px] items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-xl"
                          onClick={() => openEditProject(row)}
                          aria-label={currentStatus === "quote" ? "עריכת הצעת מחיר" : "עריכת פרויקט"}
                          title={currentStatus === "quote" ? "עריכת הצעת מחיר" : "עריכת פרויקט"}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          size="icon"
                          className="h-9 w-9 rounded-xl"
                          ariaLabel={currentStatus === "quote" ? "מחיקת הצעת מחיר" : "מחיקת פרויקט"}
                          onDeleted={() => removeProject(id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </DeleteProjectButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-2.5 xl:hidden">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const actualPrice = actualPriceValue(row);
          const currentStatus = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");
          const startDate = formatDate(getString(row, "start_date"));
          const detailHref = `/projects/${id}${activeTab === "projects" ? "" : `?view=${activeTab}`}`;

          return (
            <Card key={id} className="overflow-hidden border-border/70 shadow-sm transition-shadow hover:shadow-md">
              <CardContent className="p-4">
                <div className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-semibold">{projectDisplayName(row)}</div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">{clientDisplayName(row)}</div>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground">#{id.slice(0, 8)}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">תאריך התחלה</div>
                        <div className="mt-1 font-medium">{startDate}</div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">משימות פתוחות</div>
                        <div className="mt-1 font-medium">{openTasks === null ? "-" : openTasks}</div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">מחיר</div>
                        <div className="mt-1 font-medium">
                          {actualPrice === null ? "-" : formatIls(actualPrice)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/70 p-2.5">
                        <div className="text-xs text-muted-foreground">
                          {currentStatus === "quote" ? "סטטוס הצעה" : "רווח"}
                        </div>
                        <div className={`mt-1 font-medium ${profit !== null && profit < 0 ? "text-destructive" : ""}`}>
                          {currentStatus === "quote"
                            ? statusLabel(currentStatus)
                            : profit === null
                              ? "-"
                              : formatIls(profit)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild type="button" className="col-span-2 h-11 rounded-xl">
                      <Link href={detailHref} prefetch onClick={() => emitNavigationStart()}>
                        פתיחת פרויקט
                      </Link>
                    </Button>

                    {currentStatus === "quote" ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-11 rounded-xl"
                          onClick={() => openApproveQuote(row)}
                        >
                          אישור הצעה
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl"
                          onClick={() => openEditProject(row)}
                        >
                          <Pencil className="h-4 w-4" />
                          עריכה
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          className="col-span-2 h-11 w-full rounded-xl"
                          ariaLabel="מחיקת הצעת מחיר"
                          onDeleted={() => removeProject(id)}
                        >
                          מחיקת הצעה
                        </DeleteProjectButton>
                      </>
                    ) : (
                      <>
                        <Button asChild type="button" variant="outline" className="h-11 rounded-xl">
                          <Link
                            href={`/projects/${id}/export?mode=worker`}
                            prefetch
                            onClick={() => emitNavigationStart()}
                          >
                            <MessageCircle className="h-4 w-4" />
                            WhatsApp
                          </Link>
                        </Button>
                        <Button asChild type="button" variant="outline" className="h-11 rounded-xl">
                          <Link
                            href={`/projects/${id}/export?mode=worker`}
                            prefetch
                            onClick={() => emitNavigationStart()}
                          >
                            <FileText className="h-4 w-4" />
                            דף עבודה
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 rounded-xl"
                          onClick={() => openEditProject(row)}
                        >
                          <Pencil className="h-4 w-4" />
                          עריכה
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          className="h-11 w-full rounded-xl"
                          ariaLabel="מחיקת פרויקט"
                          onDeleted={() => removeProject(id)}
                        >
                          מחיקה
                        </DeleteProjectButton>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={approveQuoteOpen}
        onOpenChange={(open) => {
          setApproveQuoteOpen(open);
          if (!open && !approveQuoteSubmitting) {
            setApproveQuoteError(null);
            setApproveQuoteId("");
            setApproveQuoteName("");
            setApproveQuotePrice("");
          }
        }}
      >
        <AdaptiveDialog size="formSm">
          <DialogHeader>
            <DialogTitle>אישור הצעת מחיר</DialogTitle>
            <DialogDescription>
              {approveQuoteName
                ? `הזינו את המחיר המוסכם עבור ${approveQuoteName} לפני ההעברה למתוכנן.`
                : "הזינו את המחיר המוסכם לפני ההעברה למתוכנן."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">מחיר מוסכם *</label>
            <Input
              inputMode="decimal"
              value={approveQuotePrice}
              onChange={(e) => setApproveQuotePrice(e.target.value)}
              placeholder="לדוגמה: 2300"
            />
            {approveQuoteError ? <p className="text-sm text-destructive">{approveQuoteError}</p> : null}
          </div>

          <DialogFooter className="mt-4 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              className="border-slate-300 bg-slate-100 text-slate-700 hover:border-slate-400 hover:bg-slate-200 hover:text-slate-800"
              onClick={() => setApproveQuoteOpen(false)}
              disabled={approveQuoteSubmitting}
            >
              ביטול
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={() => void approveQuote()}
              disabled={approveQuoteSubmitting}
            >
              {approveQuoteSubmitting ? "שומר..." : "אישור הצעה"}
            </Button>
          </DialogFooter>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open && !createSubmitting) {
            setCreateAttachmentFiles([]);
          }
          setCreateOpen(open);
        }}
      >
        <AdaptiveDialog size="form2xl">
          <DialogHeader>
            <DialogTitle>{createStatus === "quote" ? "הצעת מחיר חדשה" : "הוספת פרויקט חדש"}</DialogTitle>
            <DialogDescription>
              {createStatus === "quote"
                ? "מלאו את פרטי הצעת המחיר. בהמשך תוכלו לאשר אותה ולהעביר למתוכנן."
                : "מלאו את השדות הנדרשים ליצירת פרויקט."}
            </DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createProject();
            }}
          >
            <AdaptiveGrid variant="formTwo">
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
                          className={`w-full rounded-xl border p-3 text-right text-sm transition-all duration-200 ${
                            customer.id === createCustomerId
                              ? "border-primary/20 bg-gradient-to-r from-primary to-destructive text-primary-foreground shadow-lg shadow-primary/20"
                              : "border-primary/10 bg-gradient-to-r from-accent to-destructive/15 text-accent-foreground shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                          }`}
                        >
                          <div className="font-medium">{customer.label}</div>
                          <div className={`text-xs ${customer.id === createCustomerId ? "text-primary-foreground/80" : "text-accent-foreground/80"}`}>
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
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">סוג פרויקט *</label>
                <select
                  value={createProjectType}
                  onChange={(e) => {
                    const nextProjectType = e.target.value;
                    setCreateProjectType(nextProjectType);
                    if (isMovingProjectType(nextProjectType)) {
                      setCreateEndDate(createStartDate);
                    }
                  }}
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
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <Input
                inputMode="decimal"
                value={createAgreedBasePrice}
                onChange={(e) => setCreateAgreedBasePrice(e.target.value)}
                placeholder="אופציונלי, ברירת מחדל 0"
              />
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <DateInput
                  value={createStartDate}
                  onChange={(e) => {
                    const nextStartDate = e.target.value;
                    setCreateStartDate(nextStartDate);
                    if (isMovingProjectType(createProjectType)) {
                      setCreateEndDate(nextStartDate);
                    }
                  }}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום (אופציונלי)</label>
                <DateInput
                  value={createEndDate}
                  onChange={(e) => setCreateEndDate(e.target.value)}
                />
              </div>
            </AdaptiveGrid>

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

            {isMovingProjectType(createProjectType) ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">פריטים להעברה</label>
                <Textarea
                  value={createItemsToMove}
                  onChange={(e) => setCreateItemsToMove(e.target.value)}
                  rows={5}
                  placeholder="כל פריט בשורה נפרדת"
                />
                <p className="text-xs text-muted-foreground">
                  אפשר להשאיר ריק. כל שורה תישמר כפריט נפרד.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium">תמונות / מסמכים</label>
              <div className="flex items-center gap-2">
                <FileUploadActions
                  files={createAttachmentFiles}
                  multiple
                  onFilesSelected={setCreateAttachmentFiles}
                  chooseLabel={createAttachmentFiles.length > 0 ? "הוסף קבצים" : "העלה קבצים"}
                  chooseVariant="outline"
                  size="sm"
                />
                {createAttachmentFiles.length > 0 ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setCreateAttachmentFiles([])}>
                    נקה בחירה
                  </Button>
                ) : null}
              </div>
              {createAttachmentFiles.length > 0 ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {createAttachmentFiles.map((file) => (
                    <div key={`${file.name}-${file.size}`}>{file.name}</div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  אפשר להעלות קבצים או לצלם תמונה ישירות מהמכשיר.
                </div>
              )}
            </div>

            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => { clearDraft("project-create"); setCreateOpen(false); }} disabled={createSubmitting}>
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
        </AdaptiveDialog>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <AdaptiveDialog size="form2xl">
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
            <AdaptiveGrid variant="formTwo">
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
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
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
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">מחיר בסיס מוסכם</label>
              <Input
                inputMode="decimal"
                value={editAgreedBasePrice}
                onChange={(e) => setEditAgreedBasePrice(e.target.value)}
              />
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך התחלה</label>
                <DateInput value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <DateInput value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
              </div>
            </AdaptiveGrid>

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

            {isMovingProjectType(editProjectType) ? (
              <div className="space-y-1">
                <label className="text-sm font-medium">פריטים להעברה</label>
                <Textarea
                  value={editItemsToMove}
                  onChange={(e) => setEditItemsToMove(e.target.value)}
                  rows={5}
                  placeholder="כל פריט בשורה נפרדת"
                />
                <p className="text-xs text-muted-foreground">
                  אפשר להשאיר ריק. כל שורה תישמר כפריט נפרד.
                </p>
              </div>
            ) : null}

            {editError ? <p className="text-sm text-destructive">{editError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)} disabled={editSubmitting}>
                ביטול
              </Button>
              <Button type="submit" disabled={editSubmitting}>
                {editSubmitting ? "שומר..." : "שמירת שינויים"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>

      <Dialog
        open={createCustomerOpen}
        onOpenChange={(next) => {
          setCreateCustomerOpen(next);
          if (!next && !createCustomerSubmitting) {
            setCreateCustomerError(null);
            resetCreateCustomerForm();
          }
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>הוספת לקוח חדש</DialogTitle>
            <DialogDescription>
              הלקוח לא נמצא? אפשר ליצור אותו ישירות כאן. שדות חובה: שם, טלפון ועיר.
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
              />
            </div>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">טלפון *</label>
                <Input
                  value={createCustomerPhone}
                  onChange={(e) => setCreateCustomerPhone(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">וואטסאפ</label>
                <Input
                  value={createCustomerWhatsapp}
                  onChange={(e) => setCreateCustomerWhatsapp(e.target.value)}
                />
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <label className="text-sm font-medium">אימייל</label>
              <Input
                value={createCustomerEmail}
                onChange={(e) => setCreateCustomerEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">שם לחשבונית</label>
              <Input
                value={createCustomerNameForInvoice}
                onChange={(e) => setCreateCustomerNameForInvoice(e.target.value)}
                placeholder="אם שונה משם הלקוח"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">ח.פ / ת.ז</label>
              <Input
                value={createCustomerRegNumber}
                onChange={(e) => setCreateCustomerRegNumber(e.target.value)}
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
                />
              </div>
            ) : null}

            <div className="space-y-1">
              <label className="text-sm font-medium">כתובת</label>
              <Input
                value={createCustomerAddress}
                onChange={(e) => setCreateCustomerAddress(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">הערות</label>
              <Textarea
                value={createCustomerNotes}
                onChange={(e) => setCreateCustomerNotes(e.target.value)}
                rows={3}
              />
            </div>

            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">אנשי קשר</div>
                  <div className="text-xs text-muted-foreground">
                    אפשר להוסיף אנשי קשר כבר ביצירת הלקוח.
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addCreateCustomerContact}>
                  הוספת איש קשר
                </Button>
              </div>
              {createCustomerContacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">עדיין לא נוספו אנשי קשר.</p>
              ) : null}
              {createCustomerContacts.map((contact, index) => (
                <div
                  key={`project-create-customer-contact-${index}`}
                  className="space-y-3 rounded-md border bg-background p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">איש קשר {index + 1}</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeCreateCustomerContact(index)}
                    >
                      הסרה
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">שם מלא *</label>
                    <Input
                      value={contact.full_name}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, { full_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">תפקיד</label>
                    <Input
                      value={contact.role}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, { role: e.target.value })
                      }
                    />
                  </div>
                  <AdaptiveGrid variant="formTwo">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">טלפון</label>
                      <Input
                        value={contact.phone}
                        onChange={(e) =>
                          updateCreateCustomerContact(index, { phone: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">וואטסאפ</label>
                      <Input
                        value={contact.whatsapp}
                        onChange={(e) =>
                          updateCreateCustomerContact(index, { whatsapp: e.target.value })
                        }
                      />
                    </div>
                  </AdaptiveGrid>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">אימייל</label>
                    <Input
                      value={contact.email}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, { email: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">הערות</label>
                    <Textarea
                      value={contact.notes}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, { notes: e.target.value })
                      }
                      rows={2}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={contact.is_primary}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, {
                          is_primary: e.target.checked,
                          active: e.target.checked ? true : contact.active,
                        })
                      }
                    />
                    <span>איש קשר ראשי</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={contact.active}
                      onChange={(e) =>
                        updateCreateCustomerContact(index, { active: e.target.checked })
                      }
                    />
                    <span>פעיל</span>
                  </label>
                </div>
              ))}
            </div>

            {createCustomerError ? (
              <p className="text-sm text-destructive">{createCustomerError}</p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateCustomerOpen(false)} disabled={createCustomerSubmitting}>
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
        </AdaptiveDialog>
      </Dialog>

      <Dialog open={monthlySummaryOpen} onOpenChange={setMonthlySummaryOpen}>
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>סיכום פרויקטים לפי חודש</DialogTitle>
            <DialogDescription>
              בחר חודש כדי לראות סיכום של פרויקטים בפועל.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <label className="text-sm font-medium">חודש</label>
                <Input
                  type="month"
                  value={monthlySummaryMonth}
                  onChange={(e) => setMonthlySummaryMonth(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void loadMonthlySummary()}
                  disabled={monthlySummaryLoading}
                >
                  {monthlySummaryLoading ? "טוען..." : "הצג סיכום"}
                </Button>
              </div>
            </AdaptiveGrid>

            {monthlySummaryError ? (
              <div className="text-sm text-destructive">{monthlySummaryError}</div>
            ) : null}

            {monthlySummary ? (
              <div className="space-y-4">
                <AdaptiveGrid variant="customerStats">
                  <Stat label="פרויקטים בפועל" value={`${monthlySummary.totalProjects}`} />
                  <Stat label='סה"כ לחיוב' value={formatIls(monthlySummary.totals.charged)} />
                  <Stat label='סה"כ הוצאות' value={formatIls(monthlySummary.totals.expenses)} />
                  <Stat label="רווח גולמי" value={formatIls(monthlySummary.totals.profit)} />
                  <Stat label='סה"כ שולם' value={formatIls(monthlySummary.totals.paid)} />
                  <Stat label='סה"כ חייב לעובדים' value={formatIls(monthlySummary.totals.workerOwed)} />
                  <Stat
                    label="יתרה פתוחה"
                    value={formatIls(monthlySummary.totals.charged - monthlySummary.totals.paid)}
                  />
                </AdaptiveGrid>

                <AdaptiveGrid variant="formTwo">
                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">סוג פרויקט</div>
                    {monthlySummary.byType.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      monthlySummary.byType.map((item) => (
                        <div key={item.type} className="flex items-center justify-between gap-3 text-sm">
                          <span>{projectTypeLabel(item.type)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 rounded-md border bg-background p-3">
                    <div className="text-sm font-semibold">סטטוס</div>
                    {monthlySummary.byStatus.length === 0 ? (
                      <div className="text-sm text-muted-foreground">אין נתונים לחודש הזה.</div>
                    ) : (
                      monthlySummary.byStatus.map((item) => (
                        <div key={item.status} className="flex items-center justify-between gap-3 text-sm">
                          <span>{statusLabel(item.status)}</span>
                          <span className="font-medium">{item.count}</span>
                        </div>
                      ))
                    )}
                  </div>
                </AdaptiveGrid>
              </div>
            ) : null}
          </div>
        </AdaptiveDialog>
      </Dialog>
    </PageStack>
  );
}



