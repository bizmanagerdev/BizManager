// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

// The properties list (owner's card, 2026-10-20): each card says who rents it
// and whether this month's rent is in, and money is added straight from it.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/app/(app)/properties/actions", () => ({
  createProperty: vi.fn(),
  updateProperty: vi.fn(),
  deleteProperty: vi.fn(),
  setPropertyOrder: vi.fn(),
}));
vi.mock("@/components/layout/QuickCreateMenu", () => ({ invalidateQuickCreateCache: vi.fn() }));
// The drop itself (the list's onDragEnd), without a pointer to drag with.
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: unknown) => void) }));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: (event: unknown) => void }) => {
      dnd.onDragEnd = onDragEnd;
      return children;
    },
  };
});
vi.mock("@/components/reminders/AddReminderButton", () => ({ default: () => null }));
vi.mock("@/components/expenses/ExpenseDialog", () => ({
  ExpenseDialog: ({ lockedPropertyId }: { lockedPropertyId: string }) => <p>טופס הוצאה לנכס {lockedPropertyId}</p>,
}));
vi.mock("@/components/financial/IncomeDialog", () => ({
  IncomeDialog: ({ lockedPropertyId }: { lockedPropertyId: string }) => <p>טופס הכנסה לנכס {lockedPropertyId}</p>,
}));

import PropertiesClient from "@/app/(app)/properties/PropertiesClient";
import { setPropertyOrder } from "@/app/(app)/properties/actions";
import { toast } from "sonner";
import type { PropertyWithLease } from "@/lib/properties";

function property(fields: Partial<PropertyWithLease>): PropertyWithLease {
  return {
    id: "p1",
    name: "יהודה הנשיא 15",
    address: "שדרות רבי יהודה הנשיא 15, בית שמש",
    addr: null,
    assetDescription: null,
    isActive: true,
    propertyType: "apartment",
    apartmentsCount: null,
    rooms: 4,
    squareMeters: 90,
    floor: 2,
    bathrooms: 2,
    mezuzahCount: 8,
    lightBulbCount: null,
    keyCount: null,
    hasPrivateEntrance: false,
    hasStorageRoom: true,
    hasParking: true,
    hasElevator: false,
    purchasedFrom: null,
    purchaseDate: null,
    purchasePrice: null,
    purchaseTax: null,
    landBlock: null,
    landParcel: null,
    landSubParcel: null,
    electricityContractNumber: null,
    waterContractNumber: null,
    gasContractNumber: null,
    arnonaContractNumber: null,
    isFurnished: false,
    furnitureItems: [],
    createdAt: null,
    updatedAt: null,
    sortOrder: null,
    currentLease: {
      id: "l1",
      propertyId: "p1",
      customerId: "c1",
      customerName: "וואגשל",
      customerPhone: null,
      startDate: "2026-06-01",
      endDate: "2026-12-31",
      monthlyRentAmount: 8500,
      documentId: null,
      documentFileName: null,
      documentUrl: null,
      status: "active",
      notes: null,
      depositType: null,
      depositAmount: null,
      depositReference: null,
      keysHandedOver: null,
      rentDayOfMonth: 1,
      rentCalendar: "gregorian",
      rentHebrewDay: null,
      periodMonths: 1,
      areaSqm: null,
      unitLabel: null,
      createdAt: null,
    },
    rollup: { totalExpenseAmount: 1000, paidExpenseAmount: 1000, expectedExpenseAmount: 0, totalIncomeAmount: 17000 },
    rentThisMonth: { state: "late", collected: 0, pending: 0, rent: 8500, periodStart: "2026-10-01", periodLabel: "אוקטובר" },
    renters: null,
    ...fields,
  };
}

const card = (name: string) => screen.getByText(name).closest("[class*='rounded']") as HTMLElement;

