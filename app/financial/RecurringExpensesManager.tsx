"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarPlus2 } from "lucide-react";
import { AdaptiveDialog, AdaptiveGrid } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";

type Option = {
  id: string;
  label: string;
};

type Frequency = "monthly" | "yearly";

export type RecurringExpenseTemplateItem = {
  id: string;
  template_name: string;
  category: string;
  amount: number;
  description_template: string | null;
  notes_template: string | null;
  business_domain: string;
  project_id: string | null;
  order_id: string | null;
  property_id: string | null;
  included_in_base_price: boolean;
  billed_to_customer: boolean;
  project_expense_notes_template: string | null;
  frequency: Frequency;
  create_day_of_month: number;
  expense_day_of_month: number;
  create_month_of_year: number | null;
  expense_month_of_year: number | null;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
};

type Props = {
  templates: RecurringExpenseTemplateItem[];
  projects: Option[];
  orders: Option[];
  properties: Option[];
  missingSchema?: boolean;
};

type FormState = {
  id: string | null;
  template_name: string;
  category: string;
  amount: string;
  description_template: string;
  notes_template: string;
  business_domain: ExpenseBusinessDomain | "";
  project_id: string;
  order_id: string;
  property_id: string;
  included_in_base_price: boolean;
  billed_to_customer: boolean;
  project_expense_notes_template: string;
  frequency: Frequency;
  create_day_of_month: number;
  expense_day_of_month: number;
  create_month_of_year: string;
  expense_month_of_year: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
};

const MONTH_OPTIONS = [
  { value: "1", label: "ינואר" },
  { value: "2", label: "פברואר" },
  { value: "3", label: "מרץ" },
  { value: "4", label: "אפריל" },
  { value: "5", label: "מאי" },
  { value: "6", label: "יוני" },
  { value: "7", label: "יולי" },
  { value: "8", label: "אוגוסט" },
  { value: "9", label: "ספטמבר" },
  { value: "10", label: "אוקטובר" },
  { value: "11", label: "נובמבר" },
  { value: "12", label: "דצמבר" },
] as const;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function linkRequirement(domain: ExpenseBusinessDomain | "") {
  if (domain === "logistics_projects") return "project";
  if (domain === "property_management") return "property";
  if (domain === "sales") return "order-optional";
  return null;
}

function createEmptyForm(): FormState {
  return {
    id: null,
    template_name: "",
    category: "",
    amount: "",
    description_template: "",
    notes_template: "",
    business_domain: "",
    project_id: "",
    order_id: "",
    property_id: "",
    included_in_base_price: false,
    billed_to_customer: false,
    project_expense_notes_template: "",
    frequency: "monthly",
    create_day_of_month: 1,
    expense_day_of_month: 1,
    create_month_of_year: "",
    expense_month_of_year: "",
    start_date: "",
    end_date: "",
    is_active: true,
  };
}

function scheduleLabel(template: RecurringExpenseTemplateItem) {
  if (template.frequency === "yearly") {
    const createMonth =
      MONTH_OPTIONS.find((item) => item.value === String(template.create_month_of_year ?? ""))?.label ?? "—";
    const expenseMonth =
      MONTH_OPTIONS.find((item) => item.value === String(template.expense_month_of_year ?? ""))?.label ?? "—";
    return `שנתי • יצירה ${template.create_day_of_month}/${createMonth} • הוצאה ${template.expense_day_of_month}/${expenseMonth}`;
  }

  return `חודשי • יצירה ביום ${template.create_day_of_month} • הוצאה ביום ${template.expense_day_of_month}`;
}

