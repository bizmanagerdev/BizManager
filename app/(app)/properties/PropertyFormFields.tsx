"use client";

// Shared property create/edit form — used by both the list page's dialog
// (PropertiesClient.tsx) and the detail page's edit dialog (PropertyDetailClient.tsx),
// so a field added here never drifts between the two entry points.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/ui/dictate-button";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { propertyHasRoomLayout, type Property } from "@/lib/properties";
import { appendDictatedText } from "@/lib/dictation";
import type { PropertyInput } from "./property-types";
import { AddressPicker } from "@/components/ui/address-picker";
import { addressLine } from "@/lib/address/structured";

export type { PropertyInput };

/** Common furnished-apartment items — the click-off half of "enter a list or
 *  click off a list". Custom items typed in below live in the same array. */
export const FURNITURE_PRESET_ITEMS = [
  "מיטה זוגית",
  "מיטת יחיד",
  "מזרן",
  "ארון בגדים",
  "שולחן וכיסאות פינת אוכל",
  "ספה",
  "מזגן",
  "מקרר",
  "תנור",
  "כיריים",
  "מיקרוגל",
  "מכונת כביסה",
  "מייבש כביסה",
  "דוד שמש",
  "טלוויזיה",
  "וילונות/תריסים",
];

export const EMPTY_PROPERTY_FORM: PropertyInput = {
  name: "",
  address: "",
  addr: null,
  asset_description: "",
  is_active: true,
  property_type: "",
  apartments_count: "",
  rooms: "",
  square_meters: "",
  floor: "",
  bathrooms: "",
  mezuzah_count: "",
  light_bulb_count: "",
  key_count: "",
  has_private_entrance: false,
  has_storage_room: false,
  has_parking: false,
  has_elevator: false,
  purchased_from: "",
  purchase_date: "",
  purchase_price: "",
  purchase_tax: "",
  land_block: "",
  land_parcel: "",
  land_sub_parcel: "",
  electricity_contract_number: "",
  water_contract_number: "",
  gas_contract_number: "",
  arnona_contract_number: "",
  is_furnished: false,
  furniture_items: [],
  rent_managed_by_company: false,
  management_company_name: "",
  management_portal_url: "",
  management_notes: "",
  owner_company_name: "",
  owner_company_number: "",
  owner_company_type: "",
  owner_company_url: "",
  owner_company_notes: "",
};

export function propertyToForm(p: Property): PropertyInput {
  return {
    name: p.name ?? "",
    address: p.address ?? "",
    addr: p.addr ?? null,
    addr_not_found: p.addrNotFound === true,
    asset_description: p.assetDescription ?? "",
    is_active: p.isActive,
    property_type: p.propertyType ?? "",
    apartments_count: p.apartmentsCount != null ? String(p.apartmentsCount) : "",
    rooms: p.rooms != null ? String(p.rooms) : "",
    square_meters: p.squareMeters != null ? String(p.squareMeters) : "",
    floor: p.floor != null ? String(p.floor) : "",
    bathrooms: p.bathrooms != null ? String(p.bathrooms) : "",
    mezuzah_count: p.mezuzahCount != null ? String(p.mezuzahCount) : "",
    light_bulb_count: p.lightBulbCount != null ? String(p.lightBulbCount) : "",
    key_count: p.keyCount != null ? String(p.keyCount) : "",
    has_private_entrance: p.hasPrivateEntrance,
    has_storage_room: p.hasStorageRoom,
    has_parking: p.hasParking,
    has_elevator: p.hasElevator,
    purchased_from: p.purchasedFrom ?? "",
    purchase_date: p.purchaseDate ?? "",
    purchase_price: p.purchasePrice != null ? String(p.purchasePrice) : "",
    purchase_tax: p.purchaseTax != null ? String(p.purchaseTax) : "",
    land_block: p.landBlock ?? "",
    land_parcel: p.landParcel ?? "",
    land_sub_parcel: p.landSubParcel ?? "",
    electricity_contract_number: p.electricityContractNumber ?? "",
    water_contract_number: p.waterContractNumber ?? "",
    gas_contract_number: p.gasContractNumber ?? "",
    arnona_contract_number: p.arnonaContractNumber ?? "",
    is_furnished: p.isFurnished,
    furniture_items: p.furnitureItems,
    rent_managed_by_company: p.rentManagedByCompany,
    management_company_name: p.managementCompanyName ?? "",
    management_portal_url: p.managementPortalUrl ?? "",
    management_notes: p.managementNotes ?? "",
    owner_company_name: p.ownerCompanyName ?? "",
    owner_company_number: p.ownerCompanyNumber ?? "",
    owner_company_type: p.ownerCompanyType ?? "",
    owner_company_url: p.ownerCompanyUrl ?? "",
    owner_company_notes: p.ownerCompanyNotes ?? "",
  };
}

