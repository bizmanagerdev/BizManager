// What a customer's saved address needs when they're picked for an order or a
// project (owner, 2026-10-18: "If his address is good, it doesn't say
// anything. If his address is not one of the ones Google found already … only
// a city, not found at all, one of the mistake ones … it should tell me").

import type { DeliveryPin } from "@/lib/delivery-location";
import { addressQuality, plainAddress } from "@/lib/ui/cities";

export type AddressHelp = "not_found" | "partial" | "none" | null;

export type CustomerAddressStatus = {
  address?: string | null;
  city?: string | null;
  /** The saved drop-off point: the driver can get there, so nothing is asked. */
  pin?: DeliveryPin | null;
  /** Marked not found on Google Maps (lib/address/columns.ts ADDRESS_NOT_FOUND). */
  addressNotFound?: boolean;
  /** A full address Google found (lib/address/columns.ts addressVerified);
   *  undefined when the list it came from didn't carry Google's fields. */
  addressVerified?: boolean;
};

/**
 * Good: a full address Google found, or a saved drop-off point. A list that
 * didn't carry Google's fields is judged by the saved line.
 */
export function customerAddressHelp(customer: CustomerAddressStatus | null | undefined): AddressHelp {
  if (!customer || customer.pin) return null;
  if (customer.addressNotFound) return "not_found";
  if (customer.addressVerified === true) return null;
  if (customer.addressVerified === undefined && addressQuality({ address: customer.address, city: customer.city }) === "clear") return null;
  return plainAddress({ address: customer.address, city: customer.city }) ? "partial" : "none";
}

/** The pop-up's words for it, the same in the order and the project wizard. */
export function addressHelpPrompt(
  customer: CustomerAddressStatus | null | undefined,
  what: "order" | "project"
): { title: string; description: string } {
  const help = customerAddressHelp(customer);
  const saved = plainAddress({ address: customer?.address, city: customer?.city });
  const ask = what === "order" ? "אם ההזמנה למשלוח, בקשו מהלקוח כתובת מלאה ושמרו אותה." : "בקשו מהלקוח כתובת מלאה ושמרו אותה.";
  if (help === "not_found") {
    return {
      title: "הכתובת של הלקוח לא נמצאה במפות",
      description: `הכתובת השמורה${saved ? `: ${saved}` : ""} לא נמצאה ב-Google Maps, אז היא כנראה שגויה. צריך להזין כתובת חדשה.`,
    };
  }
  if (help === "partial") {
    return {
      title: "צריך לעדכן כתובת ללקוח",
      description: `הכתובת השמורה: ${saved}. אין בה רחוב ומספר בית שנמצאו ב-Google Maps, אז Waze לא יוכל לנווט. ${ask}`,
    };
  }
  return { title: "צריך לעדכן כתובת ללקוח", description: `לא שמורה כתובת ללקוח הזה. ${ask}` };
}
