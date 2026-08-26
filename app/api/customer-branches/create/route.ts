import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";

type CreateCustomerBranchPayload = {
  customer_id?: string;
  name?: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean;
};

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user } = access.value;

    return await withIdempotency(req, supabase, user.id, "customer-branches/create", async () => {
      const body = (await req.json()) as CreateCustomerBranchPayload;

      const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const address = typeof body.address === "string" ? body.address.trim() : null;
      const phone = typeof body.phone === "string" ? body.phone.trim() : null;
      const active = body.active === false ? false : true;

      if (!customerId) {
        return NextResponse.json({ error: "Missing customer_id" }, { status: 400 });
      }
      if (!name) {
        return NextResponse.json({ error: "Missing name" }, { status: 400 });
      }

      const { data: customer, error: customerError } = await supabase
        .from("customers")
        .select("id")
        .eq("id", customerId)
        .maybeSingle();

      if (customerError) {
        return NextResponse.json({ error: toHebrewError(customerError.message) }, { status: 400 });
      }
      if (!customer?.id) {
        return NextResponse.json({ error: "Invalid customer_id" }, { status: 400 });
      }

      const { data, error } = await supabase
        .from("customer_branches")
        .insert({ customer_id: customerId, name, address, phone, active })
        .select("id,customer_id,name,address,phone,active")
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      }
      if (!data || typeof data.id !== "string") {
        return NextResponse.json({ error: "Branch was not created" }, { status: 400 });
      }

      return NextResponse.json({ branch: data });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
