"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { CreateCustomerDialog } from "@/components/customers/CreateCustomerDialog";
import type { CreatedCustomer } from "@/components/customers/CreateCustomerDialog";
import {
  AdaptiveCell,
  AdaptiveDialog,
  AdaptiveGrid,
  PageStack,
} from "@/components/layout/page-layout";
import { NavLink } from "@/components/NavLink";
import { emitNavigationStart } from "@/components/layout/TopNavigationProgress";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate } from "@/lib/date";
import MorningCustomerCard from "@/components/morning/MorningCustomerCard";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

type Row = Record<string, unknown>;
type FilterMode = "all" | "yes" | "no";

const s = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string) : "");
const n = (row: Row, key: string) => {
  const v = row[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const p = Number(v);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
};
const contactsOf = (row: Row): Row[] => (Array.isArray(row.contacts) ? (row.contacts as Row[]) : []);
const ils = (v: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(v);
const dateText = (v: string) => {
  return formatShortDate(v);
};
const morningClientUrl = (morningClientId: string) =>
  `https://app.greeninvoice.co.il/incomes/clients/${encodeURIComponent(morningClientId)}/documents`;

function customerFlagBadgeClass(tone: "success" | "danger" | "neutral") {
  switch (tone) {
    case "success":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    case "danger":
      return "border-rose-200 bg-rose-100 text-rose-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export default function CustomersClient({
  initialRows,
  initialEditCustomerId = "",
  initialAddContactCustomerId = "",
  currentPage = 1,
}: {
  initialRows: Row[];
  initialEditCustomerId?: string;
  initialAddContactCustomerId?: string;
  currentPage?: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [handledInitialEdit, setHandledInitialEdit] = useState(false);
  const [handledInitialAddContact, setHandledInitialAddContact] = useState(false);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [withProjects, setWithProjects] = useState<FilterMode>("all");
  const [withOrders, setWithOrders] = useState<FilterMode>("all");
  const [withDebt, setWithDebt] = useState<FilterMode>("all");
  const [activeOnly, setActiveOnly] = useState<FilterMode>("all");

  const [createOpen, setCreateOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editErr, setEditErr] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [editInvoiceName, setEditInvoiceName] = useState("");
  const [editReg, setEditReg] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editRequiresPrepayment, setEditRequiresPrepayment] = useState(false);

  const [contactOpen, setContactOpen] = useState(false);
  const [contactErr, setContactErr] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [targetCustomerId, setTargetCustomerId] = useState("");
  const [targetCustomerName, setTargetCustomerName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactWhatsapp, setContactWhatsapp] = useState("");
  const [contactNotes, setContactNotes] = useState("");
  const [contactPrimary, setContactPrimary] = useState(false);
  const [contactActive, setContactActive] = useState(true);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const hay = [
        s(row, "customer_name"),
        s(row, "phone"),
        s(row, "whatsapp"),
        s(row, "email"),
        s(row, "address"),
      ]
        .join(" ")
        .toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (withProjects === "yes" && n(row, "projects_count") <= 0) return false;
      if (withProjects === "no" && n(row, "projects_count") > 0) return false;
      if (withOrders === "yes" && n(row, "orders_count") <= 0) return false;
      if (withOrders === "no" && n(row, "orders_count") > 0) return false;
      if (withDebt === "yes" && n(row, "open_balance") <= 0) return false;
      if (withDebt === "no" && n(row, "open_balance") > 0) return false;
      if (activeOnly === "yes" && row.active === false) return false;
      if (activeOnly === "no" && row.active !== false) return false;
      return true;
    });
  }, [rows, query, withProjects, withOrders, withDebt, activeOnly]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (handledInitialEdit || !initialEditCustomerId || rows.length === 0) return;
    const row = rows.find((current) => s(current, "customer_id") === initialEditCustomerId);
    if (!row) return;
    openEdit(row);
    setHandledInitialEdit(true);
  }, [handledInitialEdit, initialEditCustomerId, rows]);

  useEffect(() => {
    if (handledInitialAddContact || !initialAddContactCustomerId || rows.length === 0) return;
    const row = rows.find((current) => s(current, "customer_id") === initialAddContactCustomerId);
    if (!row) return;
    openAddContact(row);
    setHandledInitialAddContact(true);
  }, [handledInitialAddContact, initialAddContactCustomerId, rows]);

  function openEdit(row: Row) {
    setEditErr("");
    setEditId(s(row, "customer_id"));
    setEditName(s(row, "name") || s(row, "customer_name"));
    setEditInvoiceName(s(row, "name_for_invoice"));
    setEditReg(s(row, "registration_number"));
    setEditPhone(s(row, "phone"));
    setEditWhatsapp(s(row, "whatsapp"));
    setEditEmail(s(row, "email"));
    setEditAddress(s(row, "address"));
    setEditNotes(s(row, "notes"));
    setEditActive(row.active !== false);
    setEditRequiresPrepayment(row.requires_prepayment === true);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (editLoading) return;
    setEditErr("");
    if (!editId) return setEditErr("חסר מזהה לקוח.");
    if (!editName.trim()) return setEditErr("יש למלא שם לקוח.");
    setEditLoading(true);
    try {
      const res = await fetch("/api/customers/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editId,
          name: editName.trim(),
          name_for_invoice: editInvoiceName.trim() || null,
          registration_number: editReg.trim() || null,
          phone: editPhone.trim() || null,
          whatsapp: editWhatsapp.trim() || null,
          email: editEmail.trim() || null,
          address: editAddress.trim() || null,
          notes: editNotes.trim() || null,
          active: editActive,
          requires_prepayment: editRequiresPrepayment,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; customer?: Row };
      if (!res.ok || !json.customer) return setEditErr(json.error ?? "עדכון לקוח נכשל.");
      const u = json.customer;
      setRows((prev) =>
        prev.map((row) =>
          s(row, "customer_id") !== s(u, "id")
            ? row
            : {
                ...row,
                customer_name: s(u, "name") || s(row, "customer_name"),
                name: s(u, "name") || s(row, "name"),
                name_for_invoice: s(u, "name_for_invoice"),
                registration_number: s(u, "registration_number"),
                phone: s(u, "phone"),
                whatsapp: s(u, "whatsapp"),
                email: s(u, "email"),
                address: s(u, "address"),
                notes: s(u, "notes"),
                active: u.active !== false,
                requires_prepayment: u.requires_prepayment === true,
              }
        )
      );
      setEditOpen(false);
    } catch (e: unknown) {
      setEditErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setEditLoading(false);
    }
  }

  function openAddContact(row: Row) {
    setContactErr("");
    setTargetCustomerId(s(row, "customer_id"));
    setTargetCustomerName(s(row, "customer_name") || "לקוח");
    setContactName("");
    setContactRole("");
    setContactPhone("");
    setContactEmail("");
    setContactWhatsapp("");
    setContactNotes("");
    setContactPrimary(false);
    setContactActive(true);
    setContactOpen(true);
  }

  async function createContact() {
    if (contactLoading) return;
    setContactErr("");
    if (!targetCustomerId) return setContactErr("חסר לקוח.");
    if (!contactName.trim()) return setContactErr("יש למלא שם איש קשר.");
    setContactLoading(true);
    try {
      const res = await fetch("/api/customer-contacts/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: targetCustomerId,
          full_name: contactName.trim(),
          role: contactRole.trim() || null,
          phone: contactPhone.trim() || null,
          email: contactEmail.trim() || null,
          whatsapp: contactWhatsapp.trim() || null,
          is_primary: contactPrimary,
          active: contactActive,
          notes: contactNotes.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; contact?: Row };
      if (!res.ok || !json.contact) return setContactErr(json.error ?? "יצירת איש קשר נכשלה.");
      setRows((prev) =>
        prev.map((row) => {
          if (s(row, "customer_id") !== targetCustomerId) return row;
          const current = contactsOf(row);
          let next = [json.contact as Row, ...current];
          if ((json.contact as Row).is_primary === true) {
            next = next.map((c, i) => (i === 0 ? c : { ...c, is_primary: false }));
          }
          return { ...row, contacts: next };
        })
      );
      setContactOpen(false);
    } catch (e: unknown) {
      setContactErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setContactLoading(false);
    }
  }

  function customerDetailsHref(customerId: string) {
    const base = `/customers/${encodeURIComponent(customerId)}`;
    return currentPage > 1 ? `${base}?return_page=${currentPage}` : base;
  }

  function openCustomerDetails(customerId: string) {
    if (!customerId) return;
    emitNavigationStart();
    window.location.href = customerDetailsHref(customerId);
  }

  function shouldIgnoreRowNavigation(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest("a, button, input, textarea, select, label"));
  }

  return (
    <PageStack>
      <AdaptiveGrid variant="customersToolbar">
        <AdaptiveCell variant="customersPrimary">
          <label className="text-sm text-muted-foreground">חיפוש לקוחות</label>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="שם, טלפון, אימייל או כתובת"
            className="h-11"
          />
        </AdaptiveCell>
        <AdaptiveCell variant="customersSecondary">
          <label className="text-sm text-muted-foreground opacity-0">מסננים</label>
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setFiltersOpen((x) => !x)}
          >
            {filtersOpen ? "הסתר מסננים" : "הצג מסננים"}
          </Button>
        </AdaptiveCell>
        <AdaptiveCell variant="customersSecondary">
          <label className="text-sm text-muted-foreground opacity-0">לקוח חדש</label>
          <Button type="button" className="h-11 w-full" onClick={() => setCreateOpen(true)}>
            הוספת לקוח
          </Button>
        </AdaptiveCell>
      </AdaptiveGrid>

      {filtersOpen ? (
        <AdaptiveGrid variant="customersFilters">
          <FilterSelect
            label="פרויקטים"
            value={withProjects}
            onChange={setWithProjects}
            yes="עם פרויקטים"
            no="ללא פרויקטים"
          />
          <FilterSelect
            label="הזמנות"
            value={withOrders}
            onChange={setWithOrders}
            yes="עם הזמנות"
            no="ללא הזמנות"
          />
          <FilterSelect
            label="חוב פתוח"
            value={withDebt}
            onChange={setWithDebt}
            yes="חייבים כסף"
            no="ללא חוב"
          />
          <FilterSelect
            label="סטטוס"
            value={activeOnly}
            onChange={setActiveOnly}
            yes="פעילים"
            no="לא פעילים"
          />
        </AdaptiveGrid>
      ) : null}

      <div className="text-sm text-muted-foreground">נמצאו {filtered.length} לקוחות</div>

      <div className="space-y-2 md:hidden">
        {filtered.map((row) => {
          const id = s(row, "customer_id");
          const customerName = s(row, "customer_name") || "לקוח";
          const linkedMorningClientId = s(row, "morning_client_id");
          const openBalance = n(row, "open_balance");
          return (
            <Card key={id || customerName} className="overflow-hidden">
              <CardContent className="p-0">
                <AdaptiveGrid variant="customerCard">
                <NavLink
                  to={customerDetailsHref(id)}
                  className="min-w-0 text-right leading-tight"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{customerName}</span>
                    {row.requires_prepayment === true ? (
                      <Badge className={customerFlagBadgeClass("danger")}>תשלום מראש</Badge>
                    ) : null}
                    {openBalance > 0 ? (
                      <Badge className={customerFlagBadgeClass("danger")}>
                        חוב פתוח
                      </Badge>
                    ) : null}
                    {row.active === false ? (
                      <Badge className={customerFlagBadgeClass("danger")}>
                        לא פעיל
                      </Badge>
                    ) : null}
                    {linkedMorningClientId ? <Badge className={customerFlagBadgeClass("success")}>Morning</Badge> : null}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {s(row, "email") || "-"} | {s(row, "phone") || "-"}
                  </div>
                </NavLink>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {linkedMorningClientId ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={morningClientUrl(linkedMorningClientId)} target="_blank" rel="noreferrer">
                        פתיחת Morning
                      </a>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/projects?create=1&customer_id=${encodeURIComponent(id)}`}>
                      הוספת פרויקט
                    </Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link href={`/sales/orders/new?customer_id=${encodeURIComponent(id)}`}>
                      הוספת הזמנה
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openCustomerDetails(id)}
                  >
                    פרטי לקוח
                  </Button>
                </div>
                </AdaptiveGrid>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="hidden overflow-hidden border-border/70 shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="border-b border-border/70 text-right">
                <th className="px-4 py-3 font-medium">לקוח</th>
                <th className="px-4 py-3 font-medium">טלפון ואימייל</th>
                <th className="px-4 py-3 font-medium">כתובת</th>
                <th className="px-4 py-3 font-medium">Morning</th>
                <th className="px-4 py-3 font-medium">תשלום</th>
                <th className="px-4 py-3 font-medium">הזמנות</th>
                <th className="px-4 py-3 font-medium">פרויקטים</th>
                <th className="px-4 py-3 font-medium">יתרה פתוחה</th>
                <th className="px-4 py-3 font-medium">סטטוס</th>
                <th className="px-4 py-3 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {filtered.map((row) => {
                const id = s(row, "customer_id");
                const customerName = s(row, "customer_name") || "לקוח";
                const linkedMorningClientId = s(row, "morning_client_id");
                const openBalance = n(row, "open_balance");

                return (
                  <tr
                    key={`${id || customerName}-desktop`}
                    className="cursor-pointer align-top hover:bg-muted/20 focus-visible:bg-muted/20"
                    tabIndex={0}
                    role="link"
                    onClick={(event) => {
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      openCustomerDetails(id);
                    }}
                    onKeyDown={(event) => {
                      if (shouldIgnoreRowNavigation(event.target)) return;
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openCustomerDetails(id);
                    }}
                  >
                    <td className="px-4 py-4">
                      <div className="min-w-0 text-right">
                        <div className="font-medium">{customerName}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="min-w-[220px]">
                        <div>{s(row, "phone") || "-"}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{s(row, "email") || "-"}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="max-w-[260px] text-muted-foreground">{s(row, "address") || "-"}</div>
                    </td>
                    <td className="px-4 py-4">
                      {linkedMorningClientId ? (
                        <a href={morningClientUrl(linkedMorningClientId)} target="_blank" rel="noreferrer">
                          <Badge className={customerFlagBadgeClass("success")}>Morning</Badge>
                        </a>
                      ) : (
                        <Badge className={customerFlagBadgeClass("neutral")}>ללא</Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {row.requires_prepayment === true ? (
                        <Badge className={customerFlagBadgeClass("danger")}>תשלום מראש</Badge>
                      ) : (
                        <Badge className={customerFlagBadgeClass("neutral")}>רגיל</Badge>
                      )}
                    </td>
                    <td className="px-4 py-4">{n(row, "orders_count")}</td>
                    <td className="px-4 py-4">{n(row, "projects_count")}</td>
                    <td className="px-4 py-4 font-medium">{ils(openBalance)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {row.requires_prepayment === true ? (
                          <Badge className={customerFlagBadgeClass("danger")}>תשלום מראש</Badge>
                        ) : null}
                        {openBalance > 0 ? (
                          <Badge className={customerFlagBadgeClass("danger")}>
                            חוב פתוח
                          </Badge>
                        ) : null}
                        {row.active === false ? (
                          <Badge className={customerFlagBadgeClass("danger")}>
                            לא פעיל
                          </Badge>
                        ) : (
                          <Badge className={customerFlagBadgeClass("success")}>
                            פעיל
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[320px] flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/projects?create=1&customer_id=${encodeURIComponent(id)}`}>
                            הוספת פרויקט
                          </Link>
                        </Button>
                        <Button asChild size="sm">
                          <Link href={`/sales/orders/new?customer_id=${encodeURIComponent(id)}`}>
                            הוספת הזמנה
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <CreateCustomerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        description="שדות חובה: שם, טלפון ועיר."
        onCreated={(customer: CreatedCustomer, contacts) => {
          setRows((prev) => [
            {
              customer_id: customer.id,
              customer_name: customer.name,
              name: customer.name,
              name_for_invoice: customer.name_for_invoice,
              registration_number: customer.registration_number,
              email: customer.email,
              phone: customer.phone,
              whatsapp: customer.whatsapp,
              address: customer.address,
              active: customer.active,
              requires_prepayment: customer.requires_prepayment,
              orders_count: 0,
              projects_count: 0,
              total_sales: 0,
              total_paid: 0,
              open_balance: 0,
              contacts,
            },
            ...prev,
          ]);
        }}
      />

      <CustomerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        title="עריכת לקוח"
        description="עדכון פרטי לקוח ופרטי חשבונית."
        submitLabel={editLoading ? "שומר..." : "שמירת שינויים"}
        onSubmit={() => void saveEdit()}
        error={editErr}
        submitting={editLoading}
      >
        <Field label="שם לקוח *">
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
        </Field>
        <AdaptiveGrid variant="formTwo">
          <Field label="טלפון">
            <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          </Field>
          <Field label="וואטסאפ">
            <Input value={editWhatsapp} onChange={(e) => setEditWhatsapp(e.target.value)} />
          </Field>
          <Field label="אימייל">
            <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
          </Field>
        </AdaptiveGrid>
        <Field label="שם לחשבונית">
          <Input value={editInvoiceName} onChange={(e) => setEditInvoiceName(e.target.value)} placeholder="אם שונה משם הלקוח" />
        </Field>
        <Field label="ח.פ / ת.ז">
          <Input value={editReg} onChange={(e) => setEditReg(e.target.value)} />
        </Field>
        <Field label="כתובת">
          <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
        </Field>
        <Field label="הערות">
          <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={editRequiresPrepayment}
            onChange={(e) => setEditRequiresPrepayment(e.target.checked)}
          />
          <span>לקוח ברשימת תשלום מראש</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={editActive}
            onChange={(e) => setEditActive(e.target.checked)}
          />
          <span>לקוח פעיל</span>
        </label>
      </CustomerDialog>

      <CustomerDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        title="הוספת איש קשר"
        description={`לקוח: ${targetCustomerName}`}
        submitLabel={contactLoading ? "יוצר..." : "יצירת איש קשר"}
        onSubmit={() => void createContact()}
        error={contactErr}
        submitting={contactLoading}
      >
        <Field label="שם מלא *">
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="תפקיד">
          <Input value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
        </Field>
        <AdaptiveGrid variant="formTwo">
          <Field label="טלפון">
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
          <Field label="וואטסאפ">
            <Input value={contactWhatsapp} onChange={(e) => setContactWhatsapp(e.target.value)} />
          </Field>
        </AdaptiveGrid>
        <Field label="אימייל">
          <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </Field>
        <Field label="הערות">
          <Textarea
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
            rows={3}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={contactPrimary}
            onChange={(e) => setContactPrimary(e.target.checked)}
          />
          <span>איש קשר ראשי</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={contactActive}
            onChange={(e) => setContactActive(e.target.checked)}
          />
          <span>פעיל</span>
        </label>
      </CustomerDialog>
    </PageStack>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  yes,
  no,
}: {
  label: string;
  value: FilterMode;
  onChange: (v: FilterMode) => void;
  yes: string;
  no: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted-foreground">{label}</label>
      <select
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as FilterMode)}
      >
        <option value="all">הכל</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function ValueField({
  label,
  value,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={`rounded-xl border bg-background px-3 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium leading-6 text-foreground ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CustomerDetailsDialog({
  row,
  open,
  onOpenChange,
  onEdit,
  onAddContact,
}: {
  row: Row | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onEdit: (row: Row) => void;
  onAddContact: (row: Row) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();
  const [navigationTarget, setNavigationTarget] = useState<"projects" | "sales" | "financial" | "documents" | "">("");
  const contacts = row ? contactsOf(row) : [];
  const activeContacts = contacts.filter((c) => c.active !== false);
  const inactiveContacts = contacts.filter((c) => c.active === false);
  const id = row ? s(row, "customer_id") : "";

  function navigateToCustomerPage(
    target: "projects" | "sales" | "financial" | "documents",
    path: string
  ) {
    if (!id) return;
    setNavigationTarget(target);
    startNavigation(() => {
      router.push(path);
    });
  }

  const customerNameParam = row ? s(row, "customer_name").trim() : "";
  const customerPageParam = (searchParams.get("page") ?? "").trim();
  const name = row ? s(row, "customer_name") || "לקוח" : "לקוח";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialog size="details4xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>פרטי לקוח, אנשי קשר וקישורים מהירים.</DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="space-y-4">
            <AdaptiveGrid variant="customerStats">
              <Stat label="הזמנות" value={`${n(row, "orders_count")}`} />
              <Stat label="פרויקטים" value={`${n(row, "projects_count")}`} />
              <Stat label='סה"כ מכירות' value={ils(n(row, "total_sales"))} />
              <Stat label="יתרה פתוחה" value={ils(n(row, "open_balance"))} />
            </AdaptiveGrid>

            <AdaptiveGrid variant="customerPanels">
              <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
                <div className="font-semibold">פרטי לקוח</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ValueField label="שם לחשבונית" value={s(row, "name_for_invoice") || "-"} />
                  <ValueField label="ח.פ/ת.ז" value={s(row, "registration_number") || "-"} />
                  <ValueField label="וואטסאפ" value={s(row, "whatsapp") || "-"} />
                  <ValueField label="הזמנה אחרונה" value={dateText(s(row, "last_order_at"))} />
                  <ValueField label="תשלום אחרון" value={dateText(s(row, "last_payment_at"))} />
                  <ValueField
                    label="כתובת"
                    value={s(row, "address") || "-"}
                    className="sm:col-span-2"
                    valueClassName="whitespace-pre-wrap"
                  />
                  <ValueField
                    label="הערות"
                    value={s(row, "notes") || "-"}
                    className="sm:col-span-2"
                    valueClassName="whitespace-pre-wrap"
                  />
                </div>
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => onEdit(row)}>
                    עריכת לקוח
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "projects",
                        `/projects?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "projects" ? "פותח פרויקטים..." : "צפייה בפרויקטים"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "sales",
                        `/sales?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "sales" ? "פותח הזמנות..." : "צפייה בהזמנות"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "financial",
                        `/financial?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "financial" ? "פותח מידע פיננסי..." : "מידע פיננסי"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!id || isNavigating}
                    onClick={() =>
                      navigateToCustomerPage(
                        "documents",
                        `/documents?customer_id=${encodeURIComponent(id)}${
                          customerNameParam
                            ? `&customer_name=${encodeURIComponent(customerNameParam)}`
                            : ""
                        }${customerPageParam ? `&customer_page=${encodeURIComponent(customerPageParam)}` : ""}`
                      )
                    }
                  >
                    {isNavigating && navigationTarget === "documents" ? "פותח מסמכים..." : "קבלות ומסמכים"}
                  </Button>
                </div>
              </div>

              <MorningCustomerCard
                customerId={id}
                morningClientId={s(row, "morning_client_id") || null}
                morningMatchStatus={s(row, "morning_match_status") || null}
                morningSyncedAt={s(row, "morning_synced_at") || null}
                morningLastSyncError={s(row, "morning_last_sync_error") || null}
                morningDocuments={Array.isArray(row.morning_documents) ? (row.morning_documents as never[]) : []}
                onChanged={() => router.refresh()}
              />

              <div className="space-y-2 rounded-md border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">אנשי קשר</div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onAddContact(row)}
                  >
                    הוספת איש קשר
                  </Button>
                </div>
                {contacts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">אין אנשי קשר ללקוח זה.</p>
                ) : null}
                {activeContacts.map((c, i) => (
                  <div key={s(c, "id") || `${id}-active-${i}`} className="rounded-md border p-2 text-sm">
                    <div className="font-medium">
                      {s(c, "full_name") || `איש קשר ${i + 1}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s(c, "role") || "ללא תפקיד"} | {s(c, "phone") || "-"} |{" "}
                      {s(c, "email") || "-"}
                    </div>
                  </div>
                ))}
                {inactiveContacts.length > 0 ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2">
                    <div className="mb-1 text-xs font-medium text-red-700">
                      אנשי קשר לא פעילים
                    </div>
                    {inactiveContacts.map((c, i) => (
                      <div
                        key={s(c, "id") || `${id}-inactive-${i}`}
                        className="text-xs text-red-700"
                      >
                        {s(c, "full_name") || `איש קשר ${i + 1}`} | {s(c, "phone") || "-"}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </AdaptiveGrid>

          </div>
        ) : null}
      </AdaptiveDialog>
    </Dialog>
  );
}

function CustomerDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
  error,
  submitting = false,
  children,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: () => void;
  error: string;
  submitting?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <AdaptiveDialog size="formLg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <fieldset disabled={submitting} className="space-y-3">
            {children}
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={submitting}>{submitLabel}</Button>
          </DialogFooter>
          {submitting ? <p className="text-xs text-muted-foreground">שומר, נא להמתין...</p> : null}
        </form>
      </AdaptiveDialog>
    </Dialog>
  );
}
