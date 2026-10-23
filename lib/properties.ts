import type { SupabaseClient } from "@supabase/supabase-js";
import { MONEY_CURRENCY_COLUMNS, readForeignMoney, type ForeignMoney } from "@/lib/fx/currencies";
import { fetchAllPaged } from "@/lib/supabase/paginate";
import { STORAGE_BUCKET } from "@/lib/storage";
import type { SalaryAgreementRow, WorkSessionRow } from "@/lib/payroll";
import { israelDateKey } from "@/lib/timezone";
import {
  hasRenters,
  rentAllocationOf,
  renterPayments,
  rentThisPeriod,
  runningLeases,
  type RentMonthStatus,
  type RentPayment,
  type RentShare,
} from "@/lib/property-rent";
import { addressFromColumns, addressNotFound } from "@/lib/address/columns";
import type { StructuredAddress } from "@/lib/address/structured";
import type { FinancialAttachment } from "@/lib/payments";

// ════════════════════════════════════════════════════════════════════════════
// Properties (נכסים) — a real estate asset with a lease history and its own
// income/expenses. Unlike vehicles (a generic tag), a property is linked via a
// direct `property_id` FK column already present on `expenses`/`payments`/
// `tasks`, so no tag/RPC rollup indirection is needed — the totals are summed
// straight from those tables.
// ════════════════════════════════════════════════════════════════════════════

export type Property = {
  id: string;
  name: string | null;
  address: string;
  /** Its address picked from Google (lib/address/structured.ts); null for one saved before the picker. */
  addr: StructuredAddress | null;
  /** The saved address was not found on Google Maps (lib/address/columns.ts). */
  addrNotFound?: boolean;
  assetDescription: string | null;
  isActive: boolean;
  /** 'building' | 'apartment' | 'house' | 'storage' | null (unset) — see propertyTypeLabel(). */
  propertyType: string | null;
  /** Only meaningful when propertyType === 'building' — a building has apartments, not a room count. */
  apartmentsCount: number | null;
  rooms: number | null;
  squareMeters: number | null;
  floor: number | null;
  bathrooms: number | null;
  mezuzahCount: number | null;
  lightBulbCount: number | null;
  /** The full set of keys the apartment has — what the office holds. What a
   *  given tenant received is `LeaseAgreement.keysHandedOver`, not this. */
  keyCount: number | null;
  hasPrivateEntrance: boolean;
  hasStorageRoom: boolean;
  hasParking: boolean;
  hasElevator: boolean;
  purchasedFrom: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchaseTax: number | null;
  landBlock: string | null;
  landParcel: string | null;
  landSubParcel: string | null;
  /** Utility account numbers ("מספר חוזה") — one per supplier, per apartment.
   *  Text, not numbers: identifiers with leading zeros and dashes, never summed. */
  electricityContractNumber: string | null;
  waterContractNumber: string | null;
  gasContractNumber: string | null;
  arnonaContractNumber: string | null;
  isFurnished: boolean;
  furnitureItems: string[];
  createdAt: string | null;
  updatedAt: string | null;
  /** Its place in the list, dragged by hand (owner's card); none yet: after them, by name. */
  sortOrder: number | null;
};

/** The label to show for a property everywhere in the app: its name if set,
 *  else its address (every property has an address; not every one has a name yet). */
export function propertyDisplayName(property: { name?: string | null; address: string }): string {
  return property.name?.trim() || property.address;
}

export type LeaseAgreement = {
  id: string;
  propertyId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  startDate: string | null;
  endDate: string | null;
  monthlyRentAmount: number;
  documentId: string | null;
  documentFileName: string | null;
  documentUrl: string | null;
  status: string | null;
  notes: string | null;
  depositType: string | null;
  depositAmount: number | null;
  depositReference: string | null;
  /** How many keys this tenant received at move-in — checked against at move-out. */
  keysHandedOver: number | null;
  /**
   * Day of the month rent is due. Null ⇒ fall back to the day in startDate,
   * which is what the app did before the column existed.
   */
  rentDayOfMonth: number | null;
  /** Paid on the regular or the Hebrew calendar (lib/rent-periods.ts). */
  rentCalendar: "gregorian" | "hebrew";
  /** The Hebrew month's day it's due (1–30), for a Hebrew-calendar lease. */
  rentHebrewDay: number | null;
  /** 1 = monthly, 12 = yearly; monthlyRentAmount is the amount per period. */
  periodMonths: number;
  /** A storage spot's size and name ("תא 4", "מחסן ליד D4"). */
  areaSqm: number | null;
  unitLabel: string | null;
  createdAt: string | null;
};

export type PropertyRollup = {
  totalExpenseAmount: number;
  paidExpenseAmount: number;
  /** totalExpenseAmount - paidExpenseAmount: expenses booked but not (fully) paid yet — the "צפוי" amount. */
  expectedExpenseAmount: number;
  totalIncomeAmount: number;
};

const EMPTY_ROLLUP: PropertyRollup = {
  totalExpenseAmount: 0,
  paidExpenseAmount: 0,
  expectedExpenseAmount: 0,
  totalIncomeAmount: 0,
};

export type PropertyWithLease = Property & {
  currentLease: LeaseAgreement | null;
  rollup: PropertyRollup;
  /** Where this month's rent stands (lib/property-rent.ts) — the list card's chip. */
  rentThisMonth: RentMonthStatus;
  /**
   * A property with renters (a storage property, or two leases at once): how
   * many, how many have paid this period, and what they pay together. Null for
   * a property with one tenant.
   */
  renters: { count: number; paid: number; monthly: number; yearly: number } | null;
  /** Its tasks (open of all) and documents — the card's footer, like a car's. */
  counts: { tasks: number; openTasks: number; documents: number };
};

export type PropertyWithLeases = Property & { leases: LeaseAgreement[] };

type Row = Record<string, unknown>;

