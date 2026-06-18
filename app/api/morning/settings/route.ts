import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { loadMorningSettings, saveMorningSettings } from "@/lib/morning/settings";
import { MorningDocumentType } from "@/lib/morning/types";

const updateSchema = z.object({
  autoInvoiceOnOrderCompletion: z.boolean().optional(),
  invoiceTypeOnCompletion: z
    .union([z.literal(MorningDocumentType.TaxInvoice), z.literal(MorningDocumentType.TaxInvoiceReceipt)])
    .optional(),
  autoReceiptOnPayment: z.boolean().optional(),
  receiptTypeOnPayment: z
    .union([z.literal(MorningDocumentType.Receipt), z.literal(MorningDocumentType.TaxInvoiceReceipt)])
    .optional(),
});

export async function GET() {
  const access = await requireRouteAccess({ allowedRoles: ["admin"] });
  if (!access.ok) return access.response;
  const settings = await loadMorningSettings(access.value.supabase);
  return NextResponse.json({ settings });
}

export async function POST(req: Request) {
  try {
    const access = await requireRouteAccess({ allowedRoles: ["admin"] });
    if (!access.ok) return access.response;
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "ערכי הגדרה לא תקינים." }, { status: 400 });
    }

    const { supabase, profile } = access.value;
    await saveMorningSettings(supabase, parsed.data, profile.id);
    const settings = await loadMorningSettings(supabase);
    await logAuditEvent({
      supabase,
      tableName: "morning_settings",
      recordId: "singleton",
      action: "update",
      changedBy: profile.id,
      userRole: profile.role,
      newData: {
        autoInvoiceOnOrderCompletion: settings.autoInvoiceOnOrderCompletion,
        invoiceTypeOnCompletion: settings.invoiceTypeOnCompletion,
        autoReceiptOnPayment: settings.autoReceiptOnPayment,
        receiptTypeOnPayment: settings.receiptTypeOnPayment,
      },
    });
    return NextResponse.json({ settings });
  } catch (error) {
    const message = toHebrewError(error, "שמירת הגדרות Morning נכשלה.");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
