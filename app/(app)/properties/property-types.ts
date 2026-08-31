// Split out of PropertyFormFields.tsx (a "use client" component) so that
// actions.ts (a "use server" actions file) never imports across that
// boundary — even a type-only import from a client component into a server
// actions file was enough to leave a dangling runtime reference in
// production (Sentry: "ReferenceError: PropertyInput is not defined" on
// POST /properties and /properties/[id]). Plain shared types belong in their
// own directive-free module, not borrowed from either side.
export type PropertyInput = {
  name: string;
  address: string;
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
};
