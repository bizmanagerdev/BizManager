// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Saving a customer only writes the contacts / branches that actually changed
// (one request each — rewriting every row on every save cost seconds), and still
// hands every contact back to the caller.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

const CONTACTS = [
  { id: "k1", customer_id: "c1", full_name: "דני", role: "", phone: "050", email: null, whatsapp: null, notes: null, is_primary: true, active: true },
  { id: "k2", customer_id: "c1", full_name: "רותי", role: "", phone: "052", email: null, whatsapp: null, notes: null, is_primary: false, active: true },
];
const BRANCHES = [{ id: "b1", customer_id: "c1", name: "מרכז", address: "ירושלים", phone: null, active: true }];

const { updateCustomerBranchDirect, registerReversibleAction } = vi.hoisted(() => ({
  updateCustomerBranchDirect: vi.fn(async () => ({ ok: true })),
  registerReversibleAction: vi.fn(),
}));

vi.mock("@/lib/customers/branchesContacts", () => ({
  fetchCustomerContactsDirect: vi.fn(async () => CONTACTS),
  fetchCustomerBranchesDirect: vi.fn(async () => BRANCHES),
  updateCustomerBranchDirect,
}));
vi.mock("@/lib/customers/fetchCustomerCore", () => ({ fetchCustomerCore: vi.fn(async () => null) }));
vi.mock("@/components/tags/TagPicker", () => ({
  TagPicker: () => null,
  fetchExistingTagIds: vi.fn(async () => ["t1"]),
}));
vi.mock("@/components/customers/WorkerLinkField", () => ({ WorkerLinkField: () => null }));
vi.mock("@/lib/undo-engine", () => ({ registerReversibleAction }));

import { EditCustomerDialog } from "@/components/customers/EditCustomerDialog";

const CUSTOMER = {
  id: "c1",
  name: "לקוח",
  name_for_invoice: null,
  registration_number: null,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  notes: null,
  active: true,
  requires_prepayment: false,
  contacts: CONTACTS,
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url === "/api/customers/update") return new Response(JSON.stringify({ customer: { id: "c1", name: body.name } }));
  if (url === "/api/customer-contacts/update") return new Response(JSON.stringify({ contact: { id: body.id, ...body } }));
  return new Response("{}", { status: 404 });
});

beforeEach(() => {
  fetchMock.mockClear();
  updateCustomerBranchDirect.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

async function openDialog(onSaved = vi.fn()) {
  render(<EditCustomerDialog open onOpenChange={() => {}} customer={CUSTOMER} onSaved={onSaved} />);
  // Contacts and branches are reloaded from the database on open.
  await waitFor(() => expect(screen.getAllByDisplayValue("מרכז").length).toBeGreaterThan(0));
  return onSaved;
}

function calls(url: string) {
  return fetchMock.mock.calls.filter(([u]) => u === url).map(([, init]) => JSON.parse(String(init?.body)));
}

describe("EditCustomerDialog save", () => {
  it("writes only the contact that changed, and leaves branches and tags alone", async () => {
    const onSaved = await openDialog();
    fireEvent.change(screen.getByDisplayValue("רותי"), { target: { value: "רותי כהן" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls("/api/customer-contacts/update")).toEqual([
      expect.objectContaining({ id: "k2", full_name: "רותי כהן" }),
    ]);
    expect(updateCustomerBranchDirect).not.toHaveBeenCalled();
    expect(calls("/api/customers/update")[0]).not.toHaveProperty("tag_ids");

    // The untouched contact still comes back to the caller.
    const { contacts } = onSaved.mock.calls[0][0] as { contacts: Array<{ id: string; full_name: string }> };
    expect(contacts.map((c) => [c.id, c.full_name])).toEqual([
      ["k1", "דני"],
      ["k2", "רותי כהן"],
    ]);
  });

  it("writes nothing but the customer itself when no contact or branch changed", async () => {
    const onSaved = await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls("/api/customers/update")).toHaveLength(1);
    expect(calls("/api/customer-contacts/update")).toHaveLength(0);
    expect(updateCustomerBranchDirect).not.toHaveBeenCalled();
  });
});
