// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The customer forms take the address from the picker (owner, 2026-10-16:
// one address type everywhere). A save that doesn't touch the address leaves
// it exactly as saved — today every customer's address is still the old line;
// a picked one is sent whole; the old line is shown with a way to look it up;
// and the edit dialog's undo puts the old address back.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

const PICKED = {
  city: "בית שמש",
  street: "יחזקאל הנביא",
  houseNumber: "27",
  unit: "",
  lat: 31.7037704,
  lng: 34.9863334,
  placeId: "ChIJ-yechezkel-27",
  formatted: "יחזקאל הנביא 27, בית שמש",
};

// The picker itself has its own tests; here a stand-in picks PICKED or clears.
vi.mock("@/components/ui/address-picker", () => ({
  AddressPicker: ({
    value,
    onChange,
    legacyText,
    ariaLabel = "כתובת",
  }: {
    value: unknown;
    onChange: (next: unknown) => void;
    legacyText?: string | null;
    ariaLabel?: string;
  }) => (
    <div>
      <span>{`${ariaLabel}: ${value ? "נבחרה" : "אין"}`}</span>
      {legacyText ? <span>{`שמורה עד היום: ${legacyText}`}</span> : null}
      <button type="button" onClick={() => onChange(PICKED)}>{`בחירה ${ariaLabel}`}</button>
      <button type="button" onClick={() => onChange(null)}>{`ניקוי ${ariaLabel}`}</button>
    </div>
  ),
}));

const BRANCHES = [{ id: "b1", customer_id: "c1", name: "מרכז", address: "שמואל הנביא 52", phone: null, active: true }];
const CORE = {
  id: "c1",
  name: "לקוח",
  address: "בית שמש | יחזקאל הנביא 27 בחניה",
  city: "בית שמש",
  active: true,
  requires_prepayment: false,
  linked_user_id: null,
};

const { updateCustomerBranchDirect, registerReversibleAction } = vi.hoisted(() => ({
  updateCustomerBranchDirect: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  registerReversibleAction: vi.fn(),
}));
vi.mock("@/lib/customers/branchesContacts", () => ({
  fetchCustomerContactsDirect: vi.fn(async () => []),
  fetchCustomerBranchesDirect: vi.fn(async () => BRANCHES),
  updateCustomerBranchDirect,
}));
vi.mock("@/lib/customers/fetchCustomerCore", () => ({ fetchCustomerCore: vi.fn(async () => CORE) }));
vi.mock("@/components/tags/TagPicker", () => ({ TagPicker: () => null, fetchExistingTagIds: vi.fn(async () => []) }));
vi.mock("@/components/customers/WorkerLinkField", () => ({ WorkerLinkField: () => null }));
vi.mock("@/lib/undo-engine", () => ({ registerReversibleAction }));
vi.mock("@/lib/customers/device-customer-saves", () => ({ deviceCustomerSaves: () => null }));

import { EditCustomerDialog } from "@/components/customers/EditCustomerDialog";
import { CustomerForm } from "@/components/customers/CustomerForm";

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url === "/api/customers/update" || url === "/api/customers/create") {
    return new Response(JSON.stringify({ customer: { id: "c1", name: body.name ?? "לקוח", address: null, active: true } }));
  }
  if (url === "/api/customer-branches/create") return new Response(JSON.stringify({ branch: { id: "b2" } }));
  if (url === "/api/customers/search") return new Response(JSON.stringify({ customers: [] }));
  return new Response("{}");
});

