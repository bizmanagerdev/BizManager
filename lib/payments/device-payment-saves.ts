import { readyDeviceSaves } from "@/lib/powersync/store";
import { addPaymentOnDevice, markPaymentCollectedOnDevice } from "@/lib/powersync/local-writes";
import { orderPaymentFrom, type OrderPaymentBody } from "@/lib/orders/order-payment-input";
import { paymentFieldsFrom, paymentRowFrom, type PaymentBody } from "@/lib/payments/payment-input";
import { mapProjectTypeToExpenseDomain } from "@/lib/expenses";
import { normalizeVatRate } from "@/lib/settings/vat";
import type { PaymentRow } from "@/lib/payments";

// Payments saved on the phone first (owner's OK 2026-10-08): added to an order
// or a project, or marked collected, they're on every page drawn from the
// device copy at once — the order's paid status and balance, the project's
// money, the dashboard — with no connection too, and go to the server in the
// background through the same routes (lib/powersync/local-writes.ts). The
// Morning receipt is issued there, when the payment arrives. For the people
// whose pages are drawn from the copy (admins and office — payments are
// staff-only); null for everyone else, who save on the server as before. A
// payment with a photo or a file attached saves on the server.

type Db = NonNullable<ReturnType<typeof readyDeviceSaves>>["db"];

export type DevicePaymentSaves = {
  /**
   * A payment (or refund) on an order, from the order payment form's request.
   * Its id — or null when the phone doesn't have the order (save on the
   * server). Throws with the reason when the payment itself isn't valid.
   */
  addOrderPayment: (body: OrderPaymentBody) => Promise<string | null>;
  /**
   * Income on a project, from the income form's request: its row as the
   * server makes it — or null when the phone doesn't have the project.
   */
  addProjectPayment: (body: PaymentBody) => Promise<PaymentRow | null>;
  /** A payment marked collected (or back to waiting); false when the phone doesn't have it. */
  markCollected: (id: string, collected: boolean) => Promise<boolean>;
};

/** The VAT rate as the copy has it now (the server freezes its own on arrival). */
async function currentVatRate(db: Db): Promise<number> {
  const settings = await db.getOptional<{ vat_rate: unknown }>("SELECT vat_rate FROM business_settings LIMIT 1");
  return normalizeVatRate(settings?.vat_rate);
}

/** `page`: where the save shows — an order's page, the sales lists, a project's page. */
export function devicePaymentSaves(page: "orders" | "sales" | "projectPage"): DevicePaymentSaves | null {
  const ready = readyDeviceSaves(page);
  if (!ready) return null;
  const { db, viewerId } = ready;
  return {
    async addOrderPayment(body) {
      const built = orderPaymentFrom(body, viewerId);
      if ("error" in built) throw new Error(built.error);
      const order = await db.getOptional<{ id: string }>("SELECT id FROM orders WHERE id = ?", [built.orderId]);
      if (!order) return null;
      const id = crypto.randomUUID();
      await addPaymentOnDevice(db, { id, row: built.row, route: "order-payment", body: body as Record<string, unknown> });
      return id;
    },
    async addProjectPayment(body) {
      const fields = paymentFieldsFrom(body);
      if ("error" in fields) throw new Error(fields.error);
      const project = fields.projectId
        ? await db.getOptional<{ project_type: string | null }>("SELECT project_type FROM projects WHERE id = ?", [fields.projectId])
        : null;
      if (!project) return null;
      const row = paymentRowFrom(fields, {
        businessDomain: fields.businessDomain ?? mapProjectTypeToExpenseDomain(project.project_type),
        vatRate: fields.requiresSplit ? await currentVatRate(db) : undefined,
        recordedBy: viewerId,
      });
      const id = crypto.randomUUID();
      await addPaymentOnDevice(db, { id, row, route: "project-payment", body: body as Record<string, unknown> });
      const now = new Date().toISOString();
      return { id, ...row, created_at: now, updated_at: now };
    },
    markCollected: (id, collected) => markPaymentCollectedOnDevice(db, id, collected),
  };
}

/** Undo of a payment made on the phone that hasn't reached the server yet (no connection). */
export const PAYMENT_NOT_SENT_YET = "התשלום עוד לא הגיע לשרת — אפשר למחוק אותו כשיחזור החיבור.";
