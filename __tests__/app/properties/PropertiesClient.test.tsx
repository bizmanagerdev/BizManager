// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

// The properties list (owner, 2026-10-21 — "like the cars cards"): each card
// its photo, name and address, a row for who rents it and one for this
// period's rent — each opening that part of the property's page — and its
// tasks, documents and money; the whole card opens the property.

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
// The cards' photos (/api/properties/photos).
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response(JSON.stringify({ photos: { p1: "https://x/p1.jpg" } }), { status: 200 }))
);

import PropertiesClient from "@/app/(app)/properties/PropertiesClient";
import { setPropertyOrder } from "@/app/(app)/properties/actions";
import { toast } from "sonner";
import { push } from "@/__tests__/mocks/next-navigation";
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
    counts: { tasks: 3, openTasks: 1, documents: 5 },
    ...fields,
  };
}

const card = (name: string) => screen.getByText(name).closest("[class*='rounded']") as HTMLElement;

describe("the properties list", () => {
  it("a rented property: the renter with the rent, and this period's rent — each opening that part of its page", async () => {
    render(<PropertiesClient properties={[property({})]} />);
    const c = within(card("יהודה הנשיא 15"));
    const renter = c.getByRole("link", { name: /שוכר.*וואגשל/ });
    expect(renter).toHaveAttribute("href", "/properties/p1#tenant");
    expect(renter).toHaveTextContent("₪8,500/חודש");
    const rent = c.getByRole("link", { name: /שכירות אוקטובר.*לא שולם/ });
    expect(rent).toHaveAttribute("href", "/properties/p1#rent");
    // Its tasks, documents and money, like a car's; no income/expense figures or buttons.
    expect(c.getByText("1/3 משימות")).toBeInTheDocument();
    expect(c.getByText("5 מסמכים")).toBeInTheDocument();
    expect(c.getByText(/נטו/)).toHaveTextContent("₪16,000");
    expect(c.queryByRole("button", { name: "הכנסה" })).not.toBeInTheDocument();
    // The rooms and the amenities live on the property's own page.
    expect(c.queryByText(/4 חדרים/)).not.toBeInTheDocument();
    // Its photo, once asked for.
    expect(await c.findByRole("img", { name: "יהודה הנשיא 15" })).toHaveAttribute("src", "https://x/p1.jpg");
  });

  it("the whole card opens the property", () => {
    render(<PropertiesClient properties={[property({})]} />);
    fireEvent.click(screen.getByText("שדרות רבי יהודה הנשיא 15, בית שמש"));
    expect(push).toHaveBeenCalledWith("/properties/p1");
  });

  it("an empty one says פנוי, and there's no rent", () => {
    render(<PropertiesClient properties={[property({ currentLease: null, rentThisMonth: { state: "none", collected: 0, pending: 0, rent: 0, periodStart: null, periodLabel: null } })]} />);
    const c = within(card("יהודה הנשיא 15"));
    expect(c.getByRole("link", { name: /שוכר.*פנוי/ })).toHaveAttribute("href", "/properties/p1#tenant");
    expect(c.getByText("אין שוכר")).toBeInTheDocument();
  });

  it("a storage property with renters: how many, what they pay together, and how many have paid", () => {
    render(
      <PropertiesClient
        properties={[property({ name: "הר יונה שונות", propertyType: "storage", renters: { count: 3, paid: 2, monthly: 900, yearly: 2400 } })]}
      />
    );
    const c = within(card("הר יונה שונות"));
    expect(c.getByRole("link", { name: /שוכרים.*3 שוכרים/ })).toHaveAttribute("href", "/properties/p1#renters");
    expect(c.getByText("2 מתוך 3 שילמו")).toBeInTheDocument();
  });

  it("the + menu's נכס opens the new-property form (the page has no add button of its own)", async () => {
    render(<PropertiesClient properties={[property({})]} />);
    expect(screen.queryByRole("button", { name: /הוספת נכס/ })).not.toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("bizh:property-quick-create"));
    });
    expect(await screen.findByText("הוספת נכס")).toBeInTheDocument();
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
