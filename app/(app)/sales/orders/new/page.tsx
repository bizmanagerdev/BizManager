import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import { attachProductStock } from "@/lib/orders/productStock";

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

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams?: Promise<{ customer_id?: string; duplicate?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const duplicateOrderId =
    typeof params.duplicate === "string" && params.duplicate.trim() ? params.duplicate.trim() : null;

  const { profile, supabase } = await requireStaffPage();

  // "שכפול הזמנה": prefill the create wizard with the source order's customer,
  // items and preferences — fresh date/status/payments, everything editable.
  let duplicateInitialOrder = null;
  if (duplicateOrderId) {
    const [{ data: sourceOrder }, { data: sourceItems }, { data: collectRow }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,customer_id,branch_id,payment_terms,discount_amount,notes,needs_invoice")
        .eq("id", duplicateOrderId)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("product_id,quantity_ordered,unit_price,discount_amount,notes")
        .eq("order_id", duplicateOrderId),
      supabase
        .from("orders")
        .select("collect_payment_on_delivery")
        .eq("id", duplicateOrderId)
        .maybeSingle(),
    ]);

    if (sourceOrder) {
      const productIds = Array.from(
        new Set(
          ((sourceItems ?? []) as Row[])
            .map((item) => getString(item, "product_id"))
            .filter((value): value is string => Boolean(value))
        )
      );
      const { data: itemProducts } =
        productIds.length > 0
          ? await supabase.from("products").select("id,name,sku").in("id", productIds)
          : { data: [] as Row[] };
      const productNameById = new Map(
        ((itemProducts ?? []) as Row[]).map((row) => [
          getString(row, "id") ?? "",
          getString(row, "name") ?? getString(row, "sku") ?? "",
        ])
      );

      duplicateInitialOrder = {
        id: duplicateOrderId,
        customer_id: getString(sourceOrder as Row, "customer_id") ?? "",
        branch_id: getString(sourceOrder as Row, "branch_id"),
        order_date: new Date().toISOString().slice(0, 10),
        status: "draft",
        payment_status: "unpaid",
        payment_terms: getString(sourceOrder as Row, "payment_terms"),
        due_date: null,
        discount_amount: getNumber(sourceOrder as Row, "discount_amount") ?? 0,
        needs_invoice:
          typeof (sourceOrder as Row).needs_invoice === "boolean"
            ? ((sourceOrder as Row).needs_invoice as boolean)
            : null,
        collect_payment_on_delivery: (collectRow as Row | null)?.collect_payment_on_delivery === true,
        notes: getString(sourceOrder as Row, "notes") ?? "",
        items: ((sourceItems ?? []) as Row[]).map((item) => {
          const productId = getString(item, "product_id") ?? "";
          return {
            product_id: productId,
            product_name: productNameById.get(productId) || productId,
            quantity_ordered: getNumber(item, "quantity_ordered") ?? 1,
            unit_price: getNumber(item, "unit_price") ?? 0,
            discount_amount: getNumber(item, "discount_amount") ?? 0,
            notes: getString(item, "notes") ?? "",
          };
        }),
      };
    }
  }

  const prefillCustomerId =
    duplicateInitialOrder?.customer_id ||
    (typeof params.customer_id === "string" && params.customer_id.trim()
      ? params.customer_id.trim()
      : null);

  const [{ data: customers, error: customersError }, { data: products, error: productsError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
        .order("name", { ascending: true })
        .range(0, 49),
      supabase
        .from("products_with_last_used")
        .select("id,name,sku,barcode,description,base_price,base_cost,active,order_count,last_used_at")
        .order("order_count", { ascending: false })
        .order("name", { ascending: true })
        .range(0, 49),
    ]);

  // Attach live stock (on-hand − reserved) so the wizard can show availability
  // and warn on shortfalls while building the order.
  const productsWithStock = await attachProductStock(supabase, (products ?? []) as Row[]);

  let customerList = (customers ?? []) as Row[];
  if (prefillCustomerId && !customerList.some((row) => row.id === prefillCustomerId)) {
    const { data: prefillCustomer } = await supabase
      .from("customers")
      .select("id,name,name_for_invoice,phone,whatsapp,email,address,requires_prepayment")
      .eq("id", prefillCustomerId)
      .maybeSingle();
    if (prefillCustomer) {
      customerList = [prefillCustomer as Row, ...customerList];
    }
  }

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <div className="space-y-4">
        <NewOrderClient
          customers={customerList}
          products={productsWithStock}
          customersError={customersError?.message ?? null}
          productsError={productsError?.message ?? null}
          mode="create"
          initialOrder={duplicateInitialOrder}
          draftKey="order-create"
        />
      </div>
    </AppShell>
  );
}
