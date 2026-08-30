import { NextResponse } from "next/server";
import { toHebrewError } from "@/lib/error-messages";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { norm } from "@/lib/financial/cardImport";

// One lump charge on a bank account per card per statement — see the
// card_statement_charges migration. Created/edited from the statement detail
// page (which has the card-grouped totals); deleted inline from the account
// register too. Same gate as the accounts table's RLS policy: admin/office.

function isAllowed(role: string | null | undefined) {
  return role === "admin" || role === "office";
}

function sanitizeId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sanitizeAmount(value: unknown) {
  const n = typeof value === "number" ? value : Number(typeof value === "string" ? value.trim() : NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function sanitizeDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isAllowed(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה לרשום חיוב כרטיס בחשבון." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const statementId = sanitizeId(body.statement_id);
    const cardLabel = typeof body.card_label === "string" ? body.card_label.trim() : "";
    const accountId = sanitizeId(body.account_id);
    const amount = sanitizeAmount(body.amount);
    const chargeDate = sanitizeDate(body.charge_date);

    if (!statementId) return NextResponse.json({ error: "חסר מזהה פירוט." }, { status: 400 });
    if (!cardLabel) return NextResponse.json({ error: "חסר שם כרטיס." }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "יש לבחור חשבון." }, { status: 400 });
    if (amount === null) return NextResponse.json({ error: "יש להזין סכום תקין." }, { status: 400 });
    if (!chargeDate) return NextResponse.json({ error: "יש לבחור תאריך חיוב." }, { status: 400 });

    // Upsert by (statement_id, card_label) — the same "record it / update it"
    // action, whether this card's charge already exists for this statement.
    const { data, error } = await supabase
      .from("card_statement_charges")
      .upsert(
        {
          statement_id: statementId,
          card_label: cardLabel,
          account_id: accountId,
          amount,
          charge_date: chargeDate,
          notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
          created_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "statement_id,card_label" }
      )
      .select("id")
      .single();
    if (error) throw error;

    // Remember this card → account choice for next month's statement.
    const cardKey = norm(cardLabel);
    if (cardKey) {
      await supabase
        .from("card_account_mappings")
        .upsert(
          { card_key: cardKey, card_label: cardLabel, account_id: accountId, updated_by: profile.id, updated_at: new Date().toISOString() },
          { onConflict: "card_key" }
        );
    }

    return NextResponse.json({ id: (data as { id: string }).id });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "שמירת החיוב נכשלה.") }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, profile } = access.value;
    if (!isAllowed(profile.role)) {
      return NextResponse.json({ error: "אין הרשאה למחוק חיוב כרטיס." }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (!id) return NextResponse.json({ error: "חסר מזהה חיוב." }, { status: 400 });

    const { error } = await supabase.from("card_statement_charges").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: toHebrewError(err, "מחיקת החיוב נכשלה.") }, { status: 500 });
  }
}