function num(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function str(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** collected = cleared or null/legacy; pending/rejected checks are NOT money in
 *  hand yet (matches lib/orders/paymentStatus.ts's isCollectedPayment convention). */
function isCollectedPaymentStatus(status: string | null) {
  return status !== "pending" && status !== "rejected";
}

function normalizeProperty(row: Row): Property {
  return {
    id: str(row.id) ?? "",
    name: str(row.name),
    address: str(row.address) ?? "",
    addr: addressFromColumns(row, "addr"),
    addrNotFound: addressNotFound(row),
    assetDescription: str(row.asset_description),
    isActive: row.is_active !== false,
    propertyType: str(row.property_type),
    apartmentsCount: numOrNull(row.apartments_count),
    rooms: numOrNull(row.rooms),
    squareMeters: numOrNull(row.square_meters),
    floor: numOrNull(row.floor),
    bathrooms: numOrNull(row.bathrooms),
    mezuzahCount: numOrNull(row.mezuzah_count),
    lightBulbCount: numOrNull(row.light_bulb_count),
    keyCount: numOrNull(row.key_count),
    hasPrivateEntrance: row.has_private_entrance === true,
    hasStorageRoom: row.has_storage_room === true,
    hasParking: row.has_parking === true,
    hasElevator: row.has_elevator === true,
    purchasedFrom: str(row.purchased_from),
    purchaseDate: str(row.purchase_date),
    purchasePrice: numOrNull(row.purchase_price),
    purchaseTax: numOrNull(row.purchase_tax),
    landBlock: str(row.land_block),
    landParcel: str(row.land_parcel),
    landSubParcel: str(row.land_sub_parcel),
    electricityContractNumber: str(row.electricity_contract_number),
    waterContractNumber: str(row.water_contract_number),
    gasContractNumber: str(row.gas_contract_number),
    arnonaContractNumber: str(row.arnona_contract_number),
    isFurnished: row.is_furnished === true,
    furnitureItems: Array.isArray(row.furniture_items)
      ? row.furniture_items.filter((x): x is string => typeof x === "string")
      : [],
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
    sortOrder: numOrNull(row.sort_order),
  };
}

function normalizeLease(row: Row): LeaseAgreement {
  const customer = (row.customer ?? {}) as Row | Row[];
  const customerRow = Array.isArray(customer) ? customer[0] : customer;
  return {
    id: str(row.id) ?? "",
    propertyId: str(row.property_id) ?? "",
    customerId: str(row.customer_id) ?? "",
    customerName: str(customerRow?.name),
    customerPhone: str(customerRow?.phone),
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    monthlyRentAmount: num(row.monthly_rent_amount),
    documentId: str(row.document_id),
    documentFileName: null,
    documentUrl: null,
    status: str(row.status),
    notes: str(row.notes),
    depositType: str(row.deposit_type),
    depositAmount: numOrNull(row.deposit_amount),
    depositReference: str(row.deposit_reference),
    keysHandedOver: numOrNull(row.keys_handed_over),
    rentDayOfMonth: numOrNull(row.rent_day_of_month),
    rentCalendar: str(row.rent_calendar) === "hebrew" ? "hebrew" : "gregorian",
    rentHebrewDay: numOrNull(row.rent_hebrew_day),
    periodMonths: numOrNull(row.period_months) === 12 ? 12 : 1,
    areaSqm: numOrNull(row.area_sqm),
    unitLabel: str(row.unit_label),
    createdAt: str(row.created_at),
  };
}

export function leaseStatusLabel(status: string | null): string {
  switch (status) {
    case "active":
      return "פעיל";
    case "ended":
      return "הסתיים";
    case "cancelled":
      return "בוטל";
    default:
      return status ?? "—";
  }
}

export function depositTypeLabel(type: string | null): string {
  switch (type) {
    case "cash":
      return "פיקדון כספי";
    case "bank_guarantee":
      return "ערבות בנקאית";
    case "security_check":
      return "צ'ק ביטחון";
    default:
      return type ?? "";
  }
}

export function propertyTypeLabel(type: string | null): string {
  switch (type) {
    case "building":
      return "בניין";
    case "apartment":
      return "דירה";
    case "house":
      return "בית";
    case "storage":
      return "מחסן";
    default:
      return "";
  }
}

/**
 * Does this kind of property have an interior layout — rooms, bathrooms,
 * mezuzot — or is it just floor area?
 *
 * A storage unit (מחסן) is let by the square meter: there is nothing to count
 * but its size, so those fields are hidden for it instead of standing empty and
 * inviting a "0" that means nothing. Everything else — including a property
 * whose type was never set — keeps the full set, so no existing property loses
 * a field.
 */
export function propertyHasRoomLayout(type: string | null): boolean {
  return type !== "storage";
}

/**
 * Prefer an active lease with no end_date or a future/today end_date; else the
 * most recently started lease of any status. Ties broken by start_date desc.
 */
export function pickCurrentLease(leases: LeaseAgreement[]): LeaseAgreement | null {
  if (leases.length === 0) return null;
  const today = israelDateKey();
  // Two starting the same day: by id, so the server and the device pick the same one.
  const sorted = [...leases].sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id.localeCompare(b.id));
  const openActive = sorted.find(
    (lease) => lease.status === "active" && (!lease.endDate || lease.endDate >= today)
  );
  return openActive ?? sorted[0];
}

const PROPERTY_SELECT =
  "id,name,address,addr_city,addr_street,addr_house_number,addr_unit,addr_lat,addr_lng,addr_place_id,addr_formatted,asset_description,is_active,property_type,apartments_count,rooms,square_meters,floor,bathrooms,mezuzah_count,light_bulb_count,key_count,has_private_entrance,has_storage_room,has_parking,has_elevator,purchased_from,purchase_date,purchase_price,purchase_tax,land_block,land_parcel,land_sub_parcel,electricity_contract_number,water_contract_number,gas_contract_number,arnona_contract_number,is_furnished,furniture_items,created_at,updated_at,sort_order";

const LEASE_SELECT =
  "id,property_id,customer_id,start_date,end_date,monthly_rent_amount,document_id,status,notes,deposit_type,deposit_amount,deposit_reference,keys_handed_over,rent_day_of_month,rent_calendar,rent_hebrew_day,period_months,area_sqm,unit_label,created_at,customer:customers(name,phone)";

/**
 * Every property with its current lease + income/expense rollup, computed in
 * JS from expenses/payments filtered by property_id. Resilient: returns []
 * before RLS is unlocked or on any error (mirrors fetchVehicles/fetchLoans).
 */
export async function fetchProperties(supabase: SupabaseClient): Promise<PropertyWithLease[]> {
  try {
    return await loadProperties(supabase);
  } catch {
    return [];
  }
}

/**
 * The same list, throwing when a read fails — for the device copy
 * (lib/powersync/dashboard-local.ts), where an empty list would hide a read it
 * couldn't do; the server version is shown instead.
 */
export async function loadProperties(supabase: SupabaseClient): Promise<PropertyWithLease[]> {
  const properties = (
    await fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("properties")
        .select(PROPERTY_SELECT)
        .range(lo, hi)
    )
  ).map(normalizeProperty);
  const ids = properties.map((p) => p.id).filter(Boolean);
  if (ids.length === 0) return [];

  const [leaseRows, expenseRows, paymentRows, sessionRows, taskRows, documentRows] = await Promise.all([
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("lease_agreements").select(LEASE_SELECT).in("property_id", ids).range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("expenses")
        .select("property_id,amount,payment_status,paid_amount")
        .in("property_id", ids)
        .range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("payments")
        .select("property_id,amount_total,payment_status,payment_date,lease_id,rent_period_start,rent_periods,rent_allocation,counts_as_rent")
        .in("property_id", ids)
        .range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("attendance_sessions").select("property_id,labor_cost").in("property_id", ids).range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) => supabase.from("tasks").select("property_id,status").in("property_id", ids).range(lo, hi)),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("document_links")
        .select("entity_id")
        .eq("entity_type", "property")
        .in("entity_id", ids)
        .range(lo, hi)
    ),
  ]);

  const leasesByProperty = new Map<string, LeaseAgreement[]>();
  for (const row of leaseRows) {
    const lease = normalizeLease(row);
    if (!lease.propertyId) continue;
    const list = leasesByProperty.get(lease.propertyId) ?? [];
    list.push(lease);
    leasesByProperty.set(lease.propertyId, list);
  }

  const rollupByProperty = new Map<string, PropertyRollup>();
  function rollupFor(propertyId: string) {
    const existing = rollupByProperty.get(propertyId);
    if (existing) return existing;
    const created = { totalExpenseAmount: 0, paidExpenseAmount: 0, expectedExpenseAmount: 0, totalIncomeAmount: 0 };
    rollupByProperty.set(propertyId, created);
    return created;
  }
  for (const row of expenseRows) {
    const propertyId = str(row.property_id);
    if (!propertyId) continue;
    const rollup = rollupFor(propertyId);
    rollup.totalExpenseAmount += num(row.amount);
    rollup.paidExpenseAmount += str(row.payment_status) === "paid" ? num(row.amount) : num(row.paid_amount);
  }
  const rentPaymentsByProperty = new Map<string, RentPayment[]>();
  for (const row of paymentRows) {
    const propertyId = str(row.property_id);
    if (!propertyId) continue;
    const list = rentPaymentsByProperty.get(propertyId) ?? [];
    list.push({
      date: str(row.payment_date),
      paymentStatus: str(row.payment_status),
      amount: num(row.amount_total),
      leaseId: str(row.lease_id),
      periodStart: str(row.rent_period_start),
      periods: numOrNull(row.rent_periods),
      countsAsRent: row.counts_as_rent !== false,
      allocation: rentAllocationOf(row.rent_allocation),
    });
    rentPaymentsByProperty.set(propertyId, list);
    if (!isCollectedPaymentStatus(str(row.payment_status))) continue;
    rollupFor(propertyId).totalIncomeAmount += num(row.amount_total);
  }
  // Worker labor cost counts as a real expense the moment the shift happens —
  // same unconditional rule fetchPropertyActivity uses (see its own comment).
  for (const row of sessionRows) {
    const propertyId = str(row.property_id);
    if (!propertyId) continue;
    const laborCost = Math.max(0, num(row.labor_cost));
    const rollup = rollupFor(propertyId);
    rollup.totalExpenseAmount += laborCost;
    rollup.paidExpenseAmount += laborCost;
  }
  for (const rollup of rollupByProperty.values()) {
    rollup.expectedExpenseAmount = rollup.totalExpenseAmount - rollup.paidExpenseAmount;
  }
  const countsByProperty = new Map<string, PropertyWithLease["counts"]>();
  const countsFor = (propertyId: string) => {
    const existing = countsByProperty.get(propertyId);
    if (existing) return existing;
    const created = { tasks: 0, openTasks: 0, documents: 0 };
    countsByProperty.set(propertyId, created);
    return created;
  };
  for (const row of taskRows) {
    const propertyId = str(row.property_id);
    if (!propertyId) continue;
    const counts = countsFor(propertyId);
    counts.tasks += 1;
    if (!["done", "cancelled"].includes(str(row.status) ?? "todo")) counts.openTasks += 1;
  }
  for (const row of documentRows) {
    const propertyId = str(row.entity_id);
    if (propertyId) countsFor(propertyId).documents += 1;
  }

  const today = israelDateKey();
  return properties
    .map((property) => {
      const leases = leasesByProperty.get(property.id) ?? [];
      const currentLease = pickCurrentLease(leases);
      const payments = rentPaymentsByProperty.get(property.id) ?? [];
      const running = runningLeases(leases, today);
      const renters = hasRenters(property.propertyType, running.length)
        ? {
            count: running.length,
            paid: running.filter((lease) => {
              const state = rentThisPeriod(lease, renterPayments(lease.id, payments, running.length === 1), today).state;
              return state === "paid" || state === "check";
            }).length,
            monthly: running.filter((l) => l.periodMonths !== 12).reduce((sum, l) => sum + l.monthlyRentAmount, 0),
            yearly: running.filter((l) => l.periodMonths === 12).reduce((sum, l) => sum + l.monthlyRentAmount, 0),
          }
        : null;
      return {
        ...property,
        currentLease,
        rollup: rollupByProperty.get(property.id) ?? EMPTY_ROLLUP,
        rentThisMonth: rentThisPeriod(currentLease, payments, today),
        renters,
        counts: countsByProperty.get(property.id) ?? { tasks: 0, openTasks: 0, documents: 0 },
      };
    })
    .sort(compareProperties);
}

