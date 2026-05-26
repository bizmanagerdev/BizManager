import AppShell from "@/components/layout/AppShell";
import MorningCustomerCard from "@/components/morning/MorningCustomerCard";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import { formatShortDate } from "@/lib/date";
import type { MorningLocalDocument } from "@/lib/morning/types";
import { notFound } from "next/navigation";
import DeleteCustomerButton from "./DeleteCustomerButton";
import EditCustomerButton from "./EditCustomerButton";

type Row = Record<string, unknown>;

function s(row: Row | null | undefined, key: string) {
  return typeof row?.[key] === "string" ? row[key] : "";
}

function n(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  return value ? formatShortDate(value) : "-";
}

function rowDateValue(value: string | null) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function customerFlagBadgeClass(tone: "success" | "danger" | "neutral") {
  switch (tone) {
    case "success":
      return "bg-success text-success-foreground border-transparent";
    case "danger":
      return "bg-destructive text-destructive-foreground border-transparent";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function DetailField({
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
    <div className={`rounded-2xl border border-border/70 bg-background/70 px-4 py-3 ${className}`.trim()}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={`mt-2 text-sm font-medium leading-6 text-foreground ${valueClassName}`.trim()}>{value}</div>
    </div>
  );
}

export default async function CustomerDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ return_page?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams) ?? {};
  const returnPage = parsePage(query.return_page);
  const { profile, supabase } = await requireProfile();

  const [{ data: overview }, { data: customer }, { data: contacts }, { data: morningDocuments }] =
    await Promise.all([
      supabase
        .from("customer_overview_view")
        .select(
          "customer_id,customer_name,email,phone,orders_count,projects_count,total_sales,total_paid,open_balance,last_order_at,last_payment_at,address,active,notes,name_for_invoice,registration_number"
        )
        .eq("customer_id", id)
        .maybeSingle(),
      supabase
        .from("customers")
        .select(
          "id,name,name_for_invoice,registration_number,email,phone,whatsapp,address,notes,active,requires_prepayment,morning_client_id,morning_synced_at,morning_match_status,morning_last_sync_error"
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("contacts")
        .select("id,customer_id,full_name,role,phone,email,whatsapp,is_primary,active,notes")
        .eq("customer_id", id)
        .order("is_primary", { ascending: false })
        .order("full_name", { ascending: true }),
      supabase
        .from("morning_documents")
        .select(
          "id,morning_document_id,morning_document_number,document_type,document_type_label,status,customer_id,order_id,project_id,payment_id,document_id,morning_client_id,amount,currency,morning_url,pdf_url,issued_at,closed_at,notes"
        )
        .eq("customer_id", id)
        .order("issued_at", { ascending: false }),
    ]);

  if (!overview && !customer) {
    notFound();
  }

  const { data: projectRows } = await supabase
    .from("projects")
    .select("id,customer_id,agreed_base_price,actual_price")
    .eq("customer_id", id);

  const projectIds = ((projectRows ?? []) as Row[])
    .map((row) => s(row, "id"))
    .filter(Boolean);

  const [{ data: projectFinancialRows }, { data: projectPaymentRows }] =
    projectIds.length > 0
      ? await Promise.all([
          supabase
            .from("project_financials_view")
            .select("id,customer_total_price,expenses_billed")
            .in("id", projectIds),
          supabase
            .from("payments")
            .select("project_id,amount_total,payment_date")
            .in("project_id", projectIds),
        ])
      : [{ data: [] }, { data: [] }];

  const financialByProjectId = new Map<string, Row>();
  ((projectFinancialRows ?? []) as Row[]).forEach((row) => {
    const projectId = s(row, "id");
    if (projectId) financialByProjectId.set(projectId, row);
  });

  const paidByProjectId = new Map<string, number>();
  const lastPaymentByProjectId = new Map<string, string>();
  ((projectPaymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = s(row, "project_id");
    if (!projectId) return;
    paidByProjectId.set(projectId, (paidByProjectId.get(projectId) ?? 0) + n(row.amount_total));
    const paymentDate = s(row, "payment_date");
    const current = lastPaymentByProjectId.get(projectId) ?? "";
    if (paymentDate && (!current || paymentDate > current)) {
      lastPaymentByProjectId.set(projectId, paymentDate);
    }
  });

  let projectTotalSales = 0;
  let projectTotalPaid = 0;
  let projectLastPaymentAt: string | null = null;

  ((projectRows ?? []) as Row[]).forEach((row) => {
    const projectId = s(row, "id");
    if (!projectId) return;
    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = n(row.actual_price);
    const agreedBasePrice = n(row.agreed_base_price);
    const expensesBilled = n(financialRow?.expenses_billed);
    const fallbackTotal =
      (actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0) + expensesBilled;
    const customerTotalPrice = Math.max(n(financialRow?.customer_total_price), fallbackTotal);
    projectTotalSales += customerTotalPrice;
    projectTotalPaid += paidByProjectId.get(projectId) ?? 0;

    const paymentDate = lastPaymentByProjectId.get(projectId) ?? null;
    if (paymentDate && (!projectLastPaymentAt || rowDateValue(paymentDate) > rowDateValue(projectLastPaymentAt))) {
      projectLastPaymentAt = paymentDate;
    }
  });

  const customerName =
    s(customer as Row, "name") || s(overview as Row, "customer_name") || s(customer as Row, "name_for_invoice") || "לקוח";
  const customerPhone = s(customer as Row, "phone") || s(overview as Row, "phone");
  const customerEmail = s(customer as Row, "email") || s(overview as Row, "email");
  const customerWhatsapp = s(customer as Row, "whatsapp");
  const requiresPrepayment = customer?.requires_prepayment === true;
  const address = s(customer as Row, "address") || s(overview as Row, "address");
  const orderSales = n((overview as Row)?.total_sales);
  const orderPaid = n((overview as Row)?.total_paid);
  const totalSales = orderSales + projectTotalSales;
  const totalPaid = orderPaid + projectTotalPaid;
  const openBalance = Math.max(totalSales - totalPaid, 0);
  const lastOrderAt = s(overview as Row, "last_order_at") || null;
  const overviewLastPaymentAt = s(overview as Row, "last_payment_at") || null;
  const lastPaymentAt =
    projectLastPaymentAt && rowDateValue(projectLastPaymentAt) > rowDateValue(overviewLastPaymentAt)
      ? projectLastPaymentAt
      : overviewLastPaymentAt;
  const activeContacts = ((contacts ?? []) as Row[]).filter((contact) => contact.active !== false);
  const inactiveContacts = ((contacts ?? []) as Row[]).filter((contact) => contact.active === false);
  const customerNameParam = customerName.trim();
  const returnCustomersHref = returnPage > 1 ? `/customers?page=${returnPage}` : "/customers";
  const addContactHref = `${returnCustomersHref}${returnPage > 1 ? "&" : "?"}add_contact_customer_id=${encodeURIComponent(id)}`;

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{customerName}</h1>
            <p className="text-sm text-muted-foreground">מרכז לקוח עם פרטי קשר, יתרה, Morning וקישורים מהירים.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <NavLink to={returnCustomersHref}>חזרה ללקוחות</NavLink>
            </Button>
            <EditCustomerButton
              customer={{
                id,
                name: customerName,
                name_for_invoice: s(customer as Row, "name_for_invoice") || null,
                registration_number: s(customer as Row, "registration_number") || null,
                phone: customerPhone || null,
                whatsapp: customerWhatsapp || null,
                email: customerEmail || null,
                address: address || null,
                notes: s(customer as Row, "notes") || null,
                active: customer?.active !== false,
                requires_prepayment: requiresPrepayment,
                contacts: (contacts ?? []) as Row[],
              }}
            />
            <Button asChild variant="outline" size="sm">
              <NavLink to={addContactHref}>הוספת איש קשר</NavLink>
            </Button>
            <DeleteCustomerButton
              customerId={id}
              customerName={customerName}
              returnHref={returnCustomersHref}
            />
          </div>
        </div>

        <section className="space-y-4 rounded-3xl border border-border/70 bg-card/80 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">לקוח #{id.slice(0, 8)}</div>
              <div className="text-2xl font-semibold">{customerName}</div>
              {(() => {
                const invoiceName = s(customer as Row, "name_for_invoice");
                const registrationNumber = s(customer as Row, "registration_number");
                const showInvoiceName = invoiceName && invoiceName !== customerName;
                if (!showInvoiceName && !registrationNumber) return null;
                return (
                  <div className="text-sm text-muted-foreground">
                    {[
                      showInvoiceName ? `שם לחשבונית: ${invoiceName}` : null,
                      registrationNumber ? `ח.פ / ת.ז: ${registrationNumber}` : null,
                    ]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                );
              })()}
              <div className="text-sm text-muted-foreground">
                {[customerPhone, customerEmail].filter(Boolean).join(" • ") || "-"}
              </div>
              <div className="text-sm text-muted-foreground">{address || "-"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {requiresPrepayment ? (
                <Badge className={customerFlagBadgeClass("danger")}>תשלום מראש</Badge>
              ) : null}
              {openBalance > 0 ? <Badge className={customerFlagBadgeClass("danger")}>חוב פתוח</Badge> : null}
              {(customer?.active ?? overview?.active) === false ? (
                <Badge className={customerFlagBadgeClass("danger")}>לא פעיל</Badge>
              ) : (
                <Badge className={customerFlagBadgeClass("success")}>פעיל</Badge>
              )}
              {s(customer as Row, "morning_client_id") ? (
                <Badge className={customerFlagBadgeClass("success")}>Morning</Badge>
              ) : (
                <Badge className={customerFlagBadgeClass("neutral")}>ללא Morning</Badge>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="הזמנות" value={`${n((overview as Row)?.orders_count)}`} />
            <Stat label="פרויקטים" value={`${Math.max(n((overview as Row)?.projects_count), projectIds.length)}`} />
            <Stat label='סה"כ מכירות' value={formatCurrency(totalSales)} />
            <Stat label="שולם" value={formatCurrency(totalPaid)} />
            <Stat label="יתרה פתוחה" value={formatCurrency(openBalance)} />
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="mb-3 text-sm font-semibold">פרטי לקוח</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="טלפון" value={customerPhone || "-"} />
                <DetailField label="וואטסאפ" value={customerWhatsapp || "-"} />
                <DetailField label="אימייל" value={customerEmail || "-"} valueClassName="break-all" />
                <DetailField label="שם לחשבונית" value={s(customer as Row, "name_for_invoice") || "-"} />
                <DetailField label="ח.פ / ת.ז" value={s(customer as Row, "registration_number") || "-"} />
                <DetailField label="הזמנה אחרונה" value={formatDate(lastOrderAt)} />
                <DetailField label="תשלום אחרון" value={formatDate(lastPaymentAt)} />
                <DetailField label="כתובת" value={address || "-"} className="sm:col-span-2" valueClassName="whitespace-pre-wrap" />
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="mb-3 text-sm font-semibold">קישורים מהירים</div>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <NavLink to={`/sales/orders/new?customer_id=${encodeURIComponent(id)}`}>הזמנה חדשה</NavLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <NavLink to={`/projects?create=1&customer_id=${encodeURIComponent(id)}`}>פרויקט חדש</NavLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <NavLink
                    to={`/sales?customer_id=${encodeURIComponent(id)}${
                      customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
                    }`}
                  >
                    צפייה בהזמנות
                  </NavLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <NavLink
                    to={`/projects?customer_id=${encodeURIComponent(id)}${
                      customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
                    }`}
                  >
                    צפייה בפרויקטים
                  </NavLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <NavLink
                    to={`/financial?customer_id=${encodeURIComponent(id)}${
                      customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
                    }`}
                  >
                    מידע פיננסי
                  </NavLink>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <NavLink
                    to={`/documents?customer_id=${encodeURIComponent(id)}${
                      customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
                    }`}
                  >
                    קבלות ומסמכים
                  </NavLink>
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">אנשי קשר</div>
                <Button asChild size="sm" variant="outline">
                  <NavLink to={addContactHref}>הוספת איש קשר</NavLink>
                </Button>
              </div>
              {activeContacts.length === 0 && inactiveContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">אין אנשי קשר ללקוח זה.</p>
              ) : (
                <div className="space-y-2">
                  {activeContacts.map((contact, index) => (
                    <div key={s(contact, "id") || `${id}-active-${index}`} className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{s(contact, "full_name") || `איש קשר ${index + 1}`}</div>
                        {contact.is_primary === true ? (
                          <Badge className={customerFlagBadgeClass("success")}>ראשי</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {s(contact, "role") || "ללא תפקיד"} • {s(contact, "phone") || "-"} • {s(contact, "email") || "-"}
                      </div>
                      {s(contact, "whatsapp") ? (
                        <div className="mt-1 text-muted-foreground">וואטסאפ: {s(contact, "whatsapp")}</div>
                      ) : null}
                      {s(contact, "notes") ? (
                        <div className="mt-1 text-muted-foreground">הערות: {s(contact, "notes")}</div>
                      ) : null}
                    </div>
                  ))}
                  {inactiveContacts.length > 0 ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-3 text-sm">
                      <div className="mb-2 font-medium text-destructive">אנשי קשר לא פעילים</div>
                      <div className="space-y-1 text-destructive">
                        {inactiveContacts.map((contact, index) => (
                          <div key={s(contact, "id") || `${id}-inactive-${index}`}>
                            {s(contact, "full_name") || `איש קשר ${index + 1}`} • {s(contact, "phone") || "-"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="mb-3 text-sm font-semibold">הערות</div>
              {s(customer as Row, "notes") || s(overview as Row, "notes") ? (
                <div className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm leading-6">
                  {s(customer as Row, "notes") || s(overview as Row, "notes")}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">אין הערות ללקוח זה.</p>
              )}
            </div>
          </div>

          <MorningCustomerCard
            customerId={id}
            morningClientId={s(customer as Row, "morning_client_id") || null}
            morningMatchStatus={s(customer as Row, "morning_match_status") || null}
            morningSyncedAt={s(customer as Row, "morning_synced_at") || null}
            morningLastSyncError={s(customer as Row, "morning_last_sync_error") || null}
            morningDocuments={(morningDocuments ?? []) as MorningLocalDocument[]}
          />
        </section>
      </div>
    </AppShell>
  );
}
