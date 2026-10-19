// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// The driver's slip asks first when the stop has no full address and no saved
// point (owner, 2026-10-16: "this doesn't have a full address … do you want to
// share the slip anyways or not … if not, go and edit the address first").

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
// The capture itself isn't under test: a slip being made shows as the spinner.
vi.mock("html-to-image", () => ({ toBlob: () => new Promise(() => {}) }));

import { push } from "@/__tests__/mocks/next-navigation";
import DeliveryShareActions from "@/app/(app)/sales/DeliveryShareActions";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

function delivery(extra: Partial<DeliveryItem> = {}): DeliveryItem {
  return {
    id: "o1",
    customerId: "c1",
    branchId: null,
    orderDate: "2026-10-16",
    status: "draft",
    totalAmount: 100,
    totalPaid: 0,
    paymentStatus: "unpaid",
    collectOnDelivery: false,
    requestedDeliveryDate: null,
    notes: null,
    customerName: "משכן משה",
    customerBranchName: null,
    customerPhone: null,
    city: "בית שמש",
    address: "בית שמש | יחזקאל הנביא 27",
    items: [],
    outOfStock: false,
    requiresPrepayment: false,
    deliveryInstructions: null,
    deliveryLat: null,
    deliveryLng: null,
    ...extra,
  } as DeliveryItem;
}

const tapShare = () => fireEvent.click(screen.getByRole("button", { name: "שליחה לנהג" }));
const asked = () => screen.queryByRole("heading", { name: "אין כתובת מלאה למשלוח" });

describe("the driver's slip", () => {
  beforeEach(() => push.mockClear());

  it("is made at once for a full address", () => {
    render(<DeliveryShareActions delivery={delivery()} label="שליחה לנהג" />);
    tapShare();
    expect(asked()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחה לנהג" })).toBeDisabled();
  });

  // Owner, 2026-10-19: the driver sees the apartment / entrance too.
  it("shows the apartment / entrance with the address", () => {
    render(<DeliveryShareActions delivery={delivery({ addressUnit: "קומה 2" })} label="שליחה לנהג" />);
    tapShare();
    expect(screen.getByText("רחוב יחזקאל הנביא 27, בית שמש · קומה 2")).toBeInTheDocument();
  });

  it("is made at once when a point is saved, whatever the address", () => {
    render(
      <DeliveryShareActions
        delivery={delivery({ address: "בית שמש", deliveryLat: 31.75, deliveryLng: 34.99 })}
        label="שליחה לנהג"
      />
    );
    tapShare();
    expect(asked()).not.toBeInTheDocument();
  });

  it("asks first for a partial address, showing what's saved", () => {
    render(<DeliveryShareActions delivery={delivery({ address: "בית שמש | יחזקאל הנביא 27 בחניה" })} label="שליחה לנהג" />);
    tapShare();
    expect(asked()).toBeInTheDocument();
    expect(screen.getByText(/הכתובת השמורה: יחזקאל הנביא 27 בחניה, בית שמש/)).toBeInTheDocument();
    // Nothing is made until they choose (the button sits behind the pop-up).
    expect(screen.getByRole("button", { name: "שליחה לנהג", hidden: true })).toBeEnabled();
  });

  it("'שליחה בכל זאת' makes the slip", () => {
    render(<DeliveryShareActions delivery={delivery({ address: "-", city: "ללא עיר" })} label="שליחה לנהג" />);
    tapShare();
    expect(screen.getByText(/לא שמורה כתובת למשלוח הזה/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שליחה בכל זאת" }));
    expect(asked()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחה לנהג" })).toBeDisabled();
  });

  it("'עריכת הכתובת' opens the customer's edit form instead", () => {
    render(<DeliveryShareActions delivery={delivery({ address: "בית שמש" })} label="שליחה לנהג" />);
    tapShare();
    fireEvent.click(screen.getByRole("button", { name: "עריכת הכתובת" }));
    expect(push).toHaveBeenCalledWith("/customers/c1?edit=address");
    expect(screen.getByRole("button", { name: "שליחה לנהג" })).toBeEnabled();
  });

  it("a worker can't edit the customer: asks the office instead", () => {
    render(<DeliveryShareActions delivery={delivery({ address: "בית שמש" })} label="שליחה לנהג" canEditAddress={false} />);
    tapShare();
    expect(screen.queryByRole("button", { name: "עריכת הכתובת" })).not.toBeInTheDocument();
    expect(screen.getByText("כדאי לבקש מהמשרד לעדכן את הכתובת.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(asked()).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalledWith("/customers/c1?edit=address");
  });

  // Owner, 2026-10-18: an address not found on Google Maps is wrong — no slip
  // goes out with it, not even "anyway".
  describe("an address not found on Google Maps", () => {
    const wrong = () => screen.queryByRole("heading", { name: "אי אפשר לשלוח לנהג" });

    it("makes no slip, and offers to edit the address", () => {
      render(<DeliveryShareActions delivery={delivery({ addressNotFound: true })} label="שליחה לנהג" />);
      tapShare();
      expect(wrong()).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "שליחה בכל זאת" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "עריכת הכתובת" }));
      expect(push).toHaveBeenCalledWith("/customers/c1?edit=address");
      expect(screen.getByRole("button", { name: "שליחה לנהג" })).toBeEnabled();
    });

    it("a worker is told to ask the office", () => {
      render(<DeliveryShareActions delivery={delivery({ addressNotFound: true })} label="שליחה לנהג" canEditAddress={false} />);
      tapShare();
      expect(wrong()).toBeInTheDocument();
      expect(screen.getByText(/צריך לבקש מהמשרד כתובת חדשה/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "עריכת הכתובת" })).not.toBeInTheDocument();
    });

    it("a saved point still makes the slip", () => {
      render(
        <DeliveryShareActions
          delivery={delivery({ addressNotFound: true, deliveryLat: 31.75, deliveryLng: 34.99 })}
          label="שליחה לנהג"
        />
      );
      tapShare();
      expect(wrong()).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "שליחה לנהג" })).toBeDisabled();
    });
  });
});
