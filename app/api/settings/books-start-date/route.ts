import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { getBooksStartDate, normalizeBooksStartDate, setBooksStartDate } from "@/lib/settings/booksStartDate";

export async function GET() {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;
    const booksStartDate = await getBooksStartDate(supabase);
    return NextResponse.json({ books_start_date: booksStartDate });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    if (profile.role !== "admin") {
      return NextResponse.json({ error: "אין הרשאה לעדכן את תחילת ספירת הכספים." }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as { books_start_date?: string | null };
    const raw = body.books_start_date;

    // null / "" clears the setting — every report counts everything again.
    let booksStartDate: string | null = null;
    if (raw !== null && raw !== undefined && raw !== "") {
      booksStartDate = normalizeBooksStartDate(raw);
      if (!booksStartDate) {
        return NextResponse.json({ error: "יש לבחור חודש (הספירה מתחילה ב-1 לחודש)." }, { status: 400 });
      }
      const currentMonthStart = `${new Date().toISOString().slice(0, 7)}-01`;
      if (booksStartDate > currentMonthStart) {
        return NextResponse.json({ error: "לא ניתן לבחור חודש עתידי." }, { status: 400 });
      }
    } else if (raw === undefined) {
      return NextResponse.json({ error: "חסר תאריך התחלה." }, { status: 400 });
    }

    await setBooksStartDate(supabase, booksStartDate, user.id);

    await logAuditEvent({
      supabase,
      tableName: "business_settings",
      recordId: "books_start_date",
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: { books_start_date: booksStartDate },
    });

    return NextResponse.json({ books_start_date: booksStartDate });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
