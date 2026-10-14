import { NextResponse } from "next/server";
import { logAuditEventAfterResponse } from "@/lib/audit-after";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { customerDeleteBlocker } from "@/app/(app)/customers/[id]/customerPageModel";

type DeleteCustomerPayload = {
  id?: string;
  /** Only say whether it could be deleted (and why not) — the customer page asks before it leaves. */
  dry_run?: boolean;
};

type DbError = {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
};

/**
 * Compose a usable message from a Postgres/PostgREST error. `message` is often
 * empty for FK violations and trigger failures — the real text lives in
 * `details`/`hint`/`code`, so fall through all of them before giving up.
 */
function dbErrorText(
  error: DbError | null | undefined,
  ctx?: { status?: number; statusText?: string },
  fallback = "שגיאה לא ידועה"
) {
  if (error?.code === "23503") {
    return "לא ניתן למחוק את הלקוח: קיימים רשומות מקושרות (הזמנות, פרויקטים, תשלומים או מסמכים). יש למחוק אותם תחילה או לסמן את הלקוח כלא פעיל.";
  }
  const parts = [error?.message, error?.details, error?.hint]
    .map((part) => (part ?? "").trim())
    .filter(Boolean);
  if (error?.code) parts.push(`code=${error.code}`);
  // Surface the HTTP status when the named error fields come back empty — that's
  // the signature of a layer-level failure (403 grants/RLS, 500 trigger, etc.).
  if (ctx?.status) parts.push(`HTTP ${ctx.status}${ctx.statusText ? ` ${ctx.statusText}` : ""}`);
  if (parts.length > 0) return parts.join(" — ");
  // Last resort: dump whatever the error object actually contains.
  if (error) {
    try {
      const raw = JSON.stringify(error);
      if (raw && raw !== "{}") return raw;
    } catch {
      /* ignore */
    }
  }
  return fallback;
}

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

    const {
      data: customer,
      error: customerReadError,
      status: readStatus,
      statusText: readStatusText,
    } = await supabase.from("customers").select("id,name").eq("id", id).maybeSingle();

    if (customerReadError) {
      console.error("customer delete: read failed", { customerReadError, readStatus, readStatusText });
      return NextResponse.json(
        { error: dbErrorText(customerReadError, { status: readStatus, statusText: readStatusText }) },
        { status: 400 }
      );
    }
    if (!customer) {
      return NextResponse.json({ error: "לקוח לא נמצא." }, { status: 404 });
    }

    // Payments are NOT checked directly: the `payments` table has no `customer_id`
    // column — a payment always belongs to an order or a project. Blocking on
    // orders/projects below therefore already covers any related payments.
    // These four are every foreign key on customers.id the database refuses a
    // delete for (orders, projects and leases ON DELETE RESTRICT, Morning
    // documents a plain one); the rest cascade or let go of the link. The lease
    // was missing, so a tenant's delete failed on the database's own refusal.
    const [ordersResult, projectsResult, morningResult, leasesResult] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("projects").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("morning_documents").select("id", { count: "exact", head: true }).eq("customer_id", id),
      supabase.from("lease_agreements").select("id", { count: "exact", head: true }).eq("customer_id", id),
    ]);

    for (const result of [ordersResult, projectsResult, morningResult, leasesResult]) {
      if (result.error) {
        console.error("customer delete: related-count query failed", {
          error: result.error,
          status: result.status,
          statusText: result.statusText,
        });
        return NextResponse.json(
          { error: dbErrorText(result.error, { status: result.status, statusText: result.statusText }) },
          { status: 400 }
        );
      }
    }

    // The same words the customer page shows in its ⋮ ("יש ללקוח 6 הזמנות ו-2 פרויקטים").
    const blocker = customerDeleteBlocker({
      orders: ordersResult.count ?? 0,
      projects: projectsResult.count ?? 0,
      leases: leasesResult.count ?? 0,
      morningDocuments: morningResult.count ?? 0,
    });

    if (body.dry_run === true) {
      return NextResponse.json({ ok: true, blocker });
    }

    if (blocker) {
      return NextResponse.json(
        { error: `לא ניתן למחוק את הלקוח: ${blocker}. אפשר לסמן אותו כלא פעיל.`, blocker },
        { status: 400 }
      );
    }

    const {
      error: contactsDeleteError,
      status: contactsStatus,
      statusText: contactsStatusText,
    } = await supabase.from("contacts").delete().eq("customer_id", id);

    if (contactsDeleteError) {
      console.error("customer delete: contacts delete failed", {
        contactsDeleteError,
        contactsStatus,
        contactsStatusText,
      });
      return NextResponse.json(
        { error: `אנשי קשר: ${dbErrorText(contactsDeleteError, { status: contactsStatus, statusText: contactsStatusText })}` },
        { status: 400 }
      );
    }

    const {
      data: deletedRows,
      error: customerDeleteError,
      status: deleteStatus,
      statusText: deleteStatusText,
    } = await supabase.from("customers").delete().eq("id", id).select("id");

    if (customerDeleteError) {
      console.error("customer delete: customers delete failed", {
        customerDeleteError,
        deleteStatus,
        deleteStatusText,
      });
      return NextResponse.json(
        { error: dbErrorText(customerDeleteError, { status: deleteStatus, statusText: deleteStatusText }) },
        { status: 400 }
      );
    }

    // A delete blocked by RLS (no matching policy) returns no error but removes
    // zero rows — surface that instead of falsely reporting success.
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json(
        { error: "מחיקת הלקוח נחסמה (אין הרשאה למחוק לקוח זה)." },
        { status: 403 }
      );
    }

    logAuditEventAfterResponse({
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
    console.error("customer delete: unexpected error", err);
    let message: string;
    if (err instanceof Error) {
      message = err.message || err.name || "שגיאה לא ידועה";
    } else {
      try {
        message = JSON.stringify(err) || String(err);
      } catch {
        message = String(err);
      }
    }
    return NextResponse.json({ error: message || "שגיאה לא ידועה" }, { status: 500 });
  }
}
