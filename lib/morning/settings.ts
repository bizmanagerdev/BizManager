import type { SupabaseClient } from "@supabase/supabase-js";
import { MorningDocumentType } from "@/lib/morning/types";

export type MorningSettings = {
  autoInvoiceOnOrderCompletion: boolean;
  invoiceTypeOnCompletion: MorningDocumentType.TaxInvoice | MorningDocumentType.TaxInvoiceReceipt;
  autoReceiptOnPayment: boolean;
  receiptTypeOnPayment: MorningDocumentType.Receipt | MorningDocumentType.TaxInvoiceReceipt;
};

const DEFAULT_SETTINGS: MorningSettings = {
  autoInvoiceOnOrderCompletion: false,
  invoiceTypeOnCompletion: MorningDocumentType.TaxInvoice,
  autoReceiptOnPayment: false,
  receiptTypeOnPayment: MorningDocumentType.Receipt,
};

type Row = Record<string, unknown>;

function normalizeInvoiceType(value: unknown) {
  return value === MorningDocumentType.TaxInvoiceReceipt
    ? MorningDocumentType.TaxInvoiceReceipt
    : MorningDocumentType.TaxInvoice;
}

function normalizeReceiptType(value: unknown) {
  return value === MorningDocumentType.TaxInvoiceReceipt
    ? MorningDocumentType.TaxInvoiceReceipt
    : MorningDocumentType.Receipt;
}

export async function loadMorningSettings(supabase: SupabaseClient): Promise<MorningSettings> {
  const { data, error } = await supabase
    .from("morning_settings")
    .select(
      "auto_invoice_on_order_completion,invoice_type_on_completion,auto_receipt_on_payment,receipt_type_on_payment"
    )
    .eq("id", true)
    .maybeSingle();

  if (error || !data) return DEFAULT_SETTINGS;

  const row = data as Row;
  return {
    autoInvoiceOnOrderCompletion: row.auto_invoice_on_order_completion === true,
    invoiceTypeOnCompletion: normalizeInvoiceType(row.invoice_type_on_completion),
    autoReceiptOnPayment: row.auto_receipt_on_payment === true,
    receiptTypeOnPayment: normalizeReceiptType(row.receipt_type_on_payment),
  };
}

export async function saveMorningSettings(
  supabase: SupabaseClient,
  patch: Partial<MorningSettings>,
  updatedBy: string
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (patch.autoInvoiceOnOrderCompletion !== undefined) {
    update.auto_invoice_on_order_completion = patch.autoInvoiceOnOrderCompletion;
  }
  if (patch.invoiceTypeOnCompletion !== undefined) {
    update.invoice_type_on_completion = normalizeInvoiceType(patch.invoiceTypeOnCompletion);
  }
  if (patch.autoReceiptOnPayment !== undefined) {
    update.auto_receipt_on_payment = patch.autoReceiptOnPayment;
  }
  if (patch.receiptTypeOnPayment !== undefined) {
    update.receipt_type_on_payment = normalizeReceiptType(patch.receiptTypeOnPayment);
  }

  const { error } = await supabase
    .from("morning_settings")
    .upsert({ id: true, ...update }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

const COMPLETION_STATUSES = new Set([
  "delivered",
  "completed",
  "closed",
  "סופקה",
  "הושלמה",
  "סגורה",
]);

export function isOrderCompletionStatus(status: string | null | undefined) {
  if (!status) return false;
  return COMPLETION_STATUSES.has(status.trim());
}
