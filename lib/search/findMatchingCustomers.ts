import type { SupabaseClient } from "@supabase/supabase-js";
import {
  customerMatchScore,
  customerMatchesQuery,
  normalizeSearchText,
  type CustomerSearchContact,
  type CustomerSearchFields,
} from "@/lib/search/customerMatch";

/** A matched customer, shaped for the search API and the list loaders. */
export type MatchedCustomer = {
  id: string;
  name: string;
  name_for_invoice: string | null;
  registration_number: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  active: boolean;
  notes: string | null;
  requires_prepayment: boolean;
  contacts: Array<{ full_name: string; phone: string | null; email: string | null; whatsapp: string | null }>;
};

export type FindMatchingCustomersResult = {
  customers: MatchedCustomer[];
  customerIds: string[];
};

const CUSTOMER_COLUMNS =
  "id,name,name_for_invoice,registration_number,phone,whatsapp,email,address,active,notes,requires_prepayment";
const CONTACT_COLUMNS = "customer_id,full_name,phone,email,whatsapp";

/**
 * How many rows the typo-tolerant (fuzzy) pass scans. Exact/substring matches
 * are found across the WHOLE table via ilike regardless of this cap — only the
 * "similar name" fuzzy matching is bounded to this many customers/contacts.
 */
const FUZZY_SCAN_LIMIT = 1000;

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function rows(result: { data: unknown }): Row[] {
  return (result?.data ?? []) as Row[];
}

function toMatchedCustomer(row: Row): MatchedCustomer {
  return {
    id: str(row.id),
    name: str(row.name),
    name_for_invoice: nullableStr(row.name_for_invoice),
    registration_number: nullableStr(row.registration_number),
    phone: nullableStr(row.phone),
    whatsapp: nullableStr(row.whatsapp),
    email: nullableStr(row.email),
    address: nullableStr(row.address),
    active: row.active !== false,
    notes: nullableStr(row.notes),
    requires_prepayment: row.requires_prepayment === true,
    contacts: [],
  };
}

function toContact(row: Row): CustomerSearchContact {
  return {
    full_name: nullableStr(row.full_name),
    phone: nullableStr(row.phone),
    email: nullableStr(row.email),
    whatsapp: nullableStr(row.whatsapp),
  };
}

function fieldsFromRow(row: Row, contacts: CustomerSearchContact[] | undefined): CustomerSearchFields {
  return {
    name: str(row.name),
    name_for_invoice: str(row.name_for_invoice),
    email: str(row.email),
    phone: str(row.phone),
    whatsapp: str(row.whatsapp),
    address: str(row.address),
    registration_number: str(row.registration_number),
    contacts,
  };
}

function* chunked<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
}

type MatchPools = {
  customerRowById: Map<string, Row>;
  contactsByCustomer: Map<string, CustomerSearchContact[]>;
};

type MatchResult = {
  matchedIds: Set<string>;
  matchedContactsByCustomer: Map<string, MatchedCustomer["contacts"]>;
};

function addCustomerRows(pools: MatchPools, result: { data: unknown }) {
  for (const row of rows(result)) {
    const id = str(row.id);
    if (id && !pools.customerRowById.has(id)) pools.customerRowById.set(id, row);
  }
}

function addContactRows(pools: MatchPools, result: { data: unknown }) {
  for (const row of rows(result)) {
    const customerId = str(row.customer_id);
    if (!customerId) continue;
    const list = pools.contactsByCustomer.get(customerId) ?? [];
    list.push(toContact(row));
    pools.contactsByCustomer.set(customerId, list);
  }
}

/** Run the shared matching rules over the current candidate pools. */
function computeMatches(pools: MatchPools, query: string): MatchResult {
  const matchedIds = new Set<string>();
  const matchedContactsByCustomer = new Map<string, MatchedCustomer["contacts"]>();

  // (a) customers whose own fields match.
  for (const [id, row] of pools.customerRowById) {
    if (customerMatchesQuery(fieldsFromRow(row, undefined), query)) matchedIds.add(id);
  }

  // (b) customers reached through a matching contact (pull in the customer even
  // if its own fields don't match), and record which contacts matched.
  for (const [customerId, contacts] of pools.contactsByCustomer) {
    const matching = contacts.filter((contact) => customerMatchesQuery({ contacts: [contact] }, query));
    if (matching.length === 0) continue;
    matchedIds.add(customerId);
    matchedContactsByCustomer.set(
      customerId,
      matching.map((contact) => ({
        full_name: contact.full_name ?? "",
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        whatsapp: contact.whatsapp ?? null,
      }))
    );
  }

  return { matchedIds, matchedContactsByCustomer };
}

