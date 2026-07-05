import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import MorningCustomerCard from "@/components/morning/MorningCustomerCard";
import { AddressLink } from "@/components/ui/address-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireProfile } from "@/lib/auth/requireProfile";
import { formatRelativeDateLabel, formatShortDate } from "@/lib/date";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";
import {
  getOrderStatusColor,
  getOrderStatusLabel,
  getProjectStatusColor,
  getProjectStatusLabel,
} from "@/lib/ui/status-colors";
import { splitPaymentAmounts, paymentMethodLabel } from "@/lib/orders/paymentStatus";
import { applyProjectVatToBase } from "@/lib/projects/vat";
import { getCustomerReceivables } from "@/lib/collections";
import { paymentTermsLabel } from "@/lib/paymentTerms";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { MorningLocalDocument } from "@/lib/morning/types";
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  FileText,
  FolderKanban,
  HandCoins,
  History,
  Mail,
  MapPin,
  MessageCircle,
  PencilLine,
  Phone,
  PhoneCall,
  ShoppingCart,
  UserRound,
} from "lucide-react";
import { getEntityAuditTrail } from "@/lib/audit";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import { notFound } from "next/navigation";
import AddContactButton from "./AddContactButton";
import AddCustomerDocumentButton from "./AddCustomerDocumentButton";
import CustomerCollectionSection from "./CustomerCollectionSection";
import PaymentPromises from "@/components/collections/PaymentPromises";
import { getCustomerPromises } from "@/lib/promises";
import CustomerNotesEditor from "./CustomerNotesEditor";
import DeleteCustomerButton from "./DeleteCustomerButton";
import EditCustomerButton from "./EditCustomerButton";

type Row = Record<string, unknown>;

