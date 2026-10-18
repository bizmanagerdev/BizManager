// The structured address (lib/address/structured.ts) in and out of the
// database: the same eight columns on every table that keeps an address
// (migration 20261018110000) — addr_* on customers, customer_branches, tasks
// and properties, origin_* / destination_* on projects.

import { hebrewPlaceName, type StructuredAddress } from "@/lib/address/structured";

export type AddressPrefix = "addr" | "origin" | "destination";

const PARTS = ["city", "street", "house_number", "unit", "lat", "lng", "place_id", "formatted"] as const;

/** A row's eight address columns, typed: addr_city, addr_lat, … */
export type AddressColumnRow<P extends AddressPrefix> = {
  [K in `${P}_${"city" | "street" | "house_number" | "unit" | "place_id" | "formatted"}`]: string | null;
} & { [K in `${P}_${"lat" | "lng"}`]: number | null };

/**
 * A saved address Google couldn't find, or found somewhere else (owner,
 * 2026-10-18: "these addresses are wrong … it should not let him click the
 * Waze or click the share button"). Kept in the place-id column, which a
 * picked address always overwrites — so picking a real one clears it. The old
 * address line stays as it was.
 */
export const ADDRESS_NOT_FOUND = "not_found";

export function addressNotFound(row: Record<string, unknown> | null | undefined, prefix: AddressPrefix = "addr"): boolean {
  return row?.[`${prefix}_place_id`] === ADDRESS_NOT_FOUND;
}

/** "addr_city,addr_street,…" for a select. */
export function addressColumns(prefix: AddressPrefix): string[] {
  return PARTS.map((part) => `${prefix}_${part}`);
}
export function addressSelect(prefix: AddressPrefix): string {
  return addressColumns(prefix).join(",");
}

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
// A name that carries other languages (a broken Google entry, lib/address/structured.ts
// hebrewPlaceName) is cut down to its Hebrew part before it's written.
const FOREIGN = /[A-Za-zͰ-ϿЀ-ӿ؀-ۿऀ-෿•,]/;
const hebrewOnly = (value: string): string => (FOREIGN.test(value) ? hebrewPlaceName(value) : value);
const coord = (value: unknown, limit: number): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limit && n !== 0 ? n : null;
};

/** The row's columns for an address; all null for no address. */
export function addressToColumns<P extends AddressPrefix>(address: StructuredAddress | null, prefix: P): AddressColumnRow<P> {
  const a = address;
  const nullIfEmpty = (v: string) => (v ? v : null);
  return {
    [`${prefix}_city`]: a ? nullIfEmpty(a.city.trim()) : null,
    [`${prefix}_street`]: a ? nullIfEmpty(a.street.trim()) : null,
    [`${prefix}_house_number`]: a ? nullIfEmpty(a.houseNumber.trim()) : null,
    [`${prefix}_unit`]: a ? nullIfEmpty(a.unit.trim()) : null,
    [`${prefix}_lat`]: a?.lat ?? null,
    [`${prefix}_lng`]: a?.lng ?? null,
    [`${prefix}_place_id`]: a ? nullIfEmpty((a.placeId ?? "").trim()) : null,
    [`${prefix}_formatted`]: a ? nullIfEmpty(a.formatted.trim()) : null,
  } as AddressColumnRow<P>;
}

/**
 * The columns a save writes: the picked address — or, when none was picked
 * and the saved one is marked not found, that mark kept, so an edit of
 * something else (a price, a note) doesn't quietly drop the warning.
 */
export function addressColumnsKeepingMark<P extends AddressPrefix>(
  address: StructuredAddress | null,
  prefix: P,
  keepMark: boolean
): AddressColumnRow<P> {
  const columns = addressToColumns(address, prefix);
  if (!address && keepMark) (columns as Record<string, unknown>)[`${prefix}_place_id`] = ADDRESS_NOT_FOUND;
  return columns;
}

/**
 * The address a request carries for one prefix: `<prefix>_structured` from a
 * form (null for none), else the row's own columns (a phone's queued row).
 */
export function structuredFromRequest(body: Record<string, unknown>, prefix: AddressPrefix): StructuredAddress | null {
  const key = `${prefix}_structured`;
  if (key in body) return parseStructuredAddress(body[key]) ?? null;
  return parseStructuredAddress(addressFromColumns(body, prefix)) ?? null;
}

/**
 * One address column's value, checked on its own — for a save that sends only
 * the fields that changed (a task's autosave). Null for anything not right.
 */
export function sanitizeAddressColumn(column: string, value: unknown): string | number | null {
  const part = column.replace(/^(addr|origin|destination)_/, "");
  if (part === "lat") return coord(value, 90);
  if (part === "lng") return coord(value, 180);
  if (part === "place_id") {
    const id = text(value, 300);
    return /^[A-Za-z0-9_-]{10,300}$/.test(id) ? id : null;
  }
  const max = part === "house_number" ? 20 : part === "city" ? 120 : part === "formatted" ? 300 : 200;
  return text(value, max) || null;
}

/** The address a row keeps, or null when its structured fields are empty (an old row, or no address). */
export function addressFromColumns(row: Record<string, unknown> | null | undefined, prefix: AddressPrefix): StructuredAddress | null {
  if (!row) return null;
  const get = (part: string) => row[`${prefix}_${part}`];
  const address: StructuredAddress = {
    city: text(get("city"), 120),
    street: text(get("street"), 200),
    houseNumber: text(get("house_number"), 20),
    unit: text(get("unit"), 200),
    lat: coord(get("lat"), 90),
    lng: coord(get("lng"), 180),
    placeId: text(get("place_id"), 300) || null,
    formatted: text(get("formatted"), 300),
  };
  return address.city || address.street || address.formatted ? address : null;
}

/**
 * An address sent by a form, checked before it's written. `undefined` when the
 * request didn't carry one (an older client, or a save that didn't touch the
 * address: leave the columns alone); `null` for "no address".
 */
export function parseStructuredAddress(value: unknown): StructuredAddress | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const placeId = text(v.placeId, 300);
  const address: StructuredAddress = {
    city: hebrewOnly(text(v.city, 120)),
    street: hebrewOnly(text(v.street, 200)),
    houseNumber: text(v.houseNumber, 20),
    unit: text(v.unit, 200),
    lat: coord(v.lat, 90),
    lng: coord(v.lng, 180),
    placeId: /^[A-Za-z0-9_-]{10,300}$/.test(placeId) ? placeId : null,
    formatted: text(v.formatted, 300),
  };
  // Lat and lng come as a pair or not at all.
  if (address.lat === null || address.lng === null) {
    address.lat = null;
    address.lng = null;
  }
  return address.city || address.street || address.formatted ? address : null;
}
