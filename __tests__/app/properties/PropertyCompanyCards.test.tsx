// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";

// A property whose rent a management company collects (owner, 2026-10-23, the
// Canada buildings: "a checkbox … we don't deal with the rent"): in its head
// row, who manages it — "the link to the portal and the name of the company" —
// and the company that bought it, each saved on the property and edited on
// its own.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
// The save commits at once here (the real one waits out its undo).
vi.mock("@/lib/undo-engine", () => ({
  scheduleDeferredAction: async ({
    onApplyOptimistic,
    onCommit,
  }: {
    onApplyOptimistic: () => void;
    onCommit: () => Promise<unknown>;
  }) => {
    onApplyOptimistic();
    await onCommit();
  },
}));
const { updateProperty } = vi.hoisted(() => ({
  updateProperty: vi.fn(async (_id: string, _input: unknown) => ({ ok: true })),
}));
vi.mock("@/app/(app)/properties/actions", () => ({ updateProperty }));

import {
  PropertyManagementCard,
  PropertyOwnerCompanyCard,
} from "@/app/(app)/properties/[id]/PropertyCompanyCards";
import {
  EMPTY_PROPERTY_FORM,
  PropertyManagementFields,
  type PropertyInput,
} from "@/app/(app)/properties/PropertyFormFields";
import type { Property } from "@/lib/properties";

afterEach(() => {
  cleanup();
  updateProperty.mockClear();
});

const PLOURDE: Property = {
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
  purchasedFrom: "Maria IACONO et Anggelo DI PIETRO",
  purchaseDate: null,
  purchasePrice: null,
  purchaseTax: null,
  landBlock: null,
  landParcel: "1 949 340",
  landSubParcel: null,
  electricityContractNumber: null,
  waterContractNumber: null,
  gasContractNumber: null,
  arnonaContractNumber: null,
  isFurnished: false,
  furnitureItems: [],
  rentManagedByCompany: true,
  managementCompanyName: "Redleaf Management",
  managementPortalUrl:
    "https://redleafmanagement.managebuilding.com/manager/app/accounting/rental-owner-financials",
  managementNotes: null,
  ownerCompanyName: "25 PLOURDE INC.",
  ownerCompanyNumber: "1180846645",
  ownerCompanyType: "Corporation",
  ownerCompanyUrl: null,
  ownerCompanyNotes: null,
  createdAt: null,
  updatedAt: null,
  sortOrder: 11,
};

describe("the management company's card", () => {
  it("its name, and its portal a tap away — in a new tab, by the site's name", () => {
    render(<PropertyManagementCard propertyId="plourde" property={PLOURDE} />);
    expect(screen.getByText("Redleaf Management")).toBeInTheDocument();
    const portal = screen.getByRole("link", { name: /לפורטל/ });
    expect(portal).toHaveAttribute("href", PLOURDE.managementPortalUrl);
    expect(portal).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("link", {
        name: /redleafmanagement\.managebuilding\.com/,
      }),
    ).toBeInTheDocument();
  });

  it("edited on its own: its fields saved onto the property as it is, shown at once", async () => {
    render(<PropertyManagementCard propertyId="plourde" property={PLOURDE} />);
    fireEvent.click(screen.getByRole("button", { name: "עריכת חברת הניהול" }));
    fireEvent.change(screen.getByLabelText("הערות"), {
      target: { value: "מנהל: Daniel" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    });
    expect(updateProperty).toHaveBeenCalledTimes(1);
    const [id, input] = updateProperty.mock.calls[0] as [string, PropertyInput];
    expect(id).toBe("plourde");
    expect(input).toMatchObject({
      rent_managed_by_company: true,
      management_company_name: "Redleaf Management",
      management_notes: "מנהל: Daniel",
      // The other cards' fields as saved — not wiped.
      owner_company_name: "25 PLOURDE INC.",
      land_parcel: "1 949 340",
      apartments_count: "39",
    });
    expect(screen.getByText("מנהל: Daniel")).toBeInTheDocument();
  });

  it("no portal yet: one button to add its details", () => {
    render(
      <PropertyManagementCard
        propertyId="plourde"
        property={{ ...PLOURDE, managementPortalUrl: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: /לפורטל/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "הוספת פרטי החברה" }),
    ).toBeInTheDocument();
  });
});

describe("the owning company's card", () => {
  it("its name, type and number; its registry page when there is one", () => {
    render(
      <PropertyOwnerCompanyCard
        propertyId="plourde"
        property={{
          ...PLOURDE,
          ownerCompanyUrl: "www.registreentreprises.gouv.qc.ca/reqna",
        }}
      />,
    );
    expect(screen.getByText("25 PLOURDE INC.")).toBeInTheDocument();
    expect(screen.getByText("Corporation")).toBeInTheDocument();
    expect(screen.getByText("1180846645")).toBeInTheDocument();
    // Typed without https://: still a link.
    expect(
      screen.getByRole("link", { name: /registreentreprises\.gouv\.qc\.ca/ }),
    ).toHaveAttribute(
      "href",
      "https://www.registreentreprises.gouv.qc.ca/reqna",
    );
  });

  it("nothing entered yet: says so, and offers to add it", () => {
    render(
      <PropertyOwnerCompanyCard
        propertyId="plourde"
        property={{
          ...PLOURDE,
          ownerCompanyName: null,
          ownerCompanyNumber: null,
          ownerCompanyType: null,
        }}
      />,
    );
    expect(screen.getByText("לא הוזנה")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "הוספת פרטי החברה" }),
    ).toBeInTheDocument();
  });
});

function ManagementForm() {
  const [form, setForm] = useState<PropertyInput>(EMPTY_PROPERTY_FORM);
  return (
    <PropertyManagementFields
      form={form}
      set={(key, value) => setForm((prev) => ({ ...prev, [key]: value }))}
    />
  );
}

describe("the add and edit forms' checkbox", () => {
  it("ticked, it asks for the company's name, portal and notes", () => {
    render(<ManagementForm />);
    expect(screen.queryByLabelText("קישור לפורטל")).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "השכירות מנוהלת על ידי חברת ניהול",
      }),
    );
    expect(screen.getByLabelText("חברת הניהול")).toBeInTheDocument();
    expect(screen.getByLabelText("קישור לפורטל")).toBeInTheDocument();
    expect(screen.getByLabelText("הערות")).toBeInTheDocument();
  });
});