function s(row: Row | null | undefined, key: string) {
  const v = row?.[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function n(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// One money format page-wide: no trailing ".00", decimals only when they exist.
function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
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

function laterDate(a: string | null, b: string | null) {
  return rowDateValue(a) >= rowDateValue(b) ? a : b;
}

function parsePage(value: string | undefined) {
  const page = Number(value ?? "1");
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

/** Short order reference, bidi-isolated so the # and hex don't scramble in RTL. */
function OrderRef({ orderId }: { orderId: string }) {
  return (
    <>
      הזמנה <span dir="ltr">#{orderId.slice(0, 8)}</span>
    </>
  );
}

function SectionCard({
  id,
  icon,
  title,
  aside,
  children,
}: {
  id?: string;
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <h2 className="text-sm font-semibold">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Slim one-line row for sections that have nothing yet — they shouldn't take
 *  the same footprint as full cards. */
function EmptySectionRow({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/50 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function CountPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  );
}

/** Quiet "+" action: filled tint, one visual step below the primary הזמנה button. */
const SOFT_ADD_BUTTON_CLASSES =
  "h-8 border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary";

const ORDERS_DISPLAY_LIMIT = 10;
const PROJECTS_DISPLAY_LIMIT = 10;
const PAYMENTS_DISPLAY_LIMIT = 10;
const DOCUMENTS_DISPLAY_LIMIT = 10;

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

  const [
    { data: customer },
    { data: contacts },
    { data: morningDocuments },
    { data: orderRows, error: ordersError },
    { data: projectRows, error: projectsError },
    receivables,
  ] = await Promise.all([
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
    // Per-order money comes from order_overview_view so the numbers here always
    // match the orders list (incl. the items-derived fallback for ₪0 orders).
    supabase
      .from("order_overview_view")
      .select(
        "order_id,order_date,status,total_amount,collected_amount,pending_amount,overdue_amount,remaining_balance,payment_count,next_due_date"
      )
      .eq("customer_id", id)
      .order("order_date", { ascending: false }),
    supabase
      .from("projects")
      .select("id,customer_id,name,status,start_date,end_date,agreed_base_price,actual_price,price_includes_vat,vat_rate")
      .eq("customer_id", id)
      .order("start_date", { ascending: false, nullsFirst: false }),
    // Term-aware days-late for the debt banner — same source the מעקב גבייה
    // panel uses, so the two never disagree.
    getCustomerReceivables(supabase, id).catch(() => []),
  ]);

  if (!customer) {
    notFound();
  }

  const orders = (orderRows ?? []) as Row[];
  const projects = (projectRows ?? []) as Row[];
  const orderIds = orders.map((row) => s(row, "order_id")).filter(Boolean);
  const projectIds = projects.map((row) => s(row, "id")).filter(Boolean);

  const [
    { data: projectFinancialRows },
    { data: projectPaymentRows },
    { data: orderPaymentRows },
    { data: customerDocLinks },
    { data: orderDocLinks },
    { data: projectDocLinks },
  ] = await Promise.all([
    projectIds.length > 0
      ? supabase
          .from("project_financials_view")
          .select("id,customer_total_price,expenses_billed")
          .in("id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
    projectIds.length > 0
      ? supabase
          .from("payments")
          .select(
            "id,project_id,amount_total,net_amount,payment_date,payment_method,payment_status,due_date,check_number"
          )
          .in("project_id", projectIds)
          .order("payment_date", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    orderIds.length > 0
      ? supabase
          .from("payments")
          .select(
            "id,order_id,amount_total,payment_date,payment_method,payment_status,due_date,check_number"
          )
          .in("order_id", orderIds)
          .order("payment_date", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] as Row[] }),
    supabase
      .from("document_links")
      .select("document_id,entity_type,entity_id")
      .eq("entity_type", "customer")
      .eq("entity_id", id),
    orderIds.length > 0
      ? supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id")
          .eq("entity_type", "order")
          .in("entity_id", orderIds)
      : Promise.resolve({ data: [] as Row[] }),
    projectIds.length > 0
      ? supabase
          .from("document_links")
          .select("document_id,entity_type,entity_id")
          .eq("entity_type", "project")
          .in("entity_id", projectIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);

  // --- Orders money: straight sum of the same per-order figures the list shows.
  let ordersSales = 0;
  let ordersCollected = 0;
  let ordersPending = 0;
  let ordersOverdue = 0;
  orders.forEach((order) => {
    ordersSales += n(order.total_amount);
    ordersCollected += n(order.collected_amount);
    ordersPending += n(order.pending_amount);
    ordersOverdue += n(order.overdue_amount);
  });
  const lastOrderAt = orders.reduce<string | null>(
    (latest, order) => laterDate(latest, s(order, "order_date") || null),
    null
  );

  // --- Projects money: COLLECTION SPLIT — collected = money actually in;
  // expected = future-dated / uncleared (payment_status='pending').
  const financialByProjectId = new Map<string, Row>();
  ((projectFinancialRows ?? []) as Row[]).forEach((row) => {
    const projectId = s(row, "id");
    if (projectId) financialByProjectId.set(projectId, row);
  });

  const paymentsByProjectId = new Map<string, Row[]>();
  ((projectPaymentRows ?? []) as Row[]).forEach((row) => {
    const projectId = s(row, "project_id");
    if (!projectId) return;
    const list = paymentsByProjectId.get(projectId) ?? [];
    list.push(row);
    paymentsByProjectId.set(projectId, list);
  });

  const projectInfos = projects.map((row) => {
    const projectId = s(row, "id");
    const financialRow = financialByProjectId.get(projectId);
    const actualPrice = n(row.actual_price);
    const agreedBasePrice = n(row.agreed_base_price);
    const expensesBilled = n(financialRow?.expenses_billed);
    // Phase 2: gross up the base for price-includes-VAT projects.
    const vatMode = { priceIncludesVat: row.price_includes_vat === true, vatRate: row.vat_rate as number | null };
    const baseNet = actualPrice > 0 ? actualPrice : agreedBasePrice > 0 ? agreedBasePrice : 0;
    const fallbackTotal = applyProjectVatToBase(baseNet, vatMode) + expensesBilled;
    const totalPrice = Math.max(n(financialRow?.customer_total_price), fallbackTotal);
    const split = splitPaymentAmounts(
      (paymentsByProjectId.get(projectId) ?? []).map((payment) => ({
        amount_total: n(payment.amount_total),
        // Raw (not n()): null must stay null so the split falls back to gross
        // for legacy rows; n() would coerce null → 0 and undercount.
        net_amount: payment.net_amount as number | string | null,
        payment_status: s(payment, "payment_status") || null,
        due_date: s(payment, "due_date") || null,
      }))
    );
    return {
      id: projectId,
      name: s(row, "name") || "פרויקט",
      status: s(row, "status"),
      startDate: s(row, "start_date") || null,
      totalPrice,
      collected: split.collected,
      pending: split.pending,
      overdue: split.overdue,
    };
  });

  const projectsSales = projectInfos.reduce((sum, project) => sum + project.totalPrice, 0);
  const projectsCollected = projectInfos.reduce((sum, project) => sum + project.collected, 0);
  const projectsPending = projectInfos.reduce((sum, project) => sum + project.pending, 0);
  const projectsOverdue = projectInfos.reduce((sum, project) => sum + project.overdue, 0);

  const totalSales = ordersSales + projectsSales;
  const totalPaid = ordersCollected + projectsCollected;
  // Expected = money still due on future-dated / uncleared payments (not yet collected).
  const totalExpected = ordersPending + projectsPending;
  const totalOverdueExpected = ordersOverdue + projectsOverdue;
  const openBalance = Math.max(totalSales - totalPaid, 0);

  // Banner context from the receivables (same source as the מעקב גבייה panel):
  // worst lateness, its payment terms, and the earliest due date.
  let maxDaysLate = 0;
  let bannerTerms: string | null = null;
  let bannerDueDate: string | null = null;
  for (const receivable of receivables) {
    if (receivable.days_late >= maxDaysLate) {
      maxDaysLate = receivable.days_late;
      bannerTerms = receivable.payment_terms ?? bannerTerms;
    }
    const due = receivable.due_date ?? receivable.next_due_date;
    if (due && (!bannerDueDate || due < bannerDueDate)) bannerDueDate = due;
  }
  const paidPct = totalSales > 0 ? Math.min((totalPaid / totalSales) * 100, 100) : 0;

  // --- Recent payments feed (orders + projects merged, newest first).
  const projectNameById = new Map(projectInfos.map((project) => [project.id, project.name]));
  const allPayments = [
    ...((orderPaymentRows ?? []) as Row[]),
    ...((projectPaymentRows ?? []) as Row[]),
  ].sort((a, b) => rowDateValue(s(b, "payment_date") || null) - rowDateValue(s(a, "payment_date") || null));

  const lastPaymentAt = allPayments.reduce<string | null>((latest, payment) => {
    const status = (s(payment, "payment_status") || "cleared").toLowerCase();
    if (status === "pending" || status === "rejected") return latest;
    return laterDate(latest, s(payment, "payment_date") || null);
  }, null);

  const lastActivityAt = laterDate(lastOrderAt, lastPaymentAt);

  // --- Documents linked to the customer directly or via their orders/projects.
  // Prefer the order/project link as the displayed source over the generic
  // customer link when a document carries both.
  const docLinkByDocumentId = new Map<string, Row>();
  [
    ...((customerDocLinks ?? []) as Row[]),
    ...((orderDocLinks ?? []) as Row[]),
    ...((projectDocLinks ?? []) as Row[]),
  ].forEach((link) => {
    const documentId = s(link, "document_id");
    if (!documentId) return;
    const existing = docLinkByDocumentId.get(documentId);
    if (!existing || s(existing, "entity_type") === "customer") {
      docLinkByDocumentId.set(documentId, link);
    }
  });

  const documentIds = Array.from(docLinkByDocumentId.keys());
  const { data: documentRows } =
    documentIds.length > 0
      ? await supabase
          .from("documents")
          .select("id,document_type,title,file_name,storage_key,uploaded_at")
          .in("id", documentIds)
          .order("uploaded_at", { ascending: false, nullsFirst: false })
      : { data: [] as Row[] };

  const totalDocumentsCount = ((documentRows ?? []) as Row[]).length;
  const customerDocuments = await Promise.all(
    ((documentRows ?? []) as Row[]).slice(0, DOCUMENTS_DISPLAY_LIMIT).map(async (doc) => {
      const storageKey = s(doc, "storage_key");
      const { data: signed } = storageKey
        ? await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storageKey, 60 * 60)
        : { data: null };
      const link = docLinkByDocumentId.get(s(doc, "id"));
      return {
        id: s(doc, "id"),
        name: s(doc, "title") || s(doc, "file_name") || "מסמך",
        type: s(doc, "document_type"),
        uploadedAt: s(doc, "uploaded_at") || null,
        url: typeof signed?.signedUrl === "string" ? signed.signedUrl : null,
        sourceType: link ? s(link, "entity_type") : "",
        sourceId: link ? s(link, "entity_id") : "",
      };
    })
  );

  const customerName = s(customer as Row, "name") || s(customer as Row, "name_for_invoice") || "לקוח";
  const customerPhone = s(customer as Row, "phone");
  const customerEmail = s(customer as Row, "email");
  const customerWhatsapp = s(customer as Row, "whatsapp");
  const requiresPrepayment = customer?.requires_prepayment === true;
  const address = s(customer as Row, "address");
  const invoiceName = s(customer as Row, "name_for_invoice");
  const registrationNumber = s(customer as Row, "registration_number");
  const notes = s(customer as Row, "notes");
  const activeContacts = ((contacts ?? []) as Row[]).filter((contact) => contact.active !== false);
  const inactiveContacts = ((contacts ?? []) as Row[]).filter((contact) => contact.active === false);
  const customerNameParam = customerName.trim();
  const returnCustomersHref = returnPage > 1 ? `/customers?page=${returnPage}` : "/customers";
  const canManageCollections = profile.role === "admin" || profile.role === "office";
  const paymentPromises = canManageCollections ? await getCustomerPromises(supabase, id) : [];

  const editButtonCustomer = {
    id,
    name: customerName,
    name_for_invoice: invoiceName || null,
    registration_number: registrationNumber || null,
    phone: customerPhone || null,
    whatsapp: customerWhatsapp || null,
    email: customerEmail || null,
    address: address || null,
    notes: notes || null,
    active: customer?.active !== false,
    requires_prepayment: requiresPrepayment,
    contacts: (contacts ?? []) as Row[],
  };

  const newOrderHref = `/sales/orders/new?customer_id=${encodeURIComponent(id)}`;
  const newProjectHref = `/projects?create=1&customer_id=${encodeURIComponent(id)}`;
  const allOrdersHref = `/sales?customer_id=${encodeURIComponent(id)}${
    customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
  }`;
  const allProjectsHref = `/projects?customer_id=${encodeURIComponent(id)}${
    customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
  }`;
  const financialHref = `/financial?customer_id=${encodeURIComponent(id)}${
    customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
  }`;
  const allDocumentsHref = `/documents?customer_id=${encodeURIComponent(id)}${
    customerNameParam ? `&customer_name=${encodeURIComponent(customerNameParam)}` : ""
  }`;

  const visibleOrders = orders.slice(0, ORDERS_DISPLAY_LIMIT);
  const visibleProjects = projectInfos.slice(0, PROJECTS_DISPLAY_LIMIT);
  const visiblePayments = allPayments.slice(0, PAYMENTS_DISPLAY_LIMIT);

  // Per-entity activity timeline (admin only, mirroring /activity access): this
  // customer's own changes plus their orders, projects, and payments.
  const customerActivity =
    profile.role === "admin"
      ? (
          await getEntityAuditTrail(supabase, [
            { tableName: "customers", recordId: id },
            { tableName: "orders", jsonKey: "customer_id", value: id },
            { tableName: "projects", jsonKey: "customer_id", value: id },
            { tableName: "payments", jsonKey: "order_id", values: orderIds },
            { tableName: "payments", jsonKey: "project_id", values: projectIds },
          ])
        ).items
      : [];

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="ניווט">
              <Link href={returnCustomersHref} className="hover:text-foreground hover:underline">
                לקוחות
              </Link>
              <ChevronLeft className="h-3.5 w-3.5" />
              <h1 className="truncate text-lg font-bold text-foreground">{customerName}</h1>
            </nav>
            <p className="text-xs text-muted-foreground">
              {customerPhone ? (
                <>
                  <a href={`tel:${customerPhone}`} dir="ltr" className="font-medium text-foreground hover:underline">
                    {customerPhone}
                  </a>
                  {" · "}
                </>
              ) : null}
              <span className="font-medium text-foreground">{orders.length}</span> הזמנות
              {" · "}
              <span className="font-medium text-foreground">{projectInfos.length}</span> פרויקטים
              {lastActivityAt ? (
                <>
                  {" · "}פעילות אחרונה{" "}
                  <span className="font-medium text-foreground">{formatDate(lastActivityAt)}</span>
                  {formatRelativeDateLabel(lastActivityAt) ? ` (${formatRelativeDateLabel(lastActivityAt)})` : ""}
                </>
              ) : null}
            </p>
            {requiresPrepayment || customer?.active === false ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {requiresPrepayment ? (
                  <Badge className={getStatusColorClasses("danger")}>תשלום מראש</Badge>
                ) : null}
                {customer?.active === false ? (
                  <Badge className={getStatusColorClasses("danger")}>לא פעיל</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {ordersError ? <p className="text-sm text-destructive">שגיאת הזמנות: {ordersError.message}</p> : null}
        {projectsError ? <p className="text-sm text-destructive">שגיאת פרויקטים: {projectsError.message}</p> : null}

        {/* The one urgent fact first: debt bar (hidden entirely when nothing is owed). */}
        {openBalance > 0.009 ? (
          <section className="grid overflow-hidden rounded-3xl border border-destructive/20 shadow-sm lg:grid-cols-[minmax(180px,1fr)_2fr_minmax(180px,1fr)]">
            <div className="space-y-1 bg-destructive-soft/60 p-4">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                חוב פתוח
              </div>
              <div className="text-2xl font-bold text-destructive">{formatCurrency(openBalance)}</div>
              <div className="text-xs text-muted-foreground">
                {bannerTerms ? <>צורת תשלום: {paymentTermsLabel(bannerTerms)} · </> : null}
                {totalPaid > 0.009 ? "שולם חלקית" : "טרם שולם"}
              </div>
            </div>

            <div className="flex flex-col justify-center gap-2 border-y border-destructive/10 bg-destructive-soft/25 p-4 lg:border-y-0 lg:border-x">
              <div className="text-xs text-muted-foreground">
                סה&quot;כ מכירות{" "}
                <span className="font-semibold text-foreground">{formatCurrency(totalSales)}</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/40">
                <div className="bg-success" style={{ width: `${paidPct}%` }} />
                <div className="flex-1 bg-destructive" />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-success" />
                  נגבה <span className="font-medium">{formatCurrency(totalPaid)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
                  יתרה לתשלום <span className="font-medium">{formatCurrency(openBalance)}</span>
                </span>
                {totalExpected > 0.009 ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
                    צפוי לגבייה <span className="font-medium">{formatCurrency(totalExpected)}</span>
                    {totalOverdueExpected > 0.009 ? (
                      <span className="text-destructive">({formatCurrency(totalOverdueExpected)} באיחור)</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col items-start justify-center gap-2 bg-destructive-soft/60 p-4">
              {maxDaysLate > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {maxDaysLate} ימים באיחור
                </span>
              ) : null}
              {bannerDueDate ? (
                <div className="text-xs text-muted-foreground">פירעון: {formatDate(bannerDueDate)}</div>
              ) : null}
              {canManageCollections ? (
                <Button asChild size="sm">
                  <a href="#collection-tracking">
                    <PhoneCall className="h-4 w-4" />
                    פעולות גבייה
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-3 lg:items-start">
          {/* Activity column: orders, projects, collection, payments */}
          <div className="space-y-3 lg:col-span-2">
            {orders.length === 0 ? (
              <EmptySectionRow
                icon={<ShoppingCart className="h-4 w-4" />}
                title="הזמנות"
                hint="אין הזמנות ללקוח זה"
                action={
                  <Button asChild size="sm" className="h-9 px-4 text-base font-semibold">
                    <Link href={newOrderHref}>+ הזמנה</Link>
                  </Button>
                }
              />
            ) : (
              <SectionCard
                icon={<ShoppingCart className="h-4 w-4" />}
                title="הזמנות"
                aside={
                  <div className="flex items-center gap-2">
                    <CountPill>{orders.length} הזמנות</CountPill>
                    <Button asChild size="sm" className="h-9 px-4 text-base font-semibold">
                      <Link href={newOrderHref}>+ הזמנה</Link>
                    </Button>
                  </div>
                }
              >
                <div className="divide-y divide-border/60">
                  {visibleOrders.map((order) => {
                    const orderId = s(order, "order_id");
                    const status = s(order, "status");
                    const total = n(order.total_amount);
                    const remaining = n(order.remaining_balance);
                    const collected = n(order.collected_amount);
                    const overpaid = total > 0 && collected > total + 0.009;
                    const pending = n(order.pending_amount);
                    const paymentCount = n(order.payment_count);
                    return (
                      <Link
                        key={orderId}
                        href={`/sales/orders/${encodeURIComponent(orderId)}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{formatDate(s(order, "order_date") || null)}</span>
                            <Badge className={getStatusColorClasses(getOrderStatusColor(status))}>
                              {getOrderStatusLabel(status)}
                            </Badge>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            <OrderRef orderId={orderId} />
                            {paymentCount > 0 ? ` · ${paymentCount} תשלומים` : ""}
                            {pending > 0.009 ? ` · צפוי לגבייה ${formatCurrency(pending)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          <div className="font-semibold">{formatCurrency(total)}</div>
                          <div
                            className={`text-xs font-medium ${
                              overpaid || remaining > 0.009
                                ? "text-destructive"
                                : "text-success-soft-foreground"
                            }`}
                          >
                            {overpaid
                              ? "שולם יתר"
                              : remaining > 0.009
                                ? `נותר ${formatCurrency(remaining)}`
                                : "שולם"}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {orders.length > ORDERS_DISPLAY_LIMIT ? (
                  <Button asChild size="sm" variant="secondary" className="w-full">
                    <Link href={allOrdersHref}>לכל {orders.length} ההזמנות</Link>
                  </Button>
                ) : null}
              </SectionCard>
            )}

            {projectInfos.length === 0 ? (
              <EmptySectionRow
                icon={<FolderKanban className="h-4 w-4" />}
                title="פרויקטים"
                hint="אין פרויקטים ללקוח זה"
                action={
                  <Button asChild size="sm" variant="secondary" className={SOFT_ADD_BUTTON_CLASSES}>
                    <Link href={newProjectHref}>+ פרויקט</Link>
                  </Button>
                }
              />
            ) : (
              <SectionCard
                icon={<FolderKanban className="h-4 w-4" />}
                title="פרויקטים"
                aside={
                  <div className="flex items-center gap-2">
                    <CountPill>{projectInfos.length} פרויקטים</CountPill>
                    <Button asChild size="sm" variant="secondary" className={SOFT_ADD_BUTTON_CLASSES}>
                      <Link href={newProjectHref}>+ פרויקט</Link>
                    </Button>
                  </div>
                }
              >
                <div className="divide-y divide-border/60">
                  {visibleProjects.map((project) => {
                    const remaining = Math.max(project.totalPrice - project.collected, 0);
                    return (
                      <Link
                        key={project.id}
                        href={`/projects/${encodeURIComponent(project.id)}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{project.name}</span>
                            <Badge className={getStatusColorClasses(getProjectStatusColor(project.status))}>
                              {getProjectStatusLabel(project.status)}
                            </Badge>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {project.startDate ? `התחיל ${formatDate(project.startDate)}` : "ללא תאריך התחלה"}
                            {project.pending > 0.009 ? ` · צפוי לגבייה ${formatCurrency(project.pending)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          <div className="font-semibold">{formatCurrency(project.totalPrice)}</div>
                          <div
                            className={`text-xs font-medium ${
                              remaining > 0.009 ? "text-destructive" : "text-success-soft-foreground"
                            }`}
                          >
                            {remaining > 0.009 ? `נותר ${formatCurrency(remaining)}` : "שולם"}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
                {projectInfos.length > PROJECTS_DISPLAY_LIMIT ? (
                  <Button asChild size="sm" variant="secondary" className="w-full">
                    <Link href={allProjectsHref}>לכל {projectInfos.length} הפרויקטים</Link>
                  </Button>
                ) : null}
              </SectionCard>
            )}

            {canManageCollections ? (
              <SectionCard
                id="collection-tracking"
                icon={<PhoneCall className="h-4 w-4" />}
                title="שיחות ותזכורות"
              >
                <CustomerCollectionSection
                  customerId={id}
                  customerName={customerName}
                  customerPhone={customerPhone || null}
                />
              </SectionCard>
            ) : null}

            {canManageCollections ? (
              <SectionCard
                id="payment-promises"
                icon={<HandCoins className="h-4 w-4" />}
                title="הבטחות תשלום"
              >
                <PaymentPromises customerId={id} promises={paymentPromises} />
              </SectionCard>
            ) : null}

            {allPayments.length === 0 ? (
              <EmptySectionRow
                icon={<HandCoins className="h-4 w-4" />}
                title="תשלומים"
                hint="אין תשלומים ללקוח זה"
              />
            ) : (
              <SectionCard
                icon={<HandCoins className="h-4 w-4" />}
                title="תשלומים אחרונים"
                aside={<CountPill>{allPayments.length} תשלומים</CountPill>}
              >
                <div className="divide-y divide-border/60">
                  {visiblePayments.map((payment, index) => {
                    const status = (s(payment, "payment_status") || "cleared").toLowerCase();
                    const isPending = status === "pending";
                    const isRejected = status === "rejected";
                    const orderId = s(payment, "order_id");
                    const projectId = s(payment, "project_id");
                    const dueDate = s(payment, "due_date") || null;
                    const checkNumber = s(payment, "check_number");
                    const row = (
                      <>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">
                              {formatDate(s(payment, "payment_date") || null)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {paymentMethodLabel(s(payment, "payment_method") || null)}
                              {checkNumber ? (
                                <>
                                  {" · "}צ׳ק <span dir="ltr">{checkNumber}</span>
                                </>
                              ) : null}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {orderId ? (
                              <OrderRef orderId={orderId} />
                            ) : projectId ? (
                              projectNameById.get(projectId) ?? "פרויקט"
                            ) : null}
                            {isPending && dueDate ? ` · לפירעון ${formatDate(dueDate)}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-left">
                          <div className="font-semibold">{formatCurrency(n(payment.amount_total))}</div>
                          <div
                            className={`text-xs font-medium ${
                              isRejected
                                ? "text-destructive"
                                : isPending
                                  ? "text-primary"
                                  : "text-success-soft-foreground"
                            }`}
                          >
                            {isRejected ? "נדחה" : isPending ? "צפוי" : "נגבה"}
                          </div>
                        </div>
                      </>
                    );
                    const key = s(payment, "id") || `payment-${index}`;
                    return orderId ? (
                      <Link
                        key={key}
                        href={`/sales/orders/${encodeURIComponent(orderId)}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
                      >
                        {row}
                      </Link>
                    ) : projectId ? (
                      <Link
                        key={key}
                        href={`/projects/${encodeURIComponent(projectId)}`}
                        className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
                      >
                        {row}
                      </Link>
                    ) : (
                      <div key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        {row}
                      </div>
                    );
                  })}
                </div>
                <Button asChild size="sm" variant="secondary" className="w-full">
                  <Link href={financialHref}>לכל התנועות במידע הפיננסי</Link>
                </Button>
              </SectionCard>
            )}

            {profile.role === "admin" ? (
              <SectionCard
                icon={<History className="h-4 w-4" />}
                title="היסטוריית פעילות"
                aside={
                  customerActivity.length > 0 ? (
                    <CountPill>{customerActivity.length} רשומות</CountPill>
                  ) : null
                }
              >
                <EntityActivityTimeline items={customerActivity} />
              </SectionCard>
            ) : null}
          </div>

          {/* Reference column: customer details, contacts, documents, notes, Morning */}
          <div className="space-y-3">
            <div className="space-y-2 rounded-3xl border border-border/70 bg-card/80 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold">פרטי לקוח</h2>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <EditCustomerButton
                    iconOnly
                    customer={editButtonCustomer}
                    className="h-8 w-8 rounded-full border-border/60 bg-background"
                  />
                  <DeleteCustomerButton
                    customerId={id}
                    customerName={customerName}
                    returnHref={returnCustomersHref}
                    iconOnly
                    className="h-8 w-8 rounded-full border border-border/60 bg-background text-destructive hover:bg-destructive-soft hover:text-destructive"
                  />
                </div>
              </div>
              <div className="text-sm font-semibold">{customerName}</div>
              {(invoiceName && invoiceName !== customerName) || registrationNumber ? (
                <div className="text-xs text-muted-foreground">
                  {invoiceName && invoiceName !== customerName ? <>שם לחשבונית: {invoiceName}</> : null}
                  {invoiceName && invoiceName !== customerName && registrationNumber ? " · " : null}
                  {registrationNumber ? (
                    <>
                      ח.פ / ת.ז: <span dir="ltr">{registrationNumber}</span>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {customerPhone ? (
                    <a href={`tel:${customerPhone}`} dir="ltr" className="font-medium hover:underline">
                      {customerPhone}
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {customerWhatsapp ? (
                    <span dir="ltr" className="font-medium">{customerWhatsapp}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {customerEmail ? (
                    <span dir="ltr" className="truncate font-medium">{customerEmail}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">
                    {address ? <AddressLink address={address} /> : "-"}
                  </span>
                </div>
              </div>
            </div>

            {activeContacts.length === 0 && inactiveContacts.length === 0 ? (
              <EmptySectionRow
                icon={<UserRound className="h-4 w-4" />}
                title="אנשי קשר"
                hint="אין אנשי קשר ללקוח זה"
                action={<AddContactButton customerId={id} customerName={customerName} />}
              />
            ) : (
              <SectionCard
                icon={<UserRound className="h-4 w-4" />}
                title="אנשי קשר"
                aside={
                  <div className="flex items-center gap-2">
                    {activeContacts.length > 0 ? (
                      <CountPill>{activeContacts.length} אנשי קשר</CountPill>
                    ) : null}
                    <AddContactButton customerId={id} customerName={customerName} />
                  </div>
                }
              >
                <div className="space-y-2">
                  {activeContacts.map((contact, index) => (
                    <div
                      key={s(contact, "id") || `${id}-active-${index}`}
                      className="rounded-xl border border-border/70 bg-background/70 p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{s(contact, "full_name") || `איש קשר ${index + 1}`}</div>
                        {contact.is_primary === true ? (
                          <Badge className={getStatusColorClasses("success")}>ראשי</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {s(contact, "role") || "ללא תפקיד"}
                        {" • "}
                        {s(contact, "phone") ? <span dir="ltr">{s(contact, "phone")}</span> : "-"}
                        {" • "}
                        {s(contact, "email") ? <span dir="ltr">{s(contact, "email")}</span> : "-"}
                      </div>
                      {s(contact, "whatsapp") ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          וואטסאפ: <span dir="ltr">{s(contact, "whatsapp")}</span>
                        </div>
                      ) : null}
                      {s(contact, "notes") ? (
                        <div className="mt-1 text-xs text-muted-foreground">הערות: {s(contact, "notes")}</div>
                      ) : null}
                    </div>
                  ))}
                  {inactiveContacts.length > 0 ? (
                    <div className="rounded-xl border border-destructive/30 bg-destructive-soft p-3 text-sm">
                      <div className="mb-2 font-medium text-destructive">אנשי קשר לא פעילים</div>
                      <div className="space-y-1 text-destructive">
                        {inactiveContacts.map((contact, index) => (
                          <div key={s(contact, "id") || `${id}-inactive-${index}`}>
                            {s(contact, "full_name") || `איש קשר ${index + 1}`}
                            {" • "}
                            {s(contact, "phone") ? <span dir="ltr">{s(contact, "phone")}</span> : "-"}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            )}

            {customerDocuments.length === 0 ? (
              <EmptySectionRow
                icon={<FileText className="h-4 w-4" />}
                title="מסמכים"
                hint="אין מסמכים ללקוח זה"
                action={<AddCustomerDocumentButton customerId={id} customerName={customerName} />}
              />
            ) : (
              <SectionCard
                icon={<FileText className="h-4 w-4" />}
                title="מסמכים"
                aside={
                  <div className="flex items-center gap-2">
                    <CountPill>{totalDocumentsCount} מסמכים</CountPill>
                    <AddCustomerDocumentButton customerId={id} customerName={customerName} />
                  </div>
                }
              >
                <div className="divide-y divide-border/60">
                  {customerDocuments.map((doc) => {
                    const inner = (
                      <>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{doc.name}</span>
                            {doc.type ? (
                              <Badge className={getStatusColorClasses("neutral")}>{doc.type}</Badge>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">
                            {doc.sourceType === "order" ? (
                              <OrderRef orderId={doc.sourceId} />
                            ) : doc.sourceType === "project" ? (
                              projectNameById.get(doc.sourceId) ?? "פרויקט"
                            ) : (
                              "לקוח"
                            )}
                            {doc.uploadedAt ? ` · הועלה ${formatDate(doc.uploadedAt)}` : ""}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-medium text-primary">
                          {doc.url ? "פתיחה" : ""}
                        </span>
                      </>
                    );
                    return doc.url ? (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm hover:bg-muted/20"
                      >
                        {inner}
                      </a>
                    ) : (
                      <div key={doc.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        {inner}
                      </div>
                    );
                  })}
                </div>
                {totalDocumentsCount > DOCUMENTS_DISPLAY_LIMIT ? (
                  <Button asChild size="sm" variant="secondary" className="w-full">
                    <Link href={allDocumentsHref}>לכל {totalDocumentsCount} המסמכים</Link>
                  </Button>
                ) : null}
              </SectionCard>
            )}

            <SectionCard icon={<PencilLine className="h-4 w-4" />} title="הערות">
              <CustomerNotesEditor customerId={id} initialNotes={notes || null} />
            </SectionCard>

            <MorningCustomerCard
              customerId={id}
              morningClientId={s(customer as Row, "morning_client_id") || null}
              morningMatchStatus={s(customer as Row, "morning_match_status") || null}
              morningSyncedAt={s(customer as Row, "morning_synced_at") || null}
              morningLastSyncError={s(customer as Row, "morning_last_sync_error") || null}
              morningDocuments={(morningDocuments ?? []) as MorningLocalDocument[]}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