/**
 * Each property's photo for the list's cards — its newest picture filed as
 * צילום (added from its card, or its page's photos), by property id, with a
 * signed link. Only a צילום: an image filed as anything else, or as nothing,
 * is never the property's picture (owner, 2026-10-22: "I don't want to end up
 * with, like, a receipt over there"). The server's only (the device copy has
 * no documents).
 */
export async function loadPropertyPhotos(supabase: SupabaseClient): Promise<Record<string, string>> {
  const links = await fetchAllPaged<Row>((lo, hi) =>
    supabase
      .from("document_links")
      .select("entity_id,document:documents(file_name,storage_key,document_type,uploaded_at)")
      .eq("entity_type", "property")
      .range(lo, hi)
  );
  const newest = new Map<string, { key: string; at: string }>();
  for (const link of links) {
    const propertyId = str(link.entity_id);
    const doc = linkDocument(link);
    const key = str(doc?.storage_key);
    if (!propertyId || !key) continue;
    if (str(doc?.document_type) !== "צילום") continue;
    const at = str(doc?.uploaded_at) ?? "";
    const kept = newest.get(propertyId);
    if (!kept || at > kept.at) newest.set(propertyId, { key, at });
  }
  if (newest.size === 0) return {};
  const { data: signed } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrls([...new Set([...newest.values()].map((p) => p.key))], 60 * 60);
  const urlByKey = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  const photos: Record<string, string> = {};
  for (const [propertyId, { key }] of newest) {
    const url = urlByKey.get(key);
    if (url) photos[propertyId] = url;
  }
  return photos;
}

