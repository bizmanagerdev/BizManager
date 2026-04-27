"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { paymentStatusClasses } from "@/lib/orders/paymentStatus";
import {
  AdaptiveDialog,
  AdaptiveGrid,
  AdaptiveStack,
  PageStack,
} from "@/components/layout/page-layout";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
type SortMode = "recent" | "start_date" | "profit_desc";
type ProjectsView = "projects" | "quotes" | "closed";
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
const defaultProjectTypeOptions = ["logistics", "moving", "renovation"];
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
    case "renovation":
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

function oneMonthFrom(dateIso: string) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
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
  const [activeTab, setActiveTab] = useState<ProjectsView>("projects");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<SortMode>("start_date");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

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
  const hasActiveToolbarFilters = query.trim().length > 0 || status !== "all" || sort !== "start_date";

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
    if (activeTab === "quotes") {
      setStatus("quote");
      return;
    }
    if (activeTab === "closed") {
      setStatus("completed");
      return;
    }
    setStatus((current) => (current === "quote" || current === "completed" ? "all" : current));
  }, [activeTab]);

  function defaultCreateStatusForTab(tab: ProjectsView) {
    return tab === "quotes" ? "quote" : "planned";
  }

  function openCreateDialog(nextTab: ProjectsView = activeTab) {
    setCreateError(null);
    setCreateStatus(defaultCreateStatusForTab(nextTab));
    setCreateOpen(true);
  }

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
  }, [activeTab, customerOptionsState, searchParams]);

  function resetCreateCustomerForm() {
    setCreateCustomerName("");
    setCreateCustomerPhone("");
    setCreateCustomerEmail("");
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
      setCreateStatus(defaultCreateStatusForTab(activeTab));
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

  function openApproveQuote(row: ProjectRow) {
    setApproveQuoteError(null);
    setApproveQuoteId(getString(row, "id") ?? "");
    setApproveQuoteName(projectDisplayName(row));
    const currentPrice = getNumber(row, "agreed_base_price");
    setApproveQuotePrice(currentPrice !== null && currentPrice > 0 ? String(currentPrice) : "");
    setApproveQuoteOpen(true);
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
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProjectsView)}>
        <TabsList className="mx-auto flex w-fit max-w-full justify-center md:mx-0">
          <TabsTrigger value="projects">פרויקטים ({projectCount})</TabsTrigger>
          <TabsTrigger value="quotes">הצעות מחיר ({quoteCount})</TabsTrigger>
          <TabsTrigger value="closed">סגורים ({closedCount})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-3 md:hidden">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 justify-center gap-2"
            onClick={() => setMobileFiltersOpen((current) => !current)}
            aria-expanded={mobileFiltersOpen}
            aria-controls="projects-mobile-filters"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {mobileFiltersOpen ? "הסתרת חיפוש וסינון" : "חיפוש וסינון"}
          </Button>
          <Button type="button" className="h-11 flex-1" onClick={() => openCreateDialog(activeTab)}>
            {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
          </Button>
        </div>

        {hasActiveToolbarFilters && !mobileFiltersOpen ? (
          <div className="text-xs text-muted-foreground">קיים חיפוש או סינון פעיל.</div>
        ) : null}

        <div
          id="projects-mobile-filters"
          className={(
            `${mobileFiltersOpen ? "grid" : "hidden"} gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm`
          ).trim()}
        >
          <div className="min-w-0">
            <label className="text-sm text-muted-foreground">חיפוש</label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חיפוש לפי לקוח או פרויקט..."
              className="mt-1 h-11"
            />
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
            <label className="text-sm text-muted-foreground">מיון</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה</option>
              <option value="profit_desc">רווח (גבוה לנמוך)</option>
            </select>
          </div>
        </div>
      </div>

      <AdaptiveStack variant="toolbar" className="hidden md:flex">
        <div className="flex-1">
          <label className="text-sm text-muted-foreground">חיפוש</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש לפי לקוח או פרויקט..."
            className="mt-1 h-11"
          />
        </div>

        <AdaptiveGrid variant="projectsToolbarControls">
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
            <label className="text-sm text-muted-foreground">מיון</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="recent">אחרונים</option>
              <option value="start_date">תאריך התחלה</option>
              <option value="profit_desc">רווח (גבוה לנמוך)</option>
            </select>
          </div>

          <div className="min-w-0">
            <label className="text-sm text-muted-foreground opacity-0">הוספה</label>
            <Button type="button" className="h-11 w-full" onClick={() => openCreateDialog(activeTab)}>
              {activeTab === "quotes" ? "הצעת מחיר חדשה" : "הוספת פרויקט"}
            </Button>
          </div>
        </AdaptiveGrid>
      </AdaptiveStack>

      <div className="text-sm text-muted-foreground">
        {activeTab === "quotes"
          ? `נמצאו ${rows.length} הצעות מחיר`
          : activeTab === "closed"
            ? `נמצאו ${rows.length} פרויקטים סגורים`
            : `נמצאו ${rows.length} פרויקטים`}
      </div>

      <div className="hidden rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(150px,1fr)_90px_110px_110px_130px_95px_85px_240px] md:items-center md:gap-2 sm:px-4">
        <div>פרויקט</div>
        <div>סטטוס</div>
        <div>תאריך התחלה</div>
        <div>תשלום</div>
        <div>לקוח</div>
        <div>רווח</div>
        <div>משימות פתוחות</div>
        <div>פעולות</div>
      </div>

      <div className="grid gap-2 sm:gap-2.5">
        {rows.map((row) => {
          const id = getString(row, "id") ?? "";
          const profit = profitValue(row);
          const currentStatus = statusValue(row);
          const openTasks = getNumber(row, "open_tasks");
          const paymentStatus = paymentStatusValue(row);
          const startDate = formatDate(getString(row, "start_date"));

          return (
            <Card key={id} className="transition-shadow hover:shadow-md">
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(150px,1fr)_90px_110px_110px_130px_95px_85px_240px] md:items-center md:gap-2">
                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="min-w-0"
                    onClick={() => emitNavigationStart()}
                  >
                    <div className="min-w-0">
                      <div className="text-base font-semibold">{projectDisplayName(row)}</div>
                      <div className="text-sm text-muted-foreground">
                        #{id.slice(0, 8)}
                      </div>
                    </div>
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="text-sm"
                    onClick={() => emitNavigationStart()}
                  >
                    <StatusBadge value={currentStatus} type="project" />
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="text-sm"
                    onClick={() => emitNavigationStart()}
                  >
                    {startDate}
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="text-sm"
                    onClick={() => emitNavigationStart()}
                  >
                    <Badge className={paymentStatusBadgeClasses(paymentStatus)}>
                      {paymentStatusLabel(paymentStatus)}
                    </Badge>
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="text-sm"
                    onClick={() => emitNavigationStart()}
                  >
                    {clientDisplayName(row)}
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className={`text-sm ${profit !== null && profit < 0 ? "text-destructive" : ""}`}
                    onClick={() => emitNavigationStart()}
                  >
                    {profit === null ? "-" : formatIls(profit)}
                  </Link>

                  <Link
                    href={`/projects/${id}`}
                    prefetch
                    className="text-sm"
                    onClick={() => emitNavigationStart()}
                  >
                    {openTasks === null ? "-" : openTasks}
                  </Link>

                  <div className="flex shrink-0 items-center gap-1.5 md:justify-start">
                    {currentStatus === "quote" ? (
                      <>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          className="h-10 rounded-xl px-3"
                          onClick={() => openApproveQuote(row)}
                        >
                          אישור הצעה
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-10 w-10 rounded-xl"
                          onClick={() => openEditProject(row)}
                          aria-label="עריכת הצעת מחיר"
                          title="עריכת הצעת מחיר"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          size="icon"
                          className="h-10 w-10 rounded-xl"
                          ariaLabel="מחיקת הצעת מחיר"
                          onDeleted={() => removeProject(id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </DeleteProjectButton>
                      </>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-11 w-11 rounded-xl"
                          onClick={() => openEditProject(row)}
                          aria-label="עריכת פרויקט"
                          title="עריכת פרויקט"
                        >
                          <Pencil />
                        </Button>
                        <DeleteProjectButton
                          projectId={id}
                          projectName={projectDisplayName(row)}
                          size="icon"
                          className="h-11 w-11 rounded-xl"
                          ariaLabel="מחיקת פרויקט"
                          onDeleted={() => removeProject(id)}
                        >
                          <Trash2 />
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

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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

            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
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
                <Input type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">תאריך סיום</label>
                <Input type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
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
    </PageStack>
  );
}



