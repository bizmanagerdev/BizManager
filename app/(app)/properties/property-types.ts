// Split out of PropertyFormFields.tsx (a "use client" component) so that
// actions.ts (a "use server" actions file) never imports across that
// boundary — even a type-only import from a client component into a server
// actions file was enough to leave a dangling runtime reference in
// production (Sentry: "ReferenceError: PropertyInput is not defined" on
// POST /properties and /properties/[id]). Plain shared types belong in their
// own directive-free module, not borrowed from either side.
import type { StructuredAddress } from "@/lib/address/structured";

export type PropertyInput = {
  name: string;
  /** Its line: the picked address's, or as saved before the picker. */
  address: string;
  /** Picked from Google (components/ui/address-picker.tsx). */
  addr: StructuredAddress | null;
  /** The saved address was not found on Google Maps: kept marked until a new one is picked. */
  addr_not_found?: boolean;
  asset_description: string;
  is_active: boolean;
  /** '' | 'building' | 'apartment' | 'house' | 'storage' */
  property_type: string;
  /** Only used when property_type === 'building' */
  apartments_count: string;
  rooms: string;
  square_meters: string;
  floor: string;
  bathrooms: string;
  mezuzah_count: string;
  light_bulb_count: string;
  key_count: string;
  has_private_entrance: boolean;
  has_storage_room: boolean;
  has_parking: boolean;
  has_elevator: boolean;
  purchased_from: string;
  purchase_date: string;
  purchase_price: string;
  purchase_tax: string;
  land_block: string;
  land_parcel: string;
  land_sub_parcel: string;
  electricity_contract_number: string;
  water_contract_number: string;
  gas_contract_number: string;
  arnona_contract_number: string;
  is_furnished: boolean;
  furniture_items: string[];
  /** A management company collects the rent — its name, owner-portal link and notes (owner, 2026-10-23). */
  rent_managed_by_company: boolean;
  management_company_name: string;
  management_portal_url: string;
  management_notes: string;
  /** The company that bought the property. */
  owner_company_name: string;
  owner_company_number: string;
  owner_company_type: string;
  owner_company_url: string;
  owner_company_notes: string;
  /** ייעוד, מחוז, the city's property-tax account (owner, 2026-10-23). */
  zoning: string;
  region: string;
  tax_account_number: string;
  /** Its links: the tax account online, the land register, another title service (JLR). */
  tax_account_url: string;
  land_registry_url: string;
  land_title_url: string;
};
