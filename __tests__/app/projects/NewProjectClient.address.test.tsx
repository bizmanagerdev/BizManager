// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Picking a customer for a project says what their address needs, like the
// order wizard (owner, 2026-10-18: "do the same for projects"): nothing for a
// full address Google found or a saved point; otherwise it asks.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/offline-queue", () => ({
  offlineFetch: vi.fn(),
  saveDraft: vi.fn(),
  loadDraft: () => null,
  clearDraft: vi.fn(),
}));
vi.mock("@/lib/powersync/store", () => ({ whenDeviceSavesSent: vi.fn(async () => true) }));
vi.mock("@/lib/projects/device-project-saves", () => ({ deviceProjectSaves: () => ({ create: vi.fn(), update: vi.fn() }) }));
vi.mock("@/components/customers/CustomerForm", () => ({
  CustomerForm: ({ mode }: { mode: "create" | "edit" }) => <p>{mode === "edit" ? "טופס עריכת לקוח" : "טופס לקוח חדש"}</p>,
}));

// The customer index: every customer's address as Google found it. Stable
// functions, since the picker lists them as effect dependencies.
const index = vi.hoisted(() => {
  const state = { entries: [] as Record<string, unknown>[] };
  const search = (query: string) => state.entries.filter((e) => String(e.name).includes(query));
  return { state, hook: () => ({ entries: state.entries, search, loading: false }) };
});
vi.mock("@/hooks/useCustomerSearchIndex", () => ({ useCustomerSearchIndex: () => index.hook() }));

import NewProjectClient, { type ProjectCustomerOption } from "@/app/(app)/projects/NewProjectClient";

// jsdom draws no layout: the wizard scrolls its body back to the top on each step.
Element.prototype.scrollTo = () => {};

// As the projects list hands them over: no address at all.
const CUSTOMERS: ProjectCustomerOption[] = [
  { id: "c1", name: "משכן משה", nameForInvoice: null, phone: "052-1234567", whatsapp: null, email: null, city: null, address: null },
];
const entry = (fields: Record<string, unknown>) => ({
  id: "c1",
  name: "משכן משה",
  address: "בני ברק | רבי עקיבא 10",
  delivery_lat: null,
  delivery_lng: null,
  addr_city: null,
  addr_street: null,
  addr_house_number: null,
  addr_place_id: null,
  contacts: [],
  branches: [],
  ...fields,
});

async function renderWizard(props: Partial<Parameters<typeof NewProjectClient>[0]> = {}) {
  render(<NewProjectClient customers={CUSTOMERS} managers={[]} onCancel={() => {}} onSubmitted={() => {}} {...props} />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
const tapCustomer = () => {
  const button = screen.getAllByText("משכן משה").map((el) => el.closest("button")).find(Boolean);
  fireEvent.click(button!);
};
const asked = (title = "צריך לעדכן כתובת ללקוח") => screen.queryByRole("heading", { name: title });

describe("picking a customer for a project", () => {
  beforeEach(() => {
    index.state.entries = [];
  });

  it("Google found only the city: asks, and the note stays on the card", async () => {
    index.state.entries = [entry({ addr_city: "בני ברק", addr_place_id: "ChIJ-bnei-brak" })];
    await renderWizard();
    tapCustomer();
    expect(asked()).toBeInTheDocument();
    expect(screen.getByText(/הכתובת השמורה: רבי עקיבא 10, בני ברק\. אין בה רחוב ומספר בית שנמצאו ב-Google Maps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך בלי" }));
    expect(asked()).not.toBeInTheDocument();
    expect(screen.getByText("אין כתובת מלאה ללקוח הזה")).toBeInTheDocument();
  });

  it("'עדכון הכתובת' opens the customer's edit form", async () => {
    index.state.entries = [entry({})];
    await renderWizard();
    tapCustomer();
    fireEvent.click(screen.getByRole("button", { name: "עדכון הכתובת" }));
    expect(screen.getByText("טופס עריכת לקוח")).toBeInTheDocument();
  });

  it("an address marked not found says so", async () => {
    index.state.entries = [entry({ addr_place_id: "not_found" })];
    await renderWizard();
    tapCustomer();
    expect(asked("הכתובת של הלקוח לא נמצאה במפות")).toBeInTheDocument();
  });

  it.each([
    ["a full address Google found", { addr_city: "בני ברק", addr_street: "רבי עקיבא", addr_house_number: "10", addr_place_id: "ChIJ-akiva-10" }],
    ["a saved drop-off point", { delivery_lat: 32.08, delivery_lng: 34.83 }],
  ])("%s: nothing to ask", async (_label, fields) => {
    index.state.entries = [entry(fields)];
    await renderWizard();
    tapCustomer();
    expect(asked()).not.toBeInTheDocument();
    expect(screen.queryByText("אין כתובת מלאה ללקוח הזה")).not.toBeInTheDocument();
  });

  it("a saved point but no city at all: asks for the city", async () => {
    index.state.entries = [entry({ address: null, delivery_lat: 31.8, delivery_lng: 35.22 })];
    await renderWizard();
    tapCustomer();
    expect(asked("חסרה עיר ללקוח")).toBeInTheDocument();
  });

  it("a customer the index doesn't have yet: nothing is asked rather than a wrong warning", async () => {
    await renderWizard();
    tapCustomer();
    expect(asked()).not.toBeInTheDocument();
  });

  it("opened for a customer (from their page): asks on arrival", async () => {
    index.state.entries = [entry({ addr_city: "בני ברק", addr_place_id: "ChIJ-bnei-brak" })];
    await renderWizard({ initialCustomerId: "c1" });
    expect(asked()).toBeInTheDocument();
  });
});
