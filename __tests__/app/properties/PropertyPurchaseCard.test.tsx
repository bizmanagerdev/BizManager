// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// "רכישת הנכס": where the property is registered online, by its lot number
// (owner, 2026-10-23: "these also need fields" — the Registre foncier and JLR
// under 6366 Rue Pierre, until then lines of its description).

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/lib/undo-engine", () => ({ scheduleDeferredAction: vi.fn() }));
vi.mock("@/app/(app)/properties/actions", () => ({ updateProperty: vi.fn() }));

import PropertyPurchaseCard from "@/app/(app)/properties/[id]/PropertyPurchaseCard";
import type { Property } from "@/lib/properties";

afterEach(cleanup);

const PIERRE = {
  id: "pierre",
  name: "6366 Rue Pierre",
  address: "6366 Rue Pierre, Montréal-Nord, QC H1G 1P2, Canada",
  purchasedFrom: null,
  purchaseDate: null,
  purchasePrice: null,
  purchaseTax: null,
  landBlock: null,
  landParcel: null,
  landSubParcel: null,
  landRegistryUrl: "https://www.registrefoncier.gouv.qc.ca/Sirf/",
  landTitleUrl: "https://www.jlr.ca/Membre/TableauBord.aspx",
} as unknown as Property;

function renderCard(property: Property) {
  render(
    <PropertyPurchaseCard
      propertyId={property.id}
      property={property}
      documents={[]}
      onAddDocument={vi.fn()}
      onDeleteDocument={vi.fn()}
    />,
  );
}

describe("a property's purchase block", () => {
  it("its land-registry links, each by its site's name, in a new tab", () => {
    renderCard(PIERRE);
    expect(screen.getByText(/רישום המקרקעין/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /registrefoncier\.gouv\.qc\.ca/ }),
    ).toHaveAttribute("href", "https://www.registrefoncier.gouv.qc.ca/Sirf/");
    expect(screen.getByRole("link", { name: /jlr\.ca/ })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.queryByText("לא הוזנו פרטי רכישה.")).toBeNull();
  });

  it("nothing at all: says so", () => {
    renderCard({ ...PIERRE, landRegistryUrl: null, landTitleUrl: null });
    expect(screen.getByText("לא הוזנו פרטי רכישה.")).toBeInTheDocument();
  });
});
