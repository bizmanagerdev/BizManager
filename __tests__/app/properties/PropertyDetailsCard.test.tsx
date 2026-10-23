// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

// A property's first card: its details in a ruled grid, two to a row — with a
// Canada building's ייעוד, מחוז and tax account beside its apartments (owner,
// 2026-10-23: "put these … as details here, add the columns").

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/undo-engine", () => ({ scheduleDeferredAction: vi.fn() }));
vi.mock("@/app/(app)/properties/actions", () => ({ updateProperty: vi.fn() }));
vi.mock("@/components/layout/QuickCreateMenu", () => ({
  invalidateQuickCreateCache: vi.fn(),
}));
vi.mock("@/app/(app)/properties/PropertyPhotoTile", () => ({
  PropertyPhotoBanner: () => null,
}));

import PropertyDetailsCard from "@/app/(app)/properties/[id]/PropertyDetailsCard";
import type { Property } from "@/lib/properties";

afterEach(cleanup);

const PLOURDE = {
  id: "plourde",
  name: "25 Plourde",
  address: "25 Plourde Street, Charlemagne, QC J5Z 3E1, Canada",
  addr: null,
  assetDescription: null,
  isActive: true,
  propertyType: "building",
  apartmentsCount: 39,
  rooms: null,
  squareMeters: null,
  floor: null,
  bathrooms: null,
  mezuzahCount: null,
  lightBulbCount: null,
  keyCount: null,
  hasPrivateEntrance: false,
  hasStorageRoom: false,
  hasParking: false,
  hasElevator: false,
  isFurnished: false,
  furnitureItems: [],
  rentManagedByCompany: true,
  zoning: "מגורים",
  region: "Quebec",
  taxAccountNumber: "020874-10",
} as unknown as Property;

function renderCard(property: Property) {
  render(
    <PropertyDetailsCard
      propertyId={property.id}
      property={property}
      photoUrl={null}
      photoReady
      onPhotoChanged={vi.fn()}
      editOpen={false}
      onEditOpenChange={vi.fn()}
    />,
  );
}

/** The grid's details in order, each "label value". */
function gridRows() {
  return screen.getAllByText(/^(דירות|ייעוד|מחוז|חשבון מס)$/).map((label) =>
    within(label.parentElement as HTMLElement)
      .getAllByText(/.+/)
      .map((el) => el.textContent)
      .join(" "),
  );
}

describe("a property's first card", () => {
  it("a Canada building: דירות, ייעוד, מחוז and חשבון מס, two to a row", () => {
    renderCard(PLOURDE);
    expect(gridRows()).toEqual([
      "דירות 39",
      "ייעוד מגורים",
      "מחוז Quebec",
      "חשבון מס 020874-10",
    ]);
  });

  it("its tax account online: the number opens it, in a new tab", () => {
    renderCard({
      ...PLOURDE,
      taxAccountUrl: "https://montreal.ca/en/tax-account/address/list/result",
    });
    const link = screen.getByRole("link", { name: /020874-10/ });
    expect(link).toHaveAttribute(
      "href",
      "https://montreal.ca/en/tax-account/address/list/result",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("none of them set: not shown", () => {
    renderCard({
      ...PLOURDE,
      zoning: null,
      region: null,
      taxAccountNumber: null,
    });
    expect(screen.queryByText("ייעוד")).toBeNull();
    expect(screen.queryByText("מחוז")).toBeNull();
    expect(screen.queryByText("חשבון מס")).toBeNull();
  });
});