/** The click-off grid + free-text-add chip list — used only when `is_furnished`
 *  is checked. Preset vs. custom is derived (membership in FURNITURE_PRESET_ITEMS),
 *  not stored: both kinds live in the same flat `furniture_items` array. */
function FurnitureChecklist({
  items,
  onToggle,
  onAddCustom,
  onRemoveCustom,
}: {
  items: string[];
  onToggle: (item: string) => void;
  onAddCustom: (item: string) => void;
  onRemoveCustom: (item: string) => void;
}) {
  const [customText, setCustomText] = useState("");
  const presetSet = new Set(FURNITURE_PRESET_ITEMS);
  const customItems = items.filter((item) => !presetSet.has(item));

  function addCustom() {
    const trimmed = customText.trim();
    if (!trimmed || items.includes(trimmed)) {
      setCustomText("");
      return;
    }
    onAddCustom(trimmed);
    setCustomText("");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {FURNITURE_PRESET_ITEMS.map((item) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={items.includes(item)} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
        ))}
      </div>
      {customItems.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {customItems.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemoveCustom(item)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`הסרת ${item}`}
              >
                <CloseIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="פריט נוסף..."
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addCustom}>
          הוספה
        </Button>
      </div>
    </div>
  );
}

type FieldsProps = {
  form: PropertyInput;
  set: <K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) => void;
};

