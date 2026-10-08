import { readyDeviceSaves } from "@/lib/powersync/store";
import { createOrderOnDevice, updateOrderOnDevice } from "@/lib/orders/device-order-writes";

// Saving an order on the phone first (lib/orders/device-order-writes.ts):
// created or edited, it's on every page drawn from the device copy — the
// sales lists, the order's page, the deliveries and the stock tab, the
// dashboard — the moment it's saved, with no connection too, and goes to the
// server in the background (in order after a customer made with it), where
// the stock is reserved, the Morning documents issued and the "new order"
// alert sent. For the people whose sales pages are drawn from the copy; null
// for everyone else, who save on the server as before.

export type DeviceOrderSaves = {
  /**
   * A new order from the form's request body: its id. `restore`: the form as
   * it stands (its draft, under its key) — put back if the server refuses it.
   */
  create: (body: Record<string, unknown>, restore: { key: string; draft: unknown } | null) => Promise<string>;
  /** An edit from the form's request body; false when the phone doesn't have the order (save on the server). */
  update: (id: string, body: Record<string, unknown>) => Promise<boolean>;
};

export function deviceOrderSaves(): DeviceOrderSaves | null {
  const ready = readyDeviceSaves("sales");
  if (!ready) return null;
  const { db, viewerId } = ready;
  return {
    async create(body, restore) {
      const id = crypto.randomUUID();
      await createOrderOnDevice(db, { id, body, createdBy: viewerId, restore: restore ?? undefined });
      return id;
    },
    update: (id, body) => updateOrderOnDevice(db, { id, body, updatedBy: viewerId }),
  };
}

/** Undo of an order made on the phone that hasn't reached the server yet (no connection). */
export const ORDER_NOT_SENT_YET = "ההזמנה עוד לא הגיעה לשרת — אפשר למחוק אותה כשיחזור החיבור.";
