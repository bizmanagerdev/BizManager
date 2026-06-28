import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      id?: string;
      project_id?: string | null;
    };

    const paymentId = typeof body.id === "string" ? body.id.trim() : "";
    const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!paymentId) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;

    const { data: paymentRow, error: paymentReadError } = await supabase
      .from("payments")
      .select("id,project_id,order_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentReadError) {
      return NextResponse.json({ error: toHebrewError(paymentReadError.message) }, { status: 400 });
    }
    if (!paymentRow?.id) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (projectId) {
      // Project-scoped delete (existing callers): the payment must belong to it.
      if (paymentRow.project_id !== projectId) {
        return NextResponse.json({ error: "Payment not found for project" }, { status: 404 });
      }
    } else if (paymentRow.project_id || paymentRow.order_id) {
      // No project_id supplied → only standalone income (no project/order link)
      // may be deleted this way. Linked payments must go through their own flow.
      return NextResponse.json(
        { error: "תשלום משויך לפרויקט/הזמנה — יש למחוק אותו מהמסך המתאים." },
        { status: 400 }
      );
    }

    const { error: paymentDeleteError } = await supabase
      .from("payments")
      .delete()
      .eq("id", paymentId);

    if (paymentDeleteError) {
      return NextResponse.json({ error: toHebrewError(paymentDeleteError.message) }, { status: 400 });
    }

    await logAuditEvent({
      supabase,
      tableName: "payments",
      recordId: paymentId,
      action: "delete",
      changedBy: profile.id,
      userRole: profile.role,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