beforeEach(() => {
  fetchMock.mockClear();
  updateCustomerBranchDirect.mockClear();
  registerReversibleAction.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

const sent = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).map(([, init]) => JSON.parse(String(init?.body)));

describe("EditCustomerDialog, the address", () => {
  async function open() {
    const onSaved = vi.fn();
    render(
      <EditCustomerDialog
        open
        onOpenChange={() => {}}
        customer={{ ...CORE, name_for_invoice: null, registration_number: null, phone: null, whatsapp: null, email: null, notes: null, contacts: [] }}
        onSaved={onSaved}
      />
    );
    await waitFor(() => expect(screen.getAllByDisplayValue("מרכז").length).toBeGreaterThan(0));
    return onSaved;
  }

  it("shows the old address, and a save that didn't touch it sends no address at all", async () => {
    const onSaved = await open();
    expect(screen.getByText("שמורה עד היום: בית שמש | יחזקאל הנביא 27 בחניה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const body = sent("/api/customers/update")[0];
    for (const key of ["structured_address", "address", "city"]) expect(body).not.toHaveProperty(key);
    expect(updateCustomerBranchDirect).not.toHaveBeenCalled();
  });

  it("a picked address is sent whole; the undo puts the old line and city back", async () => {
    const onSaved = await open();
    fireEvent.click(screen.getByRole("button", { name: "בחירה כתובת" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent("/api/customers/update")[0]).toMatchObject({ structured_address: PICKED });

    const { onUndo } = registerReversibleAction.mock.calls[0][0] as { onUndo: () => Promise<{ ok: boolean }> };
    await onUndo();
    expect(sent("/api/customers/update")[1]).toMatchObject({
      structured_address: null,
      address: "בית שמש | יחזקאל הנביא 27 בחניה",
      city: "בית שמש",
    });
  });

  it("a branch's picked address is written with its fields; its undo writes the old line back", async () => {
    const onSaved = await open();
    fireEvent.click(screen.getByRole("button", { name: "בחירה כתובת סניף 1" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateCustomerBranchDirect).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ address: "בית שמש | יחזקאל הנביא 27", addr_street: "יחזקאל הנביא", addr_house_number: "27" })
    );
    const { onUndo } = registerReversibleAction.mock.calls[0][0] as { onUndo: () => Promise<{ ok: boolean }> };
    await onUndo();
    expect(updateCustomerBranchDirect).toHaveBeenLastCalledWith(
      "b1",
      expect.objectContaining({ address: "שמואל הנביא 52", addr_street: null, addr_house_number: null })
    );
  });
});

describe("CustomerForm, the address", () => {
  it("edit: untouched sends no address; picked sends it whole", async () => {
    const onSaved = vi.fn();
    const { unmount } = render(<CustomerForm mode="edit" initial={{ id: "c1" }} onSaved={onSaved} />);
    await screen.findByText("שמורה עד היום: בית שמש | יחזקאל הנביא 27 בחניה");
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent("/api/customers/update")[0]).not.toHaveProperty("structured_address");
    unmount();

    fetchMock.mockClear();
    const onSavedAgain = vi.fn();
    render(<CustomerForm mode="edit" initial={{ id: "c1" }} onSaved={onSavedAgain} />);
    await screen.findByText("שמורה עד היום: בית שמש | יחזקאל הנביא 27 בחניה");
    fireEvent.click(screen.getByRole("button", { name: "בחירה כתובת" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    await waitFor(() => expect(onSavedAgain).toHaveBeenCalled());
    expect(sent("/api/customers/update")[0]).toMatchObject({ structured_address: PICKED });
  });

  it("create: every customer needs a city — without one it says so and sends nothing", async () => {
    const onSaved = vi.fn();
    render(<CustomerForm mode="create" initialName="לקוח חדש" onSaved={onSaved} />);
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "0521234567" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת לקוח" }));
    expect(await screen.findByText("יש לבחור עיר: כתובת מלאה, או רק העיר מהרשימה.")).toBeInTheDocument();
    expect(sent("/api/customers/create")).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("edit: a customer saved with no city must get one before saving", async () => {
    const { fetchCustomerCore } = await import("@/lib/customers/fetchCustomerCore");
    vi.mocked(fetchCustomerCore).mockResolvedValueOnce({ ...CORE, address: null, city: "" } as never);
    const onSaved = vi.fn();
    render(<CustomerForm mode="edit" initial={{ id: "c1" }} onSaved={onSaved} />);
    await screen.findByText("כתובת: אין");
    await waitFor(() => expect(screen.getByRole("button", { name: "שמירת שינויים" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));
    expect(await screen.findByText("יש לבחור עיר: כתובת מלאה, או רק העיר מהרשימה.")).toBeInTheDocument();
    expect(sent("/api/customers/update")).toHaveLength(0);
  });

  it("create: a picked address goes with it, its city as the city", async () => {
    const onSaved = vi.fn();
    render(<CustomerForm mode="create" initialName="לקוח חדש" onSaved={onSaved} />);
    fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: "0521234567" } });
    fireEvent.click(screen.getByRole("button", { name: "בחירה כתובת" }));
    fireEvent.click(screen.getByRole("button", { name: "יצירת לקוח" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent("/api/customers/create")[0]).toMatchObject({ structured_address: PICKED, city: "בית שמש" });
  });
});