describe("the properties list", () => {
  it("a rented property: the tenant with the rent, and this month's rent as a chip", () => {
    render(<PropertiesClient properties={[property({})]} />);
    const c = within(card("יהודה הנשיא 15"));
    expect(c.getByText("וואגשל")).toBeInTheDocument();
    expect(c.getByText("שכירות אוקטובר: לא שולם")).toBeInTheDocument();
    // The rooms and the amenities live on the property's own page now.
    expect(c.queryByText(/4 חדרים/)).not.toBeInTheDocument();
    expect(c.queryByText("חניה")).not.toBeInTheDocument();
  });

  it("an empty one just says פנוי", () => {
    render(<PropertiesClient properties={[property({ currentLease: null, rentThisMonth: { state: "none", collected: 0, pending: 0, rent: 0, periodStart: null, periodLabel: null } })]} />);
    const c = within(card("יהודה הנשיא 15"));
    expect(c.getByText("פנוי")).toBeInTheDocument();
    expect(c.queryByText(/שכירות .+:/)).not.toBeInTheDocument();
  });

  it("a storage property with renters: how many, what they pay together, and how many have paid", () => {
    render(
      <PropertiesClient
        properties={[property({ name: "הר יונה שונות", propertyType: "storage", renters: { count: 3, paid: 2, monthly: 900, yearly: 2400 } })]}
      />
    );
    const c = within(card("הר יונה שונות"));
    expect(c.getByText(/3 שוכרים/)).toHaveTextContent("3 שוכרים · ₪900/חודש · ₪2,400/שנה");
    expect(c.getByText("שכירות: 2 מתוך 3 שילמו")).toBeInTheDocument();
  });

  it("+ הכנסה and + הוצאה open the forms already set to that property", async () => {
    render(<PropertiesClient properties={[property({})]} />);
    const c = within(card("יהודה הנשיא 15"));
    await act(async () => {
      fireEvent.click(c.getByRole("button", { name: "הכנסה" }));
    });
    expect(await screen.findByText("טופס הכנסה לנכס p1")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(c.getByRole("button", { name: "הוצאה" }));
    });
    expect(await screen.findByText("טופס הוצאה לנכס p1")).toBeInTheDocument();
  });

  it("dragged into the owner's order: shown at once and saved; a failed save puts it back", async () => {
    const two = [property({}), property({ id: "p2", name: "ריבל 29" })];
    const names = () => [...document.querySelectorAll(".text-lg")].map((e) => e.textContent);
    vi.mocked(setPropertyOrder).mockResolvedValueOnce({ ok: true });
    render(<PropertiesClient properties={two} />);
    expect(names()).toEqual(["יהודה הנשיא 15", "ריבל 29"]);
    await act(async () => dnd.onDragEnd?.({ active: { id: "p2" }, over: { id: "p1" } }));
    expect(names()).toEqual(["ריבל 29", "יהודה הנשיא 15"]);
    expect(setPropertyOrder).toHaveBeenLastCalledWith(["p2", "p1"]);

    vi.mocked(setPropertyOrder).mockResolvedValueOnce({ ok: false, error: "שמירת הסדר נכשלה." });
    await act(async () => dnd.onDragEnd?.({ active: { id: "p1" }, over: { id: "p2" } }));
    expect(toast.error).toHaveBeenCalledWith("שמירת הסדר נכשלה.");
    expect(names()).toEqual(["יהודה הנשיא 15", "ריבל 29"]);

    vi.mocked(setPropertyOrder).mockRejectedValueOnce(new Error("Failed to fetch"));
    await act(async () => dnd.onDragEnd?.({ active: { id: "p2" }, over: { id: "p1" } }));
    expect(toast.error).toHaveBeenLastCalledWith("שמירת הסדר נכשלה — בדקו את החיבור.");
    expect(names()).toEqual(["יהודה הנשיא 15", "ריבל 29"]);
  });

  it("the search still finds a property by its rooms or amenities", () => {
    render(<PropertiesClient properties={[property({}), property({ id: "p2", name: "ריבל 29", hasParking: false, rooms: 3 })]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש נכס" }), { target: { value: "חניה" } });
    expect(screen.getByText("יהודה הנשיא 15")).toBeInTheDocument();
    expect(screen.queryByText("ריבל 29")).not.toBeInTheDocument();
  });
});
