import { readyDeviceSaves } from "@/lib/powersync/store";
import { createCustomerOnDevice } from "@/lib/powersync/local-writes";
import { newCustomerRow, type NewCustomerInput } from "@/lib/customers/new-customer";
import type { CustomerRecord } from "@/components/customers/CustomerForm";

// Saving a new customer on the phone first (lib/powersync/local-writes.ts):
// the customer is on every page drawn from the device copy — the project and
// order forms' pickers included — the moment it's saved, with no connection
// too, and goes to the server in the background (its contacts and branches
// with it). For the people whose pages are drawn from the copy; null for
// everyone else, who save on the server as before.

export type DeviceCustomerSaves = {
  /** The new customer as the forms hand it on, and its contacts (shown, not yet numbered). */
  create: (input: NewCustomerInput) => Promise<{ customer: CustomerRecord; contacts: Record<string, unknown>[] }>;
};

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)
      );
}

export function deviceCustomerSaves(): DeviceCustomerSaves | null {
  const ready = readyDeviceSaves();
  if (!ready) return null;
  const { db } = ready;
  return {
    async create(input) {
      const id = newId();
      await createCustomerOnDevice(db, { id, input });
      const row = newCustomerRow(input);
      return {
        customer: {
          id,
          name: row.name,
          name_for_invoice: row.name_for_invoice,
          registration_number: row.registration_number,
          phone: row.phone,
          whatsapp: row.whatsapp,
          email: row.email,
          address: row.address,
          active: true,
          notes: row.notes,
          requires_prepayment: row.requires_prepayment,
          linked_user_id: input.linked_user_id,
        },
        contacts: input.contacts.filter((contact) => contact.active),
      };
    },
  };
}