/** The list's order: the owner's own (sort_order), then the rest by name. */
export function compareProperties(
  a: Pick<Property, "id" | "name" | "address" | "sortOrder">,
  b: Pick<Property, "id" | "name" | "address" | "sortOrder">
): number {
  if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.sortOrder != null && b.sortOrder == null) return -1;
  if (a.sortOrder == null && b.sortOrder != null) return 1;
  // Two of the same name: by id, so the server and the device list them alike.
  return propertyDisplayName(a).localeCompare(propertyDisplayName(b), "he") || a.id.localeCompare(b.id);
}

// ── The rent roll (/properties/rent) ────────────────────────────────────────

export type RentRollProperty = Pick<Property, "id" | "name" | "address" | "propertyType" | "isActive" | "sortOrder">;
export type RentRollPayment = PropertyPayment & { propertyId: string };
/** Every property, lease and property income — the month's rows are worked out from them (lib/rent-roll.ts). */
export type RentRollData = {
  properties: RentRollProperty[];
  leases: LeaseAgreement[];
  payments: RentRollPayment[];
  /** Every account's name, by its id — which account the rent came into. */
  accountNames: Record<string, string>;
};

/**
 * What the rent roll reads — the same on the server and the device copy
 * (lib/powersync/dashboard-local.ts). Throws when a read fails: an empty roll
 * would read as "nobody owes anything".
 */
export async function loadRentRoll(supabase: SupabaseClient): Promise<RentRollData> {
  const [propertyRows, leaseRows, paymentRows, accountRes] = await Promise.all([
    fetchAllPaged<Row>((lo, hi) =>
      supabase.from("properties").select("id,name,address,property_type,is_active,sort_order").order("id").range(lo, hi)
    ),
    fetchAllPaged<Row>((lo, hi) => supabase.from("lease_agreements").select(LEASE_SELECT).order("id").range(lo, hi)),
    fetchAllPaged<Row>((lo, hi) =>
      supabase
        .from("payments")
        .select(`${PROPERTY_PAYMENT_SELECT},property_id`)
        .not("property_id", "is", null)
        .order("id")
        .range(lo, hi)
    ),
    supabase.from("accounts").select("id,name"),
  ]);
  const properties: RentRollProperty[] = propertyRows
    .map((row) => ({
      id: str(row.id) ?? "",
      name: str(row.name),
      address: str(row.address) ?? "",
      propertyType: str(row.property_type),
      isActive: row.is_active !== false,
      sortOrder: numOrNull(row.sort_order),
    }))
    .sort(compareProperties);
  const leases = leaseRows.map(normalizeLease).sort((a, b) => a.id.localeCompare(b.id));
  const payments: RentRollPayment[] = paymentRows
    .map((row) => ({ ...normalizePropertyPayment(row), propertyId: str(row.property_id) ?? "" }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const accountNames: Record<string, string> = {};
  for (const row of rowsOf(accountRes, "accounts")) {
    const id = str(row.id);
    const name = str(row.name)?.trim();
    if (id && name) accountNames[id] = name;
  }
  return { properties, leases, payments, accountNames };
}

/**
 * The files on these payments — a check's photo, a transfer's confirmation —
 * with signed links (an hour), by payment id: the rent roll's check column.
 * The server's only (the device copy has no files).
 */
export async function loadPaymentFiles(supabase: SupabaseClient, paymentIds: string[]): Promise<Record<string, FinancialAttachment[]>> {
  const ids = [...new Set(paymentIds)].filter(Boolean);
  if (ids.length === 0) return {};
  const links = await linkedFiles(supabase, "payment", ids);
  const keys = [...new Set(links.map((link) => str(linkDocument(link)?.storage_key)).filter((key): key is string => Boolean(key)))];
  const urlByKey = new Map<string, string>();
  if (keys.length > 0) {
    const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(keys, 60 * 60);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlByKey.set(s.path, s.signedUrl);
    }
  }
  return filesByEntity(links, urlByKey);
}

// ── Per-property activity (the detail page) ─────────────────────────────────

export type PropertyExpense = {
  id: string;
  date: string | null;
  amount: number;
  category: string | null;
  description: string | null;
  paymentStatus: string | null;
  businessDomain: string | null;
  notes: string | null;
  paymentMethod: string | null;
  accountId: string | null;
  paidAmount: number | null;
  projectId: string | null;
  orderId: string | null;
  propertyId: string | null;
  /** Set when the row was generated from a recurring template (labelled by its name). */
  recurringTemplateId: string | null;
  /** In US$ or C$: the amount as typed and its rate — `amount` is its shekels. */
  foreign?: ForeignMoney | null;
  /** The files attached to it (a receipt, an invoice). */
  attachments: FinancialAttachment[];
};

export type PropertyPayment = {
  id: string;
  /** For a scheduled rent check: the month the rent is for (its due date is when the money comes in). */
  date: string | null;
  amount: number;
  method: string | null;
  dueDate: string | null;
  checkNumber: string | null;
  paymentStatus: string | null;
  /** When the check was torn up — its month paid another way (its status rejected too); null otherwise. */
  tornAt: string | null;
  accountId: string | null;
  /** What it was for, as written ("שכירות חודש אב") — the row's title. */
  notes: string | null;
  referenceNumber: string | null;
  requiresSplit: boolean;
  createdAt: string | null;
  /** The lease it's rent for, the period it starts paying and how many (lib/property-rent.ts). */
  leaseId: string | null;
  rentPeriodStart: string | null;
  rentPeriods: number;
  /** The months it was recorded for, ticked one by one, and how much went to each (payments.rent_allocation); null: evenly over its run. */
  rentAllocation: RentShare[] | null;
  /** False for income that isn't rent (a refund). */
  countsAsRent: boolean;
  /** In US$ or C$: the amount as typed and its rate — `amount` is its shekels. */
  foreign?: ForeignMoney | null;
  /** The files attached to it (a check's photo, a transfer confirmation). */
  attachments: FinancialAttachment[];
};

export type PropertyDocument = {
  id: string;
  title: string | null;
  fileName: string | null;
  documentType: string | null;
  uploadedAt: string | null;
  url: string | null;
};

export type PropertyTask = {
  id: string;
  subject: string | null;
  status: string | null;
  dueDate: string | null;
  /** "HH:MM" the task is due at, when one was chosen. */
  dueTime: string | null;
};

/**
 * A property-linked shift IS a `WorkSessionRow` — the exact shape
 * `ExpenseDialog`'s `editingSession` prop expects for admin edit/delete, so no
 * lossy camelCase transform happens here (unlike the rest of this file's
 * Property* types, which normalize snake_case DB rows into the app's own
 * convention). Kept as its own alias so property code doesn't import
 * `lib/payroll` directly at every call site.
 */
export type PropertySession = WorkSessionRow;

export function taskStatusLabel(status: string | null): string {
  switch (status) {
    case "in_progress":
      return "בתהליך";
    case "blocked":
      return "תקוע";
    case "done":
      return "הושלם";
    case "cancelled":
      return "בוטל";
    default:
      return "לביצוע";
  }
}

export type PropertyRecurringTemplate = {
  id: string;
  templateName: string | null;
  category: string | null;
  amount: number | null;
  isVariableAmount: boolean;
  autoPaid: boolean;
  reminderWorkDaysBefore: number | null;
  descriptionTemplate: string | null;
  notesTemplate: string | null;
  businessDomain: string | null;
  accountId: string | null;
  frequency: "monthly" | "yearly";
  intervalMonths: number;
  expenseDayOfMonth: number;
  expenseMonthOfYear: number | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
};

export function recurringFrequencyLabel(t: PropertyRecurringTemplate): string {
  if (t.frequency === "yearly") return "פעם בשנה";
  if (t.intervalMonths > 1) return `כל ${t.intervalMonths} חודשים`;
  return "כל חודש";
}

function normalizeRecurringTemplate(row: Row): PropertyRecurringTemplate {
  const frequency = str(row.frequency) === "yearly" ? "yearly" : "monthly";
  return {
    id: str(row.id) ?? "",
    templateName: str(row.template_name),
    category: str(row.category),
    amount: numOrNull(row.amount),
    isVariableAmount: row.is_variable_amount === true,
    autoPaid: row.auto_paid === true,
    reminderWorkDaysBefore: numOrNull(row.reminder_work_days_before),
    descriptionTemplate: str(row.description_template),
    notesTemplate: str(row.notes_template),
    businessDomain: str(row.business_domain),
    accountId: str(row.account_id),
    frequency,
    intervalMonths: numOrNull(row.interval_months) ?? 1,
    expenseDayOfMonth: numOrNull(row.expense_day_of_month) ?? 1,
    expenseMonthOfYear: numOrNull(row.expense_month_of_year),
    startDate: str(row.start_date),
    endDate: str(row.end_date),
    isActive: row.is_active !== false,
  };
}

const RECURRING_TEMPLATE_SELECT =
  "id,template_name,category,amount,is_variable_amount,auto_paid,reminder_work_days_before,description_template,notes_template,business_domain,account_id,frequency,interval_months,expense_day_of_month,expense_month_of_year,start_date,end_date,is_active";

export type PropertyActivity = {
  expenses: PropertyExpense[];
  payments: PropertyPayment[];
  documents: PropertyDocument[];
  tasks: PropertyTask[];
  recurringTemplates: PropertyRecurringTemplate[];
  sessions: PropertySession[];
  /** The files attached to each worker shift, by its id. */
  sessionAttachments: Record<string, FinancialAttachment[]>;
  /** Every account's name, by its id — the money table's חשבון column. */
  accountNames: Record<string, string>;
  /** The name of each recurring bill its expenses were generated from, by its id. */
  templateNames: Record<string, string>;
  rollup: PropertyRollup;
};

/** Ids in batches of 150 at most (a long .in() list overflows the request). */
function idBatches(ids: string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) batches.push(ids.slice(i, i + 150));
  return batches;
}