/** Name/address/description/physical facts/amenities/active — the "פרטי הנכס" card's fields. */
export function PropertyBasicFields({ form, set }: FieldsProps) {
  // A מחסן is let by the square meter — no rooms, bathrooms or mezuzot to count.
  const hasRoomLayout = propertyHasRoomLayout(form.property_type);

  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">שם הנכס *</span>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="לדוגמה: דירה 3, ריבל שמח 29" />
      </label>
      {/* Picked from Google's list like every address (owner, 2026-10-16). */}
      <div className="space-y-1 text-sm">
        <span className="font-medium">כתובת *</span>
        <AddressPicker
          value={form.addr}
          onChange={(next) => {
            set("addr", next);
            set("address", next ? addressLine(next) : "");
            set("addr_not_found", false);
          }}
          legacyText={form.addr ? null : form.address}
        />
        {form.addr_not_found && !form.addr ? (
          <p className="text-xs font-medium text-destructive">הכתובת השמורה לא נמצאה ב-Google Maps · צריך לבחור כתובת חדשה</p>
        ) : null}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">סוג נכס</span>
        <NativeSelect value={form.property_type} onChange={(e) => set("property_type", e.target.value)}>
          <option value="">ללא בחירה</option>
          <option value="building">בניין</option>
          <option value="apartment">דירה</option>
          <option value="house">בית</option>
          <option value="storage">מחסן</option>
        </NativeSelect>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">פירוט הנכס</span>
        <div className="relative">
          <Textarea
            rows={2}
            value={form.asset_description}
            onChange={(e) => set("asset_description", e.target.value)}
            className="pe-11"
          />
          <DictateButton
            onTranscript={(text) => set("asset_description", appendDictatedText(form.asset_description, text))}
            className="absolute bottom-1 end-1 h-8 w-8"
          />
        </div>
      </label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {form.property_type === "building" ? (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">מספר דירות בבניין</span>
            <Input inputMode="numeric" value={form.apartments_count} onChange={(e) => set("apartments_count", e.target.value)} />
          </label>
        ) : hasRoomLayout ? (
          <label className="block space-y-1 text-sm">
            <span className="font-medium">מספר חדרים</span>
            <Input inputMode="decimal" value={form.rooms} onChange={(e) => set("rooms", e.target.value)} />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">מ״ר</span>
          <Input inputMode="decimal" value={form.square_meters} onChange={(e) => set("square_meters", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">קומה</span>
          <Input inputMode="numeric" value={form.floor} onChange={(e) => set("floor", e.target.value)} />
        </label>
        {hasRoomLayout ? (
          <>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">חדרי רחצה</span>
              <Input inputMode="numeric" value={form.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">מספר מזוזות</span>
              <Input inputMode="numeric" value={form.mezuzah_count} onChange={(e) => set("mezuzah_count", e.target.value)} />
            </label>
          </>
        ) : null}
        <label className="block space-y-1 text-sm">
          <span className="font-medium">מספר נורות</span>
          <Input inputMode="numeric" value={form.light_bulb_count} onChange={(e) => set("light_bulb_count", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          {/* The full set the office holds. How many a tenant received is on the
              lease ("מפתחות שנמסרו"), not here. */}
          <span className="font-medium">מספר מפתחות</span>
          <Input inputMode="numeric" value={form.key_count} onChange={(e) => set("key_count", e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.has_private_entrance}
            onChange={(e) => set("has_private_entrance", e.target.checked)}
          />
          <span>כניסה פרטית</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.has_storage_room} onChange={(e) => set("has_storage_room", e.target.checked)} />
          <span>מחסן</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.has_parking} onChange={(e) => set("has_parking", e.target.checked)} />
          <span>חניה</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.has_elevator} onChange={(e) => set("has_elevator", e.target.checked)} />
          <span>מעלית</span>
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
        <span>נכס פעיל</span>
      </label>
      <PropertyManagementFields form={form} set={set} />
    </div>
  );
}

/** "השכירות מנוהלת על ידי חברת ניהול" (owner, 2026-10-23: "a checkbox … when we add or when we edit it to mark it,
 *  we don't deal with the rent") and, ticked, the company's name, its owner portal and anything else about it
 *  ("I just want to save the link to the portal and the name of the company and if we have anything else"). */
export function PropertyManagementFields({ form, set }: FieldsProps) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.rent_managed_by_company}
          onChange={(e) => set("rent_managed_by_company", e.target.checked)}
        />
        <span>השכירות מנוהלת על ידי חברת ניהול</span>
      </label>
      {form.rent_managed_by_company ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">חברת הניהול</span>
            <Input
              value={form.management_company_name}
              onChange={(e) => set("management_company_name", e.target.value)}
              placeholder="לדוגמה: Redleaf Management"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">קישור לפורטל</span>
            <Input
              dir="ltr"
              inputMode="url"
              value={form.management_portal_url}
              onChange={(e) => set("management_portal_url", e.target.value)}
              placeholder="https://"
            />
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">הערות</span>
            <Textarea rows={2} value={form.management_notes} onChange={(e) => set("management_notes", e.target.value)} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** The company that bought the property — a Canada building's Inc. (owner, 2026-10-23: "for the purchaser I want
 *  to save all the details we have for each apartment separately"). */
export function PropertyOwnerCompanyFields({ form, set }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block space-y-1 text-sm">
        <span className="font-medium">שם החברה</span>
        <Input value={form.owner_company_name} onChange={(e) => set("owner_company_name", e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">מספר חברה (NEQ / ח.פ.)</span>
        <Input dir="ltr" value={form.owner_company_number} onChange={(e) => set("owner_company_number", e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">סוג</span>
        <Input
          value={form.owner_company_type}
          onChange={(e) => set("owner_company_type", e.target.value)}
          placeholder="לדוגמה: Corporation"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">קישור לרשם החברות</span>
        <Input
          dir="ltr"
          inputMode="url"
          value={form.owner_company_url}
          onChange={(e) => set("owner_company_url", e.target.value)}
          placeholder="https://"
        />
      </label>
      <label className="block space-y-1 text-sm sm:col-span-2">
        <span className="font-medium">הערות</span>
        <Textarea
          rows={2}
          value={form.owner_company_notes}
          onChange={(e) => set("owner_company_notes", e.target.value)}
          placeholder="בעלי המניות, כתובת רשומה…"
        />
      </label>
    </div>
  );
}

/** The "הנכס מרוהט" toggle + click-off/custom furniture list — the "ריהוט" card's fields. */
export function PropertyFurnitureFields({ form, set }: FieldsProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={form.is_furnished} onChange={(e) => set("is_furnished", e.target.checked)} />
        <span>הנכס מרוהט</span>
      </label>
      {form.is_furnished ? (
        <div className="mt-2">
          <FurnitureChecklist
            items={form.furniture_items}
            onToggle={(item) =>
              set(
                "furniture_items",
                form.furniture_items.includes(item)
                  ? form.furniture_items.filter((i) => i !== item)
                  : [...form.furniture_items, item]
              )
            }
            onAddCustom={(item) => set("furniture_items", [...form.furniture_items, item])}
            onRemoveCustom={(item) => set("furniture_items", form.furniture_items.filter((i) => i !== item))}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The four utility accounts every apartment has, in one list so the form and
 *  the read view on the property page can never drift apart. `propertyKey` is
 *  the same field on a saved `Property`. */
export const UTILITY_ACCOUNT_FIELDS = [
  { key: "electricity_contract_number", propertyKey: "electricityContractNumber", label: "חשמל" },
  { key: "water_contract_number", propertyKey: "waterContractNumber", label: "מים" },
  { key: "gas_contract_number", propertyKey: "gasContractNumber", label: "גז" },
  { key: "arnona_contract_number", propertyKey: "arnonaContractNumber", label: "ארנונה" },
] as const satisfies readonly {
  key: keyof PropertyInput;
  propertyKey: keyof Property;
  label: string;
}[];

/** Utility contract numbers — the "מספרי חוזה" card's fields.
 *
 *  Free text, not a numeric input: a contract number can carry leading zeros or
 *  a dash, and `inputMode="numeric"` would still pop the digit keypad while
 *  quietly dropping neither. */
export function PropertyUtilityFields({ form, set }: FieldsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {UTILITY_ACCOUNT_FIELDS.map((field) => (
        <label key={field.key} className="block space-y-1 text-sm">
          <span className="font-medium">{`מס׳ חוזה ${field.label}`}</span>
          <Input
            inputMode="numeric"
            value={form[field.key]}
            onChange={(e) => set(field.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

/** Seller/date/price/tax/land-registry — the "רכישת הנכס" card's fields. */
export function PropertyPurchaseFields({ form, set }: FieldsProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">נרכש מ-</span>
          <Input value={form.purchased_from} onChange={(e) => set("purchased_from", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">תאריך רכישה</span>
          <DateInput value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">מחיר רכישה</span>
          <CurrencyInput value={form.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">מס רכישה</span>
          <CurrencyInput value={form.purchase_tax} onChange={(e) => set("purchase_tax", e.target.value)} />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">גוש</span>
          <Input inputMode="numeric" value={form.land_block} onChange={(e) => set("land_block", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">חלקה</span>
          <Input inputMode="numeric" value={form.land_parcel} onChange={(e) => set("land_parcel", e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">תת חלקה</span>
          <Input inputMode="numeric" value={form.land_sub_parcel} onChange={(e) => set("land_sub_parcel", e.target.value)} />
        </label>
      </div>
    </div>
  );
}

/** Full create/edit form — used by the /properties list page's single dialog. */
export function PropertyFormFields({ form, set }: FieldsProps) {
  return (
    <div className="space-y-3">
      <PropertyBasicFields form={form} set={set} />
      <div className="border-t pt-3">
        <PropertyFurnitureFields form={form} set={set} />
      </div>
      <div className="border-t pt-3">
        <div className="mb-2 text-sm font-semibold">מספרי חוזה מול הספקים</div>
        <PropertyUtilityFields form={form} set={set} />
      </div>
      <div className="border-t pt-3">
        <div className="mb-2 text-sm font-semibold">פרטי רכישה וזיהוי בטאבו</div>
        <PropertyPurchaseFields form={form} set={set} />
      </div>
      <div className="border-t pt-3">
        <div className="mb-2 text-sm font-semibold">חברה בעלת הנכס</div>
        <PropertyOwnerCompanyFields form={form} set={set} />
      </div>
    </div>
  );
}
