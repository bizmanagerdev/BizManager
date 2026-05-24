import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import {
  deleteLocalMorningDocument,
  updateLocalMorningDocumentNotes,
} from "@/lib/morning/service";

const updateSchema = z.object({
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin", "office"] });
    if (!access.ok) return access.response;
    const { id } = await context.params;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "נתוני העדכון אינם תקינים." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    const document = await updateLocalMorningDocumentNotes(supabase, {
      localDocumentId: id,
      notes: parsed.data.notes ?? null,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "עדכון מסמך Morning נכשל.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const { id } = await context.params;
    const { supabase, profile } = access.value;
    await deleteLocalMorningDocument(supabase, {
      localDocumentId: id,
      actor: { profileId: profile.id, role: profile.role },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "מחיקת מסמך Morning נכשלה.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