/** Each entity's document_links with the documents they point at, in one request per batch. */
async function linkedFiles(supabase: SupabaseClient, entityType: string, ids: string[]): Promise<Row[]> {
  const pages = await Promise.all(
    idBatches(ids).map((batch) =>
      supabase
        .from("document_links")
        .select("entity_id,document_id,created_at,document:documents(id,file_name,storage_key,uploaded_at,document_type)")
        .eq("entity_type", entityType)
        .in("entity_id", batch)
        .then(({ data }) => (data ?? []) as Row[])
    )
  );
  return pages.flat();
}

function linkDocument(link: Row): Row | null {
  const embedded = Array.isArray(link.document) ? link.document[0] : link.document;
  return embedded && typeof embedded === "object" ? (embedded as Row) : null;
}

function filesByEntity(links: Row[], urlByKey: Map<string, string>): Record<string, FinancialAttachment[]> {
  const byEntity: Record<string, FinancialAttachment[]> = {};
  for (const link of links) {
    const entityId = str(link.entity_id);
    const documentId = str(link.document_id);
    if (!entityId || !documentId) continue;
    const doc = linkDocument(link);
    const storageKey = str(doc?.storage_key);
    (byEntity[entityId] ??= []).push({
      document_id: documentId,
      file_name: str(doc?.file_name),
      storage_key: storageKey,
      uploaded_at: str(doc?.uploaded_at) ?? str(link.created_at),
      document_type: str(doc?.document_type),
      url: storageKey ? urlByKey.get(storageKey) ?? null : null,
    });
  }
  return byEntity;
}

// ── A property's page: the core and the server's part ───────────────────────
//
// The core is what the device copy also holds — the property and its leases,
// its money, shifts and tasks, the accounts' and the people's names — read
// the same way on the server and on the device (LocalPropertyPage, from the
// device copy, with this same code). The server's part is what only the
// server reads: the documents and every file's signed link, the leases' signed
// agreements, and the recurring bills listed for it (the device copy keeps
// the bills without the property they belong to). The page is the two merged
// (mergePropertyPage); on the device version the server's part fills in when
// it arrives.

