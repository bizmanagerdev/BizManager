import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

type DeleteCustomerPayload = {
  id?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as DeleteCustomerPayload;
    const id = typeof body.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "מזהה לקוח חסר." }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: customer, error: customerReadError } = await supabase
      .from("customers")
      .select("id,name")
      .eq("id", id)
      .maybeSingle();

    if (customerReadError) {
      return NextResponse.json({ error: customerReadError.message }, { status: 400 });
    }
    if (!customer) {
      return NextResponse.json({ error: "לקוח לא נמצא." }, { status: 404 });
    }

    const [
      ordersResult,
      projectsResult,
      paymentsResult,
      morningResult,
    ] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("morning_documents").select("id", { count: "exact", head: true }).eq("customer_id", id),
    ]);

    for (const result of [ordersResult, projectsResult, paymentsResult, morningResult]) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
    }

    const blockers: string[] = [];
    if ((ordersResult.count ?? 0) > 0) blockers.push(`${ordersResult.count} הזמנות`);
    if ((projectsResult.count ?? 0) > 0) blockers.push(`${projectsResult.count} פרויקטים`);
    if ((paymentsResult.count ?? 0) > 0) blockers.push(`${paymentsResult.count} תשלומים`);
    if ((morningResult.count ?? 0) > 0) blockers.push(`${morningResult.count} מסמכי Morning`);

    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: `לא ניתן למחוק את הלקוח: קיימים ${blockers.join(", ")}. יש למחוק אותם תחילה או לסמן את הלקוח כלא פעיל.`,
        },
        { status: 400 }
      );
    }

    const { error: contactsDeleteError } = await supabase
      .from("contacts")
      .delete()
      .eq("customer_id", id);

    if (contactsDeleteError) {
      return NextResponse.json({ error: contactsDeleteError.message }, { status: 400 });
    }

    const { error: customerDeleteError } = await supabase
      .from("customers")
      .delete()
      .eq("id", id);

    if (customerDeleteError) {
      return NextResponse.json({ error: customerDeleteError.message }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "customers",
      recordId: id,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
      oldData: { name: customer.name ?? null },
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "שגיאה לא ידועה";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
