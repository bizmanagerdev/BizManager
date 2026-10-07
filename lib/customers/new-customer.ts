import { normalizeIsraeliPhone } from "@/lib/phone";

// A new customer, as the forms collect it — and the customers row it makes,
// built the SAME way on the server (app/api/customers/create) and on the phone
// (lib/customers/device-customer-saves.ts, saving on the device copy first), so
// the row the phone shows at once is the row the server then keeps. Its
// contacts and branches go in the same request when the phone sends it (one
// change in its queue); the server creates them right after the customer.

export type NewCustomerContact = {
  full_name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  notes: string | null;
  is_primary: boolean;
  active: boolean;
};

export type NewCustomerBranch = {
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
};

export type NewCustomerInput = {
  name: string;
  name_for_invoice: string | null;
  registration_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string;
  /** Street and number — the row's address is "city | street". */
  street: string | null;
  notes: string | null;
  requires_prepayment: boolean;
  /** The users row that is the same person as this customer (a worker who buys from us). */
  linked_user_id: string | null;
  tag_ids: string[];
  contacts: NewCustomerContact[];
  branches: NewCustomerBranch[];
};

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

/** The customers row a new customer gets (no id — the caller adds it). */
export function newCustomerRow(input: Pick<NewCustomerInput, Exclude<keyof NewCustomerInput, "tag_ids" | "contacts" | "branches" | "linked_user_id">>) {
  const name = input.name.trim();
  const city = input.city.trim();
  const street = text(input.street);
  return {
    name,
    name_for_invoice: text(input.name_for_invoice) ?? name,
    registration_number: text(input.registration_number),
    phone: normalizeIsraeliPhone(text(input.phone)) ?? null,
    whatsapp: text(input.whatsapp),
    city,
    email: text(input.email),
    address: street ? `${city} | ${street}` : city || null,
    active: true,
    notes: text(input.notes),
    requires_prepayment: input.requires_prepayment === true,
  };
}

/** The contacts sent with a new customer, cleaned up: named ones only, one primary at most. */
export function parseNewCustomerContacts(value: unknown): NewCustomerContact[] {
  if (!Array.isArray(value)) return [];
  const contacts = value
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      full_name: text(c.full_name) ?? "",
      role: text(c.role),
      phone: normalizeIsraeliPhone(text(c.phone)) ?? null,
      email: text(c.email),
      whatsapp: text(c.whatsapp),
      notes: text(c.notes),
      is_primary: c.is_primary === true && c.active !== false,
      active: c.active !== false,
    }))
    .filter((c) => c.full_name);
  let primarySeen = false;
  return contacts.map((c) => {
    if (!c.is_primary) return c;
    if (primarySeen) return { ...c, is_primary: false };
    primarySeen = true;
    return c;
  });
}

/** The branches sent with a new customer, cleaned up: named ones only. */
export function parseNewCustomerBranches(value: unknown): NewCustomerBranch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
    .map((b) => ({
      name: text(b.name) ?? "",
      address: text(b.address),
      phone: normalizeIsraeliPhone(text(b.phone)) ?? null,
      active: b.active !== false,
    }))
    .filter((b) => b.name);
}