/** Someone who can appear on the page: a shift's worker, a task's assignee. */
export type PropertyStaffUser = {
  id: string;
  label: string;
  color: string | null;
  role: string | null;
  active: boolean;
  payrollWorkerType: string | null;
  payTrackingMode: string | null;
};

export type PropertyPageCore = {
  property: PropertyWithLeases;
  /** Its documents, files and recurring bills empty — they're the server's part. */
  activity: PropertyActivity;
  users: PropertyStaffUser[];
  /** The rates of the workers with a shift here — the shift dialog's labor cost. */
  salaryAgreements: SalaryAgreementRow[];
};

export type PropertyServerParts = {
  /** Each lease's signed agreement, by its document id. */
  leaseFiles: Record<string, { fileName: string | null; url: string | null }>;
  documents: PropertyDocument[];
  /** The files on each expense, payment and shift, by its id. */
  files: Record<"expense" | "payment" | "session", Record<string, FinancialAttachment[]>>;
  recurringTemplates: PropertyRecurringTemplate[];
};

const EMPTY_SERVER_PARTS: PropertyServerParts = {
  leaseFiles: {},
  documents: [],
  files: { expense: {}, payment: {}, session: {} },
  recurringTemplates: [],
};

const PROPERTY_EXPENSE_SELECT =
  `id,expense_date,amount,category,description,payment_status,paid_amount,business_domain,notes,payment_method,account_id,project_id,order_id,property_id,recurring_expense_template_id,${MONEY_CURRENCY_COLUMNS}`;
const PROPERTY_PAYMENT_SELECT =
  `id,payment_date,amount_total,payment_method,due_date,check_number,payment_status,check_torn_at,account_id,notes,reference_number,requires_split,created_at,lease_id,rent_period_start,rent_periods,rent_allocation,counts_as_rent,${MONEY_CURRENCY_COLUMNS}`;
const PROPERTY_SESSION_SELECT =
  "id,user_id,clock_in,clock_out,worked_minutes,labor_cost,is_billable_to_customer,bill_to_customer_amount,billing_status,notes,business_domain,project_id,property_id";
const SALARY_AGREEMENT_SELECT =
  "id,user_id,salary_type,hourly_rate,monthly_salary,valid_from,valid_to,notes,overtime_rate,standard_daily_hours,due_day_of_next_month,business_domain,project_id,property_id";

function normalizePropertyPayment(r: Row): PropertyPayment {
  return {
    id: str(r.id) ?? "",
    date: str(r.payment_date),
    amount: num(r.amount_total),
    method: str(r.payment_method),
    dueDate: str(r.due_date),
    checkNumber: str(r.check_number),
    paymentStatus: str(r.payment_status),
    tornAt: str(r.check_torn_at),
    accountId: str(r.account_id),
    notes: str(r.notes),
    referenceNumber: str(r.reference_number),
    requiresSplit: r.requires_split === true,
    createdAt: str(r.created_at),
    leaseId: str(r.lease_id),
    rentPeriodStart: str(r.rent_period_start),
    rentPeriods: numOrNull(r.rent_periods) ?? 1,
    rentAllocation: rentAllocationOf(r.rent_allocation),
    countsAsRent: r.counts_as_rent !== false,
    foreign: readForeignMoney(r),
    attachments: [],
  };
}

/** A read's rows, or the error that stopped it — the device shows the server version then. */
function rowsOf(result: { data: unknown; error: { message?: string } | null }, what: string): Row[] {
  if (result.error) throw new Error(`${what}: ${result.error.message ?? "read failed"}`);
  return (result.data ?? []) as Row[];
}

const NO_ROWS = Promise.resolve({ data: [] as Row[], error: null });

/**
 * The page's core: null when there's no such property. Throws when a read
 * fails — an empty page would read as "no income, no tenant".
 */
