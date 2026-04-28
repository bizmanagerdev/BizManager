"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AdaptiveCell,
  AdaptiveDialog,
  AdaptiveGrid,
  PageStack,
} from "@/components/layout/page-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatShortDate } from "@/lib/date";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Row = Record<string, unknown>;
type FilterMode = "all" | "yes" | "no";
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

const CITY_OPTIONS = [
  "ירושלים",
  "בני-ברק",
  "אלעד",
  "ביתר עילית",
  "בית שמש",
  "אשדוד",
  "דימונה",
  "מירון",
  "תל אביב",
  "פתח תקווה",
  "חיפה",
  "נתניה",
  "באר שבע",
  "ראשון לציון",
  "אחר",
];

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
const makeEmptyContactDraft = (): ContactDraft => ({
  full_name: "",
  role: "",
  phone: "",
  email: "",
  whatsapp: "",
  notes: "",
  is_primary: false,
  active: true,
});

export default function CustomersClient({
  initialRows,
  initialDetailsCustomerId = "",
}: {
  initialRows: Row[];
  initialDetailsCustomerId?: string;
}) {
  const [rows, setRows] = useState(initialRows);
  const [detailsCustomerId, setDetailsCustomerId] = useState(initialDetailsCustomerId);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [withProjects, setWithProjects] = useState<FilterMode>("all");
  const [withOrders, setWithOrders] = useState<FilterMode>("all");
  const [withDebt, setWithDebt] = useState<FilterMode>("all");
  const [activeOnly, setActiveOnly] = useState<FilterMode>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [city, setCity] = useState("");
  const [cityOther, setCityOther] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [createContacts, setCreateContacts] = useState<ContactDraft[]>([]);

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

  const detailsRow = useMemo(
    () => rows.find((row) => s(row, "customer_id") === detailsCustomerId) ?? null,
    [rows, detailsCustomerId]
  );

  useEffect(() => {
    if (!initialDetailsCustomerId) return;
    setDetailsCustomerId((current) => current || initialDetailsCustomerId);
  }, [initialDetailsCustomerId]);

  function resetCreateForm() {
    setName("");
    setEmail("");
    setPhone("");
    setWhatsapp("");
    setCity("");
    setCityOther("");
    setAddress("");
    setNotes("");
    setCreateContacts([]);
  }

  function addCreateContact() {
    setCreateContacts((prev) => {
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

  function updateCreateContact(index: number, patch: Partial<ContactDraft>) {
    setCreateContacts((prev) =>
      prev.map((contact, currentIndex) => {
        if (currentIndex !== index) {
          if (patch.is_primary) return { ...contact, is_primary: false };
          return contact;
        }
        const next = { ...contact, ...patch };
        if (patch.active === false) {
          next.is_primary = false;
        }
        return next;
      })
    );
  }

  function removeCreateContact(index: number) {
    setCreateContacts((prev) => {
      const next = prev.filter((_, currentIndex) => currentIndex !== index);
      if (next.length === 0) return next;
      if (next.some((contact) => contact.is_primary)) return next;
      return next.map((contact, currentIndex) =>
        currentIndex === 0 ? { ...contact, is_primary: true } : contact
      );
    });
  }

  async function createCustomer() {
    if (createLoading) return;
    setCreateErr("");
    const finalCity = city === "אחר" ? cityOther.trim() : city.trim();
    if (!name.trim()) return setCreateErr("יש למלא שם לקוח.");
    if (!finalCity) return setCreateErr("יש לבחור עיר.");
    const preparedContacts = createContacts
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
      return setCreateErr(`Contact ${invalidContactIndex + 1} is missing a full name.`);
    }
    const hasPrimaryContact = preparedContacts.some((contact) => contact.is_primary);
    const normalizedContacts = preparedContacts.map((contact, index) => ({
      ...contact,
      is_primary: hasPrimaryContact ? contact.is_primary : index === 0,
    }));
    setCreateLoading(true);
    try {
      const res = await fetch("/api/customers/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          city: finalCity,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; customer?: Row };
      if (!res.ok || !json.customer) return setCreateErr(json.error ?? "יצירת הלקוח נכשלה.");
      const customer = json.customer;
      const newId = s(customer, "id");
      const customerRow: Row = {
        customer_id: newId,
        customer_name: s(customer, "name") || name.trim(),
        name: s(customer, "name") || name.trim(),
        email: s(customer, "email") || email.trim(),
        phone: s(customer, "phone") || phone.trim(),
        whatsapp: s(customer, "whatsapp") || whatsapp.trim(),
        address: s(customer, "address") || finalCity || address.trim(),
        active: customer.active !== false,
        orders_count: 0,
        projects_count: 0,
        total_sales: 0,
        total_paid: 0,
        open_balance: 0,
        contacts: [],
      };
      const createdContacts: Row[] = [];
      for (const contact of normalizedContacts) {
        const contactRes = await fetch("/api/customer-contacts/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_id: newId,
            ...contact,
          }),
        });
        const contactJson = (await contactRes.json().catch(() => ({}))) as {
          error?: string;
          contact?: Row;
        };
        if (!contactRes.ok || !contactJson.contact) {
          const detail = contact.full_name || `#${createdContacts.length + 1}`;
          setRows((prev) => [{ ...customerRow, contacts: createdContacts }, ...prev]);
          setCreateOpen(false);
          resetCreateForm();
          if (typeof window !== "undefined") {
            window.alert(
              contactJson.error ??
                `The customer was created, but contact ${detail} could not be created.`
            );
          }
          return;
        }
        createdContacts.push(contactJson.contact);
      }
      setRows((prev) => [{ ...customerRow, contacts: createdContacts }, ...prev]);
      setCreateOpen(false);
      resetCreateForm();
    } catch (e: unknown) {
      setCreateErr(e instanceof Error ? e.message : "שגיאה לא ידועה");
    } finally {
      setCreateLoading(false);
    }
  }

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

      <div className="space-y-2">
        {filtered.map((row) => {
          const id = s(row, "customer_id");
          const customerName = s(row, "customer_name") || "לקוח";
          return (
            <Card key={id || customerName} className="overflow-hidden">
              <CardContent>
                <AdaptiveGrid variant="customerCard">
                <button
                  type="button"
                  className="min-w-0 text-right"
                  onClick={() => setDetailsCustomerId(id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">{customerName}</span>
                    {row.active === false ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        לא פעיל
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {s(row, "email") || "-"} | {s(row, "phone") || "-"}
                  </div>
                </button>
                <div className="flex flex-wrap items-center justify-end gap-2">
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
                    onClick={() => setDetailsCustomerId(id)}
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

      <CustomerDetailsDialog
        row={detailsRow}
        open={Boolean(detailsRow)}
        onOpenChange={(next) => {
          if (!next) setDetailsCustomerId("");
        }}
        onEdit={openEdit}
        onAddContact={openAddContact}
      />

      <CustomerDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next && !createLoading) {
            setCreateErr("");
            resetCreateForm();
          }
        }}
        title="הוספת לקוח"
        description="שדות חובה: שם ועיר."
        submitLabel={createLoading ? "יוצר..." : "יצירת לקוח"}
        onSubmit={() => void createCustomer()}
        error={createErr}
        submitting={createLoading}
      >
        <Field label="שם לקוח *">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="טלפון">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="וואטסאפ">
          <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
        </Field>
        <Field label="אימייל">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="עיר *">
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">בחירת עיר...</option>
            {CITY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        {city === "אחר" ? (
          <Field label="עיר (הקלדה ידנית) *">
            <Input value={cityOther} onChange={(e) => setCityOther(e.target.value)} />
          </Field>
        ) : null}
        <Field label="כתובת">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="הערות">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Contact People</div>
              <div className="text-xs text-muted-foreground">
                Add the people we should be able to reach for this customer.
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addCreateContact}>
              Add Contact
            </Button>
          </div>
          {createContacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No contacts added yet.</p>
          ) : null}
          {createContacts.map((contact, index) => (
            <div
              key={`create-contact-${index}`}
              className="space-y-3 rounded-md border bg-background p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Contact {index + 1}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeCreateContact(index)}
                >
                  Remove
                </Button>
              </div>
              <Field label="Full Name *">
                <Input
                  value={contact.full_name}
                  onChange={(e) =>
                    updateCreateContact(index, { full_name: e.target.value })
                  }
                />
              </Field>
              <Field label="Role">
                <Input
                  value={contact.role}
                  onChange={(e) => updateCreateContact(index, { role: e.target.value })}
                />
              </Field>
              <AdaptiveGrid variant="formTwo">
                <Field label="Phone">
                  <Input
                    value={contact.phone}
                    onChange={(e) => updateCreateContact(index, { phone: e.target.value })}
                  />
                </Field>
                <Field label="WhatsApp">
                  <Input
                    value={contact.whatsapp}
                    onChange={(e) =>
                      updateCreateContact(index, { whatsapp: e.target.value })
                    }
                  />
                </Field>
              </AdaptiveGrid>
              <Field label="Email">
                <Input
                  value={contact.email}
                  onChange={(e) => updateCreateContact(index, { email: e.target.value })}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={contact.notes}
                  onChange={(e) => updateCreateContact(index, { notes: e.target.value })}
                  rows={2}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={contact.is_primary}
                  onChange={(e) =>
                    updateCreateContact(index, {
                      is_primary: e.target.checked,
                      active: e.target.checked ? true : contact.active,
                    })
                  }
                />
                <span>Primary Contact</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={contact.active}
                  onChange={(e) =>
                    updateCreateContact(index, { active: e.target.checked })
                  }
                />
                <span>Active</span>
              </label>
            </div>
          ))}
        </div>
      </CustomerDialog>

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
        <Field label="שם לחשבונית">
          <Input value={editInvoiceName} onChange={(e) => setEditInvoiceName(e.target.value)} />
        </Field>
        <Field label="ח.פ / ת.ז">
          <Input value={editReg} onChange={(e) => setEditReg(e.target.value)} />
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
        <Field label="כתובת">
          <Input value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
        </Field>
        <Field label="הערות">
          <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
        </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

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
                <div>
                  <span className="text-muted-foreground">שם לחשבונית:</span>{" "}
                  {s(row, "name_for_invoice") || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">ח.פ/ת.ז:</span>{" "}
                  {s(row, "registration_number") || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">כתובת:</span> {s(row, "address") || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">וואטסאפ:</span> {s(row, "whatsapp") || "-"}
                </div>
                <div>
                  <span className="text-muted-foreground">הזמנה אחרונה:</span>{" "}
                  {dateText(s(row, "last_order_at"))}
                </div>
                <div>
                  <span className="text-muted-foreground">תשלום אחרון:</span>{" "}
                  {dateText(s(row, "last_payment_at"))}
                </div>
                <div>
                  <span className="text-muted-foreground">הערות:</span> {s(row, "notes") || "-"}
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => onEdit(row)}>
                  עריכת לקוח
                </Button>
              </div>

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

            <div className="flex flex-wrap gap-2">
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
