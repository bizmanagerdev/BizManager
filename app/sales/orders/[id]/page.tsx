import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { requireProfile } from "@/lib/auth/requireProfile";
import DeleteOrderButton from "@/app/sales/orders/[id]/DeleteOrderButton";
import OrderPaymentDialog from "@/app/sales/orders/OrderPaymentDialog";
import {
  paymentMethodLabel,
  paymentStatusClasses,
} from "@/lib/orders/paymentStatus";

type Row = Record<string, unknown>;

function getString(row: Row, key: string) {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function getNumber(row: Row, key: string) {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}

function formatOrderStatus(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "draft":
      return "פתוחה";
    case "confirmed":
      return "מאושרת";
    case "cancelled":
      return "בוטלה";
    case "completed":
      return "הושלמה";
    default:
      return status ?? "-";
  }
}

function formatPaymentStatus(status: string | null) {
  switch ((status ?? "").toLowerCase()) {
    case "unpaid":
      return "לא שולם";
    case "partial":
      return "שולם חלקית";
    case "paid":
      return "שולם";
    case "refunded":
      return "הוחזר";
    default:
      return status ?? "-";
  }
}

function extractCityFromAddress(address: string | null) {
  if (!address) return null;
  const normalized = address.trim();
  if (!normalized) return null;
  const first = normalized.split("|")[0]?.trim() ?? "";
  return first || null;
}