/**
 * Find customers matching a free-text query, applying the shared matching rules
 * (Hebrew-fuzzy names, phone↔whatsapp cross-match). Returns ranked customer
 * rows (with the matching contacts attached) plus their ids for list loaders.
 *
 * Strategy: a cheap, indexed `ilike` pass catches exact/substring matches across
 * the whole table — this is the fast path that serves the vast majority of
 * searches. Only when it finds NOTHING (a typo, a letter swap, an
 * oddly-formatted number) do we pay for the bounded fuzzy scan. This keeps
 * type-ahead instant instead of shipping thousands of rows on every keystroke.
 */
export async function findMatchingCustomers(
  supabase: SupabaseClient,
  rawQuery: string,
  options?: { limit?: number; idsOnly?: boolean }
): Promise<FindMatchingCustomersResult> {
  const query = rawQuery.trim();
  if (!query) return { customers: [], customerIds: [] };

  const resultLimit = Math.min(Math.max(options?.limit ?? 50, 1), 300);
  const idsOnly = options?.idsOnly === true;
  const escaped = query.replace(/[%,]/g, " ");

  const pools: MatchPools = { customerRowById: new Map(), contactsByCustomer: new Map() };

  // Fast path: indexed substring match across the whole table.
  const [ilikeCustomersRes, ilikeContactsRes] = await Promise.all([
    supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .or(
        `name.ilike.%${escaped}%,name_for_invoice.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,whatsapp.ilike.%${escaped}%,address.ilike.%${escaped}%`
      )
      .limit(300),
    supabase
      .from("contacts")
      .select(CONTACT_COLUMNS)
      .eq("active", true)
      .or(`full_name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%,whatsapp.ilike.%${escaped}%`)
      .limit(300),
  ]);
  addCustomerRows(pools, ilikeCustomersRes);
  addContactRows(pools, ilikeContactsRes);

  let { matchedIds, matchedContactsByCustomer } = computeMatches(pools, query);

  // Fallback: only when substring matching found nothing do we scan for
  // fuzzy (typo / letter-swap / re-formatted-number) matches.
  if (matchedIds.size === 0) {
    const [scanCustomersRes, scanContactsRes] = await Promise.all([
      supabase
        .from("customers")
        .select(CUSTOMER_COLUMNS)
        .order("name", { ascending: true })
        .range(0, FUZZY_SCAN_LIMIT - 1),
      supabase
        .from("contacts")
        .select(CONTACT_COLUMNS)
        .eq("active", true)
        .order("full_name", { ascending: true })
        .range(0, FUZZY_SCAN_LIMIT - 1),
    ]);
    addCustomerRows(pools, scanCustomersRes);
    addContactRows(pools, scanContactsRes);
    ({ matchedIds, matchedContactsByCustomer } = computeMatches(pools, query));
  }

  const customerRowById = pools.customerRowById;

  // List loaders only need ids (they filter their own query by customer_id) —
  // skip building full rows and the contact-only bulk fetch.
  if (idsOnly) {
    return { customers: [], customerIds: [...matchedIds].slice(0, resultLimit) };
  }

  // Fetch full rows for contact-only matches we don't already have.
  const missingIds = [...matchedIds].filter((id) => !customerRowById.has(id));
  for (const chunk of chunked(missingIds, 200)) {
    const { data } = await supabase.from("customers").select(CUSTOMER_COLUMNS).in("id", chunk);
    for (const row of (data ?? []) as Row[]) {
      const id = str(row.id);
      if (id) customerRowById.set(id, row);
    }
  }

  const customers = [...matchedIds]
    .map((id) => customerRowById.get(id))
    .filter((row): row is Row => Boolean(row))
    .map((row) => {
      const matched = toMatchedCustomer(row);
      matched.contacts = matchedContactsByCustomer.get(matched.id) ?? [];
      return matched;
    });

  customers.sort((left, right) => {
    const scoreLeft = customerMatchScore(fieldsFromRow(left as unknown as Row, undefined), query);
    const scoreRight = customerMatchScore(fieldsFromRow(right as unknown as Row, undefined), query);
    if (scoreLeft !== scoreRight) return scoreLeft - scoreRight;
    return normalizeSearchText(left.name).localeCompare(normalizeSearchText(right.name), "he");
  });

  const limited = customers.slice(0, resultLimit);
  return { customers: limited, customerIds: limited.map((customer) => customer.id) };
}
