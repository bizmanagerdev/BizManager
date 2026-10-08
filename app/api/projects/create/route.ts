import { toHebrewError } from "@/lib/error-messages";
﻿import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { withIdempotency } from "@/lib/idempotency";
import { clientRowId } from "@/lib/client-row-id";
import { projectRowFrom } from "@/lib/projects/project-input";
import { getCurrentVatRate } from "@/lib/settings/vat";
import { notifyNewEntity } from "@/lib/notifications/new-entity";
import { runAfterResponse } from "@/lib/after-response";

const PROJECT_DASHBOARD_SELECT =
  "id,name,status,project_type,start_date,end_date,agreed_base_price,actual_price,customer_id,customer_name,project_manager_id,project_manager_name,created_at,updated_at,total_expenses,gross_profit,total_tasks,completed_tasks,open_tasks";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    return await withIdempotency(req, supabase, user.id, "projects/create", async () => {
    const body = (await req.json()) as Record<string, unknown>;
    // The app's own id for it, when the phone saved it first (lib/projects/device-project-saves.ts).
    const clientId = clientRowId(body.id);
    // The same row the phone writes when it saves first (lib/projects/project-input.ts).
    const parsed = projectRowFrom(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { row } = parsed;

    // Freeze the current rate onto price-includes-VAT projects so the gross
    // target stays stable if the global rate later changes.
    const projectVatRate = row.price_includes_vat ? await getCurrentVatRate(supabase) : null;

    const { data: created, error: insertError } = await supabase
      .from("projects")
      .insert({ ...(clientId ? { id: clientId } : {}), ...row, vat_rate: projectVatRate })
      .select(
        "id,customer_id,branch_id,name,project_type,status,agreed_base_price,actual_price,expenses_billed_separately,project_manager_id,start_date,end_date,payment_terms,due_date,notes,items_to_move,origin_address,origin_floor,origin_has_elevator,destination_address,destination_floor,destination_has_elevator,created_at,updated_at"
      )
      .maybeSingle();

    const readDashboardRow = (id: string) =>
      supabase.from("project_dashboard_view").select(PROJECT_DASHBOARD_SELECT).eq("id", id).maybeSingle();

    if (insertError) {
      if (clientId && insertError.code === "23505") {
        // Sent again after its answer was lost: the project it already made.
        const { data: existing } = await readDashboardRow(clientId);
        if (existing) return NextResponse.json({ project: existing });
      }
      return NextResponse.json({ error: toHebrewError(insertError.message) }, { status: 400 });
    }
    if (!created || typeof created.id !== "string") {
      return NextResponse.json({ error: "Project was not created" }, { status: 400 });
    }

    const { data: dashboardRow } = await readDashboardRow(created.id);

    logAuditEventAfterResponse({
      supabase,
      tableName: "projects",
      recordId: created.id,
      action: "create",
      changedBy: profile.id,
      userRole: profile.role,
    });

    // Alert back-office (admin + office) that a new project came in — after the
    // response, so the dialog doesn't wait on their push notifications.
    const projectId = created.id;
    runAfterResponse("projects/create notify", () =>
      notifyNewEntity({ kind: "project", entityId: projectId, creatorUserId: profile.id, name: row.name })
    );

    return NextResponse.json({ project: dashboardRow ?? created });
    });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