export default async function SalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { profile, supabase } = await requireProfile();

  const [
    { data: order, error: orderError },
    { data: orderItems, error: itemsError },
    { data: payments, error: paymentsError },
    { data: financials, error: financialsError },
  ] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id,customer_id,order_date,status,payment_status,discount_amount,notes")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("id,order_id,product_id,quantity_ordered,unit_price,discount_amount,line_total,notes")
        .eq("order_id", id),
      supabase
        .from("payments")
        .select("id,payment_date,amount_total,payment_method,reference_number,notes,created_at")
        .eq("target_type", "order")
        .eq("target_id", id)
        .order("payment_date", { ascending: false }),
      supabase
        .from("order_financials_view")
        .select("id,total_amount,total_paid,remaining_balance,payment_count,payment_status")
        .eq("id", id)
        .maybeSingle(),
    ]);

  const customerId =
    order && typeof (order as Row).customer_id === "string"
      ? ((order as Row).customer_id as string)
      : null;

  const { data: customer } =
    customerId
      ? await supabase
          .from("customers")
          .select("id,name,name_for_invoice,email,phone,address")
          .eq("id", customerId)
          .maybeSingle()
      : { data: null as Row | null };

  const productIds = Array.from(
    new Set(
      (orderItems ?? [])
        .map((row) => (typeof row?.product_id === "string" ? row.product_id : null))
        .filter(Boolean)
    )
  ) as string[];

  const { data: products } =
    productIds.length > 0
      ? await supabase
          .from("products")
          .select("id,name,sku,barcode")
          .in("id", productIds)
      : { data: [] as Row[] };

  const productMap = new Map<string, Row>();
  (products ?? []).forEach((row) => {
    if (typeof row?.id === "string") {
      productMap.set(row.id, row as Row);
    }
  });

  const totalAmount = getNumber((financials as Row) ?? {}, "total_amount") ?? 0;
  const totalPaid = getNumber((financials as Row) ?? {}, "total_paid") ?? 0;
  const remainingBalance = getNumber((financials as Row) ?? {}, "remaining_balance") ?? 0;
  const paymentCount = getNumber((financials as Row) ?? {}, "payment_count") ?? (payments ?? []).length;
  const paymentStatus = getString((financials as Row) ?? {}, "payment_status") ?? "unpaid";

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">הזמנה #{id.slice(0, 8)}</h1>
            <p className="text-sm text-muted-foreground">פרטי הזמנה ושורות פריטים.</p>
          </div>
          <div className="flex items-center gap-2">
            <DeleteOrderButton orderId={id} />
            <OrderPaymentDialog orderId={id} totalAmount={totalAmount} paidAmount={totalPaid} />
            <Link href={`/sales/orders/${id}/edit`} className="text-sm text-primary">
              עריכת הזמנה
            </Link>
            <Link href="/sales/orders/new" className="text-sm text-primary">
              הזמנה חדשה
            </Link>
            <Link href="/sales" className="text-sm text-primary">
              חזרה למכירות
            </Link>
          </div>
        </div>

        {orderError ? (
          <p className="text-sm text-destructive">שגיאת הזמנה: {orderError.message}</p>
        ) : null}

        {itemsError ? (
          <p className="text-sm text-destructive">שגיאת פריטים: {itemsError.message}</p>
        ) : null}
        {paymentsError ? (
          <p className="text-sm text-destructive">שגיאת תשלומים: {paymentsError.message}</p>
        ) : null}
        {financialsError && !financialsError.message.includes("order_financials_view") ? (
          <p className="text-sm text-destructive">שגיאת סיכום הזמנה: {financialsError.message}</p>
        ) : null}

        {order ? (
          <div className="rounded-md border p-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">לקוח</span>
                <span>
                  {getString((customer as Row) ?? {}, "name") ??
                    getString((customer as Row) ?? {}, "name_for_invoice") ??
                    customerId ??
                    "-"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">עיר</span>
                <span>{extractCityFromAddress(getString((customer as Row) ?? {}, "address")) ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">כתובת</span>
                <span>{getString((customer as Row) ?? {}, "address") ?? "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">תאריך הזמנה</span>
                <span>{formatDate(getString(order as Row, "order_date"))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס הזמנה</span>
                <span>{formatOrderStatus(getString(order as Row, "status"))}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סטטוס תשלום</span>
                <span className={`rounded-full border px-2.5 py-1 text-xs ${paymentStatusClasses(paymentStatus)}`}>
                  {formatPaymentStatus(paymentStatus)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">סכום כולל</span>
                <span>{formatCurrency(totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">שולם</span>
                <span>{formatCurrency(totalPaid)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">יתרה</span>
                <span>{formatCurrency(remainingBalance)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">מספר תשלומים</span>
                <span>{paymentCount}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <h2 className="text-lg font-medium">תשלומים</h2>
          {(payments ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">עדיין לא הוזנו תשלומים להזמנה זו.</p>
          ) : (
            <div className="space-y-2">
              {(payments ?? []).map((payment, index) => (
                <div
                  key={getString(payment as Row, "id") ?? `payment-${index}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {formatCurrency(getNumber(payment as Row, "amount_total") ?? 0)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(getString(payment as Row, "payment_date") ?? getString(payment as Row, "created_at"))}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    אמצעי: {paymentMethodLabel(getString(payment as Row, "payment_method"))}
                    {getString(payment as Row, "reference_number")
                      ? ` | אסמכתא: ${getString(payment as Row, "reference_number")}`
                      : ""}
                  </div>
                  {getString(payment as Row, "notes") ? (
                    <div className="mt-1 text-muted-foreground">
                      הערות: {getString(payment as Row, "notes")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-medium">פריטי הזמנה</h2>
          <div className="space-y-2">
            {(orderItems ?? []).map((item, index) => {
              const productId = getString(item as Row, "product_id") ?? "";
              const product = productMap.get(productId);
              const productName =
                getString((product ?? {}) as Row, "name") ??
                getString((product ?? {}) as Row, "product_name") ??
                productId;
              const quantity = getNumber(item as Row, "quantity_ordered") ?? 0;
              const unitPrice = getNumber(item as Row, "unit_price") ?? 0;
              const lineTotal = getNumber(item as Row, "line_total") ?? quantity * unitPrice;

              return (
                <div
                  key={getString(item as Row, "id") ?? `${productId}-${index}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{productName}</span>
                    <span>{formatCurrency(lineTotal)}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    כמות: {quantity} | מחיר יחידה: {formatCurrency(unitPrice)}
                  </div>
                </div>
              );
            })}
            {(orderItems ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">לא נמצאו פריטים להזמנה זו.</p>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