export default function RecurringExpensesManager(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<FormState>(createEmptyForm());

  const requirement = linkRequirement(form.business_domain);
  const amountNumber = Number(form.amount);
  const canSave =
    Boolean(form.business_domain) &&
    Boolean(form.template_name.trim()) &&
    Boolean(form.category.trim()) &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    (requirement === "project"
      ? Boolean(form.project_id)
      : requirement === "property"
        ? Boolean(form.property_id)
        : true) &&
    (form.frequency === "monthly" ||
      (Boolean(form.create_month_of_year) && Boolean(form.expense_month_of_year)));

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate() {
    setForm(createEmptyForm());
    setOpen(true);
  }

  function openEdit(template: RecurringExpenseTemplateItem) {
    setForm({
      id: template.id,
      template_name: template.template_name,
      category: template.category,
      amount: String(template.amount),
      description_template: template.description_template ?? "",
      notes_template: template.notes_template ?? "",
      business_domain: template.business_domain as ExpenseBusinessDomain,
      project_id: template.project_id ?? "",
      order_id: template.order_id ?? "",
      property_id: template.property_id ?? "",
      included_in_base_price: template.included_in_base_price,
      billed_to_customer: template.billed_to_customer,
      project_expense_notes_template: template.project_expense_notes_template ?? "",
      frequency: template.frequency,
      create_day_of_month: template.create_day_of_month,
      expense_day_of_month: template.expense_day_of_month,
      create_month_of_year: template.create_month_of_year ? String(template.create_month_of_year) : "",
      expense_month_of_year: template.expense_month_of_year ? String(template.expense_month_of_year) : "",
      start_date: template.start_date ?? "",
      end_date: template.end_date ?? "",
      is_active: template.is_active,
    });
    setOpen(true);
  }

  function handleDomainChange(next: ExpenseBusinessDomain | "") {
    setForm((current) => ({
      ...current,
      business_domain: next,
      project_id: linkRequirement(next) === "project" ? current.project_id : "",
      property_id: linkRequirement(next) === "property" ? current.property_id : "",
      order_id: next === "sales" ? current.order_id : "",
    }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/recurring-expenses/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          template_name: form.template_name.trim(),
          category: form.category.trim(),
          amount: amountNumber,
          description_template: form.description_template.trim() || null,
          notes_template: form.notes_template.trim() || null,
          business_domain: form.business_domain,
          project_id: requirement === "project" ? form.project_id : null,
          property_id: requirement === "property" ? form.property_id : null,
          order_id: form.business_domain === "sales" ? form.order_id || null : null,
          included_in_base_price: form.included_in_base_price,
          billed_to_customer: form.billed_to_customer,
          project_expense_notes_template: form.project_expense_notes_template.trim() || null,
          frequency: form.frequency,
          create_day_of_month: form.create_day_of_month,
          expense_day_of_month: form.expense_day_of_month,
          create_month_of_year: form.frequency === "yearly" ? form.create_month_of_year : null,
          expense_month_of_year: form.frequency === "yearly" ? form.expense_month_of_year : null,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
          is_active: form.is_active,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה בשמירת הוצאה קבועה", { description: json?.error ?? "" });
        return;
      }
      setOpen(false);
      router.refresh();
      toast.success("ההוצאה הקבועה נשמרה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const ok = window.confirm("למחוק את ההוצאה הקבועה?");
    if (!ok) return;

    const res = await fetch("/api/recurring-expenses/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error("שגיאה במחיקת הוצאה קבועה", { description: json?.error ?? "" });
      return;
    }
    router.refresh();
    toast.success("ההוצאה הקבועה נמחקה");
  }

  async function generateNow() {
    setGenerating(true);
    try {
      const res = await fetch("/api/recurring-expenses/generate", {
        method: "POST",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("שגיאה ביצירת הוצאות קבועות", { description: json?.error ?? "" });
        return;
      }
      router.refresh();
      toast.success("המחזור נוצר", {
        description: `נוצרו ${typeof json?.createdCount === "number" ? json.createdCount : 0} הוצאות.`,
      });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div dir="rtl" className="space-y-4 text-right">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="hidden">
          <h2 className="text-2xl font-semibold">הוצאות קבועות</h2>
          <div className="text-sm text-muted-foreground">
            תבניות להוצאות חוזרות חודשיות או שנתיות שנוצרות אוטומטית בתוך המערכת.
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:self-start">
          <Button
            type="button"
            variant="outline"
            onClick={() => void generateNow()}
            disabled={generating || props.missingSchema}
            className="flex-row-reverse gap-2"
          >
            <CalendarPlus2 className="h-4 w-4" />
            {generating ? "מייצר..." : "צור מחזור נוכחי"}
          </Button>
          <Button type="button" onClick={openCreate} disabled={props.missingSchema}>
            הוצאה קבועה חדשה
          </Button>
        </div>
      </div>

      {props.missingSchema ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            צריך קודם להריץ את [db/sql/create_recurring_expense_templates.sql] כדי לנהל הוצאות קבועות.
          </CardContent>
        </Card>
      ) : props.templates.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            אין עדיין הוצאות קבועות. אפשר להתחיל משכירות, משכורות, ביטוחים, רכב, אינטרנט או כל הוצאה שחוזרת כל חודש או כל שנה.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            {props.templates.map((template) => {
              const linkedLabel =
                template.project_id
                  ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                  : template.property_id
                    ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                    : template.order_id
                      ? props.orders.find((item) => item.id === template.order_id)?.label ?? "הזמנה"
                      : "ללא שיוך";

              return (
                <Card key={template.id} className="overflow-hidden">
                  <CardContent className="space-y-3 p-4 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="font-medium">{template.template_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {getBusinessDomainLabel(template.business_domain)} • {linkedLabel}
                        </div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEdit(template)}>
                        עריכה
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{template.frequency === "yearly" ? "שנתי" : "חודשי"}</Badge>
                      {!template.is_active ? <Badge variant="warning">לא פעיל</Badge> : null}
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div>קטגוריה: <span className="text-foreground">{template.category}</span></div>
                      <div>סכום: <span className="text-foreground">{formatCurrency(template.amount)}</span></div>
                      <div>תזמון: <span className="text-foreground">{scheduleLabel(template)}</span></div>
                      <div>
                        טווח: <span className="text-foreground">{template.start_date || "ללא התחלה"} | {template.end_date || "ללא סוף"}</span>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="destructive" size="sm" onClick={() => void remove(template.id)}>
                        מחיקה
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="hidden max-h-[70vh] overflow-auto rounded-md border md:block">
            <table dir="rtl" className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right font-medium">שם תבנית</th>
                  <th className="px-3 py-2 text-right font-medium">תחום</th>
                  <th className="px-3 py-2 text-right font-medium">שיוך</th>
                  <th className="px-3 py-2 text-right font-medium">קטגוריה</th>
                  <th className="px-3 py-2 text-right font-medium">סכום</th>
                  <th className="px-3 py-2 text-right font-medium">תדירות</th>
                  <th className="px-3 py-2 text-right font-medium">תזמון</th>
                  <th className="px-3 py-2 text-right font-medium">פעיל</th>
                  <th className="px-3 py-2 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {props.templates.map((template) => {
                  const linkedLabel =
                    template.project_id
                      ? props.projects.find((item) => item.id === template.project_id)?.label ?? "פרויקט"
                      : template.property_id
                        ? props.properties.find((item) => item.id === template.property_id)?.label ?? "נכס"
                        : template.order_id
                          ? props.orders.find((item) => item.id === template.order_id)?.label ?? "הזמנה"
                          : "ללא שיוך";

                  return (
                    <tr key={template.id} className="hover:bg-muted/30 align-top">
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="font-medium">{template.template_name}</div>
                          {template.description_template ? (
                            <div className="line-clamp-2 max-w-[280px] text-xs text-muted-foreground">
                              {template.description_template}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">{getBusinessDomainLabel(template.business_domain)}</td>
                      <td className="px-3 py-2">{linkedLabel}</td>
                      <td className="px-3 py-2">{template.category}</td>
                      <td dir="ltr" className="px-3 py-2 whitespace-nowrap text-left tabular-nums">{formatCurrency(template.amount)}</td>
                      <td className="px-3 py-2">{template.frequency === "yearly" ? "שנתי" : "חודשי"}</td>
                      <td className="px-3 py-2 max-w-[280px]">{scheduleLabel(template)}</td>
                      <td className="px-3 py-2">{template.is_active ? "כן" : "לא"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => openEdit(template)}>
                            עריכה
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => void remove(template.id)}>
                            מחיקה
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && saving) return;
          setOpen(next);
        }}
      >
        <AdaptiveDialog size="formLg">
          <DialogHeader>
            <DialogTitle>{form.id ? "עריכת הוצאה קבועה" : "הוצאה קבועה חדשה"}</DialogTitle>
            <DialogDescription>
              אפשר להשתמש בטוקנים `{"{{period_key}}"}`, `{"{{expense_date}}"}`, `{"{{expense_month}}"}`.
            </DialogDescription>
          </DialogHeader>

          <form
            dir="rtl"
            className="mt-4 space-y-3 text-right"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-1">
              <div className="text-sm font-medium">תחום עסקי *</div>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={form.business_domain}
                onChange={(event) => handleDomainChange(event.target.value as ExpenseBusinessDomain | "")}
              >
                <option value="">בחרו תחום</option>
                {EXPENSE_BUSINESS_DOMAINS.map((domain) => (
                  <option key={domain} value={domain}>
                    {getBusinessDomainLabel(domain)}
                  </option>
                ))}
              </select>
            </div>

            {form.business_domain ? (
              <>
            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">שם תבנית *</div>
                <Input
                  value={form.template_name}
                  onChange={(event) => updateForm("template_name", event.target.value)}
                  placeholder="למשל: שכירות משרד"
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">קטגוריה *</div>
                <Input
                  value={form.category}
                  onChange={(event) => updateForm("category", event.target.value)}
                  placeholder="שכירות / ביטוח / תקשורת..."
                />
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <div className="text-sm font-medium">סכום *</div>
              <CurrencyInput
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(event) => updateForm("amount", event.target.value)}
              />
            </div>

            {requirement === "project" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">פרויקט *</div>
                <ProjectPicker
                  projects={props.projects}
                  value={form.project_id}
                  onChange={(id) => updateForm("project_id", id)}
                  emptyLabel="בחר פרויקט..."
                  allowClear={false}
                />
              </div>
            ) : null}

            {requirement === "property" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">נכס *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.property_id}
                  onChange={(event) => updateForm("property_id", event.target.value)}
                >
                  <option value="">בחר נכס...</option>
                  {props.properties.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {form.business_domain === "sales" ? (
              <div className="space-y-1">
                <div className="text-sm font-medium">הזמנה מקושרת</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.order_id}
                  onChange={(event) => updateForm("order_id", event.target.value)}
                >
                  <option value="">ללא הזמנה</option>
                  {props.orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">תדירות *</div>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.frequency}
                  onChange={(event) => updateForm("frequency", event.target.value as Frequency)}
                >
                  <option value="monthly">חודשי</option>
                  <option value="yearly">שנתי</option>
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">תאריך התחלה</div>
                <DateInput value={form.start_date} onChange={(event) => updateForm("start_date", event.target.value)} />
              </div>
            </AdaptiveGrid>

            {form.frequency === "yearly" ? (
              <AdaptiveGrid variant="formTwo">
                <div className="space-y-1">
                  <div className="text-sm font-medium">חודש יצירה *</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.create_month_of_year}
                    onChange={(event) => updateForm("create_month_of_year", event.target.value)}
                  >
                    <option value="">בחר חודש...</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium">חודש הוצאה *</div>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.expense_month_of_year}
                    onChange={(event) => updateForm("expense_month_of_year", event.target.value)}
                  >
                    <option value="">בחר חודש...</option>
                    {MONTH_OPTIONS.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </AdaptiveGrid>
            ) : null}

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">יום יצירה *</div>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.create_day_of_month)}
                  onChange={(event) => updateForm("create_day_of_month", Number(event.target.value) || 1)}
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">יום הוצאה *</div>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={String(form.expense_day_of_month)}
                  onChange={(event) => updateForm("expense_day_of_month", Number(event.target.value) || 1)}
                />
              </div>
            </AdaptiveGrid>

            <AdaptiveGrid variant="formTwo">
              <div className="space-y-1">
                <div className="text-sm font-medium">עד תאריך</div>
                <DateInput value={form.end_date} onChange={(event) => updateForm("end_date", event.target.value)} />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium">הערת פרויקט</div>
                <Input
                  value={form.project_expense_notes_template}
                  onChange={(event) => updateForm("project_expense_notes_template", event.target.value)}
                  placeholder="אופציונלי"
                />
              </div>
            </AdaptiveGrid>

            <div className="space-y-1">
              <div className="text-sm font-medium">תיאור</div>
              <Textarea
                value={form.description_template}
                onChange={(event) => updateForm("description_template", event.target.value)}
                placeholder="למשל: שכירות משרד עבור {{expense_month}}"
              />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium">הערות</div>
              <Textarea
                value={form.notes_template}
                onChange={(event) => updateForm("notes_template", event.target.value)}
                placeholder="הערות פנימיות קבועות"
              />
            </div>

            {form.business_domain === "logistics_projects" ? (
              <div className="grid gap-2 rounded-xl border p-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.included_in_base_price}
                    onChange={(event) => updateForm("included_in_base_price", event.target.checked)}
                  />
                  <span>כלול במחיר הבסיס</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.billed_to_customer}
                    onChange={(event) => updateForm("billed_to_customer", event.target.checked)}
                  />
                  <span>מחויב ללקוח</span>
                </label>
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => updateForm("is_active", event.target.checked)}
              />
              <span>פעיל</span>
            </label>
              </>
            ) : null}

            <DialogFooter className="mt-6">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                ביטול
              </Button>
              <Button type="submit" disabled={!canSave || saving}>
                {saving ? "שומר..." : "שמירה"}
              </Button>
            </DialogFooter>
          </form>
        </AdaptiveDialog>
      </Dialog>
    </div>
  );
}
