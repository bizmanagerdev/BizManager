import { toHebrewError } from "@/lib/error-messages";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditEvent } from "@/lib/audit";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";

import { STORAGE_BUCKET } from "@/lib/storage";

const DOCUMENTS_BUCKET = STORAGE_BUCKET;

async function deleteOrderDirectly(
  supabase: SupabaseClient,
  {
    orderId,
    changedBy,
    userRole,
  }: {
    orderId: string;
    changedBy: string;
    userRole: string | null | undefined;
  }
) {
  const { data: paymentRows, error: paymentReadError } = await supabase
    .from("payments")
    .select("id")
    .eq("order_id", orderId);

  if (paymentReadError) {
    return { ok: false as const, error: toHebrewError(paymentReadError.message) };
  }

  const paymentIds = (paymentRows ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((value): value is string => Boolean(value));

  const documentIds = new Set<string>();

  const { data: orderDocumentLinks, error: orderDocumentLinksError } = await supabase
    .from("document_links")
    .select("document_id")
    .eq("entity_type", "order")
    .eq("entity_id", orderId);

  if (orderDocumentLinksError) {
    return { ok: false as const, error: toHebrewError(orderDocumentLinksError.message) };
  }

  for (const row of orderDocumentLinks ?? []) {
    if (typeof row.document_id === "string") documentIds.add(row.document_id);
  }

  if (paymentIds.length > 0) {
    const { data: paymentDocumentLinks, error: paymentDocumentLinksError } = await supabase
      .from("document_links")
      .select("document_id")
      .eq("entity_type", "payment")
      .in("entity_id", paymentIds);

    if (paymentDocumentLinksError) {
      return { ok: false as const, error: toHebrewError(paymentDocumentLinksError.message) };
    }

    for (const row of paymentDocumentLinks ?? []) {
      if (typeof row.document_id === "string") documentIds.add(row.document_id);
    }
  }

  const documentIdList = Array.from(documentIds);
  let storageKeys: string[] = [];

  if (documentIdList.length > 0) {
    const { data: documentRows, error: documentReadError } = await supabase
      .from("documents")
      .select("id,storage_key")
      .in("id", documentIdList);

    if (documentReadError) {
      return { ok: false as const, error: toHebrewError(documentReadError.message) };
    }

    storageKeys = (documentRows ?? [])
      .map((row) => (typeof row.storage_key === "string" ? row.storage_key : null))
      .filter((value): value is string => Boolean(value));
  }

  if (paymentIds.length > 0) {
    const { error: paymentMorningDocumentsDeleteError } = await supabase
      .from("morning_documents")
      .delete()
      .in("payment_id", paymentIds);

    if (paymentMorningDocumentsDeleteError) {
      return { ok: false as const, error: toHebrewError(paymentMorningDocumentsDeleteError.message) };
    }
  }

  const { error: orderMorningDocumentsDeleteError } = await supabase
    .from("morning_documents")
    .delete()
    .eq("order_id", orderId);

  if (orderMorningDocumentsDeleteError) {
    return { ok: false as const, error: toHebrewError(orderMorningDocumentsDeleteError.message) };
  }

  const { error: paymentsDeleteError } = await supabase.from("payments").delete().eq("order_id", orderId);

  if (paymentsDeleteError) {
    return { ok: false as const, error: toHebrewError(paymentsDeleteError.message) };
  }

  // Release the order's reserved/consumed stock first. We delete the order's
  // inventory_movements rows; the sync trigger then reverts each one (reserved
  // drops, so the product moves from שמור back to זמין). Prefer the privileged
  // RPC so this works for every role regardless of inventory_movements RLS; if
  // it isn't deployed yet, fall back to a direct delete (works when RLS allows).
  const { error: releaseRpcError } = await supabase.rpc("release_order_inventory", {
    p_order_id: orderId,
  });

  if (releaseRpcError) {
    const missingReleaseRpc =
      releaseRpcError.message.includes("release_order_inventory") ||
      releaseRpcError.message.includes("function");

    if (!missingReleaseRpc) {
      return { ok: false as const, error: toHebrewError(releaseRpcError.message) };
    }

    const { error: inventoryMovementsDeleteError } = await supabase
      .from("inventory_movements")
      .delete()
      .eq("source_type", "order")
      .eq("source_id", orderId);

    if (inventoryMovementsDeleteError) {
      return { ok: false as const, error: toHebrewError(inventoryMovementsDeleteError.message) };
    }
  }

  const { error: orderDocumentLinksDeleteError } = await supabase
    .from("document_links")
    .delete()
    .eq("entity_type", "order")
    .eq("entity_id", orderId);

  if (orderDocumentLinksDeleteError) {
    return { ok: false as const, error: toHebrewError(orderDocumentLinksDeleteError.message) };
  }

  if (paymentIds.length > 0) {
    const { error: paymentDocumentLinksDeleteError } = await supabase
      .from("document_links")
      .delete()
      .eq("entity_type", "payment")
      .in("entity_id", paymentIds);

    if (paymentDocumentLinksDeleteError) {
      return { ok: false as const, error: toHebrewError(paymentDocumentLinksDeleteError.message) };
    }
  }

  if (documentIdList.length > 0) {
    const { error: documentsDeleteError } = await supabase.from("documents").delete().in("id", documentIdList);

    if (documentsDeleteError) {
      return { ok: false as const, error: toHebrewError(documentsDeleteError.message) };
    }
  }

  const { error: orderItemsDeleteError } = await supabase.from("order_items").delete().eq("order_id", orderId);

  if (orderItemsDeleteError) {
    return { ok: false as const, error: toHebrewError(orderItemsDeleteError.message) };
  }

  const { error: orderDeleteError } = await supabase.from("orders").delete().eq("id", orderId);

  if (orderDeleteError) {
    return { ok: false as const, error: toHebrewError(orderDeleteError.message) };
  }

  await logAuditEvent({
    supabase,
    tableName: "orders",
    recordId: orderId,
    action: "delete",
    changedBy,
    userRole,
  });

  if (storageKeys.length > 0) {
    const { error: storageDeleteError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(storageKeys);

    if (storageDeleteError) {
      return {
        ok: true as const,
        warning: `Order deleted but file cleanup failed: ${storageDeleteError.message}`,
      };
    }
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { order_id?: string };
    const orderId = typeof body.order_id === "string" ? body.order_id : "";

    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
    }

    const access = await requireRouteAccess();
    if (!access.ok) return access.response;
    const { supabase, user, profile } = access.value;

    const { data, error } = await supabase.rpc("delete_sales_order", {
      p_order_id: orderId,
      p_deleted_by: user.id,
    });

    if (error) {
      const missingDeleteRpc =
        error.message.includes("delete_sales_order") || error.message.includes("function");

      if (!missingDeleteRpc) {
        return NextResponse.json({ error: toHebrewError(error.message) }, { status: 400 });
      }

      const fallbackResult = await deleteOrderDirectly(supabase, {
        orderId,
        changedBy: profile.id,
        userRole: profile.role,
      });

      if (!fallbackResult.ok) {
        return NextResponse.json({ error: fallbackResult.error }, { status: 400 });
      }

      return NextResponse.json({
        ok: true,
        warning: fallbackResult.warning ?? "Order deleted using API fallback because DB RPC is missing.",
      });
    }

    if (data !== true) return NextResponse.json({ error: "Delete failed" }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = toHebrewError(err, "Unknown error");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