export async function loadPropertyPageCore(supabase: SupabaseClient, propertyId: string): Promise<PropertyPageCore | null> {
  const [propertyRes, leaseRes, exRes, pmRes, tkRes, ssRes, accountRes, userRes] = await Promise.all([
    supabase.from("properties").select(PROPERTY_SELECT).eq("id", propertyId).maybeSingle(),
    supabase.from("lease_agreements").select(LEASE_SELECT).eq("property_id", propertyId),
    supabase.from("expenses").select(PROPERTY_EXPENSE_SELECT).eq("property_id", propertyId),
    supabase.from("payments").select(PROPERTY_PAYMENT_SELECT).eq("property_id", propertyId),
    supabase.from("tasks").select("id,subject,status,due_date,due_time").eq("property_id", propertyId),
    supabase.from("attendance_sessions").select(PROPERTY_SESSION_SELECT).eq("property_id", propertyId),
    supabase.from("accounts").select("id,name"),
    // Everyone, active or not — a shift's worker may since have left, and
    // their name still shows. Who can be picked is each dialog's own rule.
    supabase
      .from("users")
      .select("id,full_name,email,role,active,payroll_worker_type,pay_tracking_mode,avatar_color")
      .order("full_name", { ascending: true })
      .order("id", { ascending: true }),
  ]);
  if (propertyRes.error) throw new Error(`properties: ${propertyRes.error.message}`);
  if (!propertyRes.data) return null;
  const expenseRows = rowsOf(exRes, "expenses");
  const paymentRows = rowsOf(pmRes, "payments");
  // Kept as raw WorkSessionRow shape — see the PropertySession alias comment.
  const sessions = rowsOf(ssRes, "attendance_sessions") as unknown as PropertySession[];

  // The bills its expenses came from (their names), and the rates of the
  // workers with a shift here.
  const templateIds = [...new Set(expenseRows.map((r) => str(r.recurring_expense_template_id)).filter((v): v is string => Boolean(v)))];
  const sessionUserIds = [...new Set(sessions.map((s) => s.user_id).filter(Boolean))];
  const [templateRes, salaryRes] = await Promise.all([
    templateIds.length > 0
      ? supabase.from("recurring_expense_templates").select("id,template_name").in("id", templateIds)
      : NO_ROWS,
    sessionUserIds.length > 0
      ? supabase
          .from("salary_agreements")
          .select(SALARY_AGREEMENT_SELECT)
          .in("user_id", sessionUserIds)
          .order("valid_from", { ascending: false })
      : NO_ROWS,
  ]);

  const leases = rowsOf(leaseRes, "lease_agreements")
    .map(normalizeLease)
    .sort((a, b) => (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.id.localeCompare(b.id));
  const accountNames: Record<string, string> = {};
  for (const row of rowsOf(accountRes, "accounts")) {
    const id = str(row.id);
    const name = str(row.name)?.trim();
    if (id && name) accountNames[id] = name;
  }
  const templateNames: Record<string, string> = {};
  for (const row of rowsOf(templateRes, "recurring_expense_templates")) {
    const id = str(row.id);
    const name = str(row.template_name);
    if (id && name) templateNames[id] = name;
  }
  const users: PropertyStaffUser[] = rowsOf(userRes, "users").map((u) => ({
    id: str(u.id) ?? "",
    label: str(u.full_name) || str(u.email) || "משתמש",
    color: str(u.avatar_color),
    role: str(u.role),
    active: u.active !== false,
    payrollWorkerType: str(u.payroll_worker_type),
    payTrackingMode: str(u.pay_tracking_mode),
  }));

  const expenses: PropertyExpense[] = expenseRows.map((r) => ({
    id: str(r.id) ?? "",
    date: str(r.expense_date),
    amount: num(r.amount),
    category: str(r.category),
    description: str(r.description),
    paymentStatus: str(r.payment_status),
    businessDomain: str(r.business_domain),
    notes: str(r.notes),
    paymentMethod: str(r.payment_method),
    accountId: str(r.account_id),
    paidAmount: r.paid_amount == null ? null : num(r.paid_amount),
    projectId: str(r.project_id),
    orderId: str(r.order_id),
    propertyId: str(r.property_id),
    recurringTemplateId: str(r.recurring_expense_template_id),
    foreign: readForeignMoney(r),
    attachments: [],
  }));
  const payments: PropertyPayment[] = paymentRows.map(normalizePropertyPayment);
  const tasks: PropertyTask[] = rowsOf(tkRes, "tasks").map((r) => ({
    id: str(r.id) ?? "",
    subject: str(r.subject),
    status: str(r.status),
    dueDate: str(r.due_date),
    dueTime: str(r.due_time),
  }));

  // Same-day rows in one order on the server and the device (as read, they
  // come in any order): the newest recorded first, then by id.
  expenses.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  payments.sort(
    (a, b) =>
      (b.date ?? "").localeCompare(a.date ?? "") || (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.id.localeCompare(b.id)
  );
  tasks.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id.localeCompare(b.id));
  sessions.sort((a, b) => b.clock_in.localeCompare(a.clock_in) || a.id.localeCompare(b.id));

  const paidExpenseAmount = expenseRows.reduce(
    (sum, r) => sum + (str(r.payment_status) === "paid" ? num(r.amount) : num(r.paid_amount)),
    0
  );
  // Worker labor on this property is a real cost the moment the shift happens
  // — counted in full here regardless of whether the worker has since been
  // paid via payroll (that's tracked separately). Mirrors how
  // project_financials_view folds attendance_sessions.labor_cost into
  // total_expenses unconditionally.
  const sessionLaborTotal = sessions.reduce((s, x) => s + Math.max(0, num(x.labor_cost)), 0);
  const totalExpenseAmount = expenses.reduce((s, e) => s + e.amount, 0) + sessionLaborTotal;
  const paidExpenseAmountWithLabor = paidExpenseAmount + sessionLaborTotal;
  const rollup: PropertyRollup = {
    totalExpenseAmount,
    paidExpenseAmount: paidExpenseAmountWithLabor,
    // Session labor cost is counted equally in both totals above, so it
    // always nets to zero here — this is only ever the still-unpaid slice
    // of the property's own expenses (partial/not_paid rows).
    expectedExpenseAmount: totalExpenseAmount - paidExpenseAmountWithLabor,
    totalIncomeAmount: payments
      .filter((p) => isCollectedPaymentStatus(p.paymentStatus))
      .reduce((s, p) => s + p.amount, 0),
  };

  return {
    property: { ...normalizeProperty(propertyRes.data as Row), leases },
    activity: {
      expenses,
      payments,
      documents: [],
      tasks,
      recurringTemplates: [],
      sessions,
      sessionAttachments: {},
      accountNames,
      templateNames,
      rollup,
    },
    users,
    salaryAgreements: rowsOf(salaryRes, "salary_agreements") as unknown as SalaryAgreementRow[],
  };
}

/**
 * What only the server reads for a property's page: its documents (via
 * document_links, entity_type 'property'), the files on its expenses,
 * payments and shifts, its leases' signed agreements — every file with a
 * signed link, in one request — and its recurring bills. Resilient: nothing
 * of it on a failed read (the page shows without its files).
 */
export async function loadPropertyServerParts(supabase: SupabaseClient, propertyId: string): Promise<PropertyServerParts> {
  try {
    const idsOf = (rows: Row[], key = "id") => rows.map((r) => str(r[key])).filter((id): id is string => Boolean(id));
    const [exRes, pmRes, ssRes, leaseRes, linkRes, templateRes] = await Promise.all([
      supabase.from("expenses").select("id").eq("property_id", propertyId),
      supabase.from("payments").select("id").eq("property_id", propertyId),
      supabase.from("attendance_sessions").select("id").eq("property_id", propertyId),
      supabase.from("lease_agreements").select("document_id").eq("property_id", propertyId),
      supabase.from("document_links").select("document_id").eq("entity_type", "property").eq("entity_id", propertyId),
      supabase.from("recurring_expense_templates").select(RECURRING_TEMPLATE_SELECT).eq("property_id", propertyId),
    ]);
    const docIds = idsOf(rowsOf(linkRes, "document_links"), "document_id");
    const leaseDocIds = [...new Set(idsOf(rowsOf(leaseRes, "lease_agreements"), "document_id"))];
    const [docRows, leaseDocRows, expenseLinks, paymentLinks, sessionLinks] = await Promise.all([
      docIds.length > 0
        ? supabase
            .from("documents")
            .select("id,title,file_name,document_type,uploaded_at,storage_key")
            .in("id", docIds)
            .then((res) => rowsOf(res, "documents"))
        : [],
      leaseDocIds.length > 0
        ? supabase
            .from("documents")
            .select("id,file_name,storage_key")
            .in("id", leaseDocIds)
            .then((res) => rowsOf(res, "documents"))
        : [],
      linkedFiles(supabase, "expense", idsOf(rowsOf(exRes, "expenses"))),
      linkedFiles(supabase, "payment", idsOf(rowsOf(pmRes, "payments"))),
      linkedFiles(supabase, "session", idsOf(rowsOf(ssRes, "attendance_sessions"))),
    ]);

    // Every file's link in one request.
    const keys = new Set<string>();
    for (const row of [...docRows, ...leaseDocRows]) {
      const key = str(row.storage_key);
      if (key) keys.add(key);
    }
    for (const link of [...expenseLinks, ...paymentLinks, ...sessionLinks]) {
      const key = str(linkDocument(link)?.storage_key);
      if (key) keys.add(key);
    }
    const urlByKey = new Map<string, string>();
    if (keys.size > 0) {
      const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls([...keys], 60 * 60);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByKey.set(s.path, s.signedUrl);
      }
    }

    const leaseFiles: PropertyServerParts["leaseFiles"] = {};
    for (const row of leaseDocRows) {
      const id = str(row.id);
      if (!id) continue;
      const key = str(row.storage_key);
      leaseFiles[id] = { fileName: str(row.file_name), url: key ? urlByKey.get(key) ?? null : null };
    }
    const documents: PropertyDocument[] = docRows.map((r) => {
      const key = str(r.storage_key);
      return {
        id: str(r.id) ?? "",
        title: str(r.title),
        fileName: str(r.file_name),
        documentType: str(r.document_type),
        uploadedAt: str(r.uploaded_at),
        url: key ? urlByKey.get(key) ?? null : null,
      };
    });
    documents.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
    const recurringTemplates = rowsOf(templateRes, "recurring_expense_templates").map(normalizeRecurringTemplate);
    recurringTemplates.sort((a, b) => (a.templateName ?? "").localeCompare(b.templateName ?? "", "he"));

    return {
      leaseFiles,
      documents,
      files: {
        expense: filesByEntity(expenseLinks, urlByKey),
        payment: filesByEntity(paymentLinks, urlByKey),
        session: filesByEntity(sessionLinks, urlByKey),
      },
      recurringTemplates,
    };
  } catch {
    return EMPTY_SERVER_PARTS;
  }
}

