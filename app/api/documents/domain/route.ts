import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { isExpenseBusinessDomain } from "@/lib/expenses";

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase } = access.value;

    const body = (await req.json()) as { document_id?: string; business_domain?: string };
    const documentId = typeof body.document_id === "string" ? body.document_id : "";
    const businessDomain = typeof body.business_domain === "string" ? body.business_domain.trim() : "";

    if (!documentId) return NextResponse.json({ error: "Missing document_id" }, { status: 400 });
    if (!isExpenseBusinessDomain(businessDomain)) {
      return NextResponse.json({ error: "Unsupported business_domain" }, { status: 400 });
    }

    const { error } = await supabase
      .from("documents")
      .update({ business_domain: businessDomain })
      .eq("id", documentId);
    if (error) return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