/** The page: the core with the server's part — or, before it has come, the core alone. */
export function mergePropertyPage(
  core: PropertyPageCore,
  parts: PropertyServerParts | null
): { property: PropertyWithLeases; activity: PropertyActivity } {
  if (!parts) return { property: core.property, activity: core.activity };
  return {
    property: {
      ...core.property,
      leases: core.property.leases.map((lease) => {
        const file = lease.documentId ? parts.leaseFiles[lease.documentId] : undefined;
        return file ? { ...lease, documentFileName: file.fileName, documentUrl: file.url } : lease;
      }),
    },
    activity: {
      ...core.activity,
      expenses: core.activity.expenses.map((e) => ({ ...e, attachments: parts.files.expense[e.id] ?? [] })),
      payments: core.activity.payments.map((p) => ({ ...p, attachments: parts.files.payment[p.id] ?? [] })),
      documents: parts.documents,
      recurringTemplates: parts.recurringTemplates,
      sessionAttachments: parts.files.session,
    },
  };
}

// ── Dashboard card summary ──────────────────────────────────────────────────

export type PropertiesSummary = {
  vacant: { id: string; label: string }[];
  vacantCount: number;
  expiring: { id: string; propertyId: string; label: string; tenantName: string | null; endDate: string; daysLeft: number }[];
  expiringCount: number;
};

const EMPTY_PROPERTIES_SUMMARY: PropertiesSummary = { vacant: [], vacantCount: 0, expiring: [], expiringCount: 0 };

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is in the past). */
function daysUntil(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The "נכסים" dashboard card's data, in two narrow queries — deliberately NOT
 * fetchProperties(), which also pulls the full expense/payment rollup a card
 * never shows (mirrors getCollectionsSummary's own reasoning in lib/collections.ts).
 * A property is vacant when none of its leases is currently open (no end_date,
 * or an end_date that hasn't arrived yet); "expiring" is any ACTIVE lease whose
 * end_date falls within 60 days — a wider, quieter monitoring window than the
 * 30-day lease_expiry reminder rule, which is meant to actually nag.
 */
export async function getPropertiesSummary(
  supabase: SupabaseClient,
  todayIso?: string
): Promise<PropertiesSummary> {
  const today = todayIso ?? israelDateKey();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 60);
  const horizonIso = horizon.toISOString().slice(0, 10);
  try {
    const [propsRes, leasesRes] = await Promise.all([
      supabase.from("properties").select("id,name,address").eq("is_active", true),
      supabase
        .from("lease_agreements")
        .select("id,property_id,customer_id,end_date,status,customer:customers(name)")
        .eq("status", "active"),
    ]);
    if (propsRes.error) return EMPTY_PROPERTIES_SUMMARY;

    const properties = (propsRes.data ?? []) as Row[];
    const leases = (leasesRes.data ?? []) as Row[];
    const labelById = new Map<string, string>();
    for (const p of properties) {
      const id = str(p.id);
      if (id) labelById.set(id, str(p.name) || str(p.address) || "נכס");
    }

    const leasesByProperty = new Map<string, Row[]>();
    for (const l of leases) {
      const propertyId = str(l.property_id);
      if (!propertyId) continue;
      const list = leasesByProperty.get(propertyId) ?? [];
      list.push(l);
      leasesByProperty.set(propertyId, list);
    }

    const vacant = properties
      .map((p) => str(p.id))
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        const propertyLeases = leasesByProperty.get(id) ?? [];
        return !propertyLeases.some((l) => {
          const end = str(l.end_date);
          return !end || end >= today;
        });
      })
      .map((id) => ({ id, label: labelById.get(id) ?? "נכס" }))
      // By name (then id) — the database returns the properties in no set order.
      .sort((a, b) => a.label.localeCompare(b.label, "he") || a.id.localeCompare(b.id));

    const expiring = leases
      .filter((l) => {
        const end = str(l.end_date);
        return Boolean(end && end <= horizonIso);
      })
      .map((l) => {
        const propertyId = str(l.property_id) ?? "";
        const customer = (Array.isArray(l.customer) ? l.customer[0] : l.customer) as Row | undefined;
        const endDate = str(l.end_date) ?? "";
        return {
          id: str(l.id) ?? "",
          propertyId,
          label: labelById.get(propertyId) ?? "נכס",
          tenantName: str(customer?.name),
          endDate,
          daysLeft: daysUntil(today, endDate),
        };
      })
      .sort((a, b) => a.endDate.localeCompare(b.endDate));

    return { vacant, vacantCount: vacant.length, expiring, expiringCount: expiring.length };
  } catch {
    return EMPTY_PROPERTIES_SUMMARY;
  }
}
