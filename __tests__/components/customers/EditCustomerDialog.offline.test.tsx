// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The customer edit dialog with a poor or no connection (playbook, 2026-10-13):
// - opened offline it keeps the contacts it was handed (a failed read answers
//   an empty list, which used to wipe them) and says they weren't refreshed;
// - its saves go through the app's queue: offline, the customer and every
//   contact / new branch after it wait, in order, and go out by themselves —
//   the caller is told the save is waiting; a change to an existing branch
//   (written straight to the database) is refused before anything is written;
// - tags that were never read are never sent (the route replaces them all);
// - an undo hands the list the customer as it was, instead of a page refresh;
// - a contact refused after the customer saved says so, and a second save
//   doesn't create the contacts that did go through twice.

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: nav.refresh, prefetch: vi.fn() }),
}));

const CONTACTS = [
  { id: "k1", customer_id: "c1", full_name: "דני", role: "", phone: "050", email: null, whatsapp: null, notes: null, is_primary: true, active: true },
];

const lib = vi.hoisted(() => ({
  fetchCustomerContactsDirect: vi.fn(),
  fetchCustomerBranchesDirect: vi.fn(),
  updateCustomerBranchDirect: vi.fn(),
  fetchExistingTagIds: vi.fn(),
  offlineFetch: vi.fn(),
  enqueue: vi.fn(),
  invalidateCustomerSearchIndex: vi.fn(),
  registerReversibleAction: vi.fn(),
}));
vi.mock("@/lib/customers/branchesContacts", () => ({
  fetchCustomerContactsDirect: lib.fetchCustomerContactsDirect,
  fetchCustomerBranchesDirect: lib.fetchCustomerBranchesDirect,
  updateCustomerBranchDirect: lib.updateCustomerBranchDirect,
}));
vi.mock("@/lib/customers/fetchCustomerCore", () => ({ fetchCustomerCore: vi.fn(async () => null) }));
vi.mock("@/components/tags/TagPicker", () => ({
  TagPicker: () => <div data-testid="tag-picker" />,
  fetchExistingTagIds: lib.fetchExistingTagIds,
}));
vi.mock("@/components/customers/WorkerLinkField", () => ({ WorkerLinkField: () => null }));
vi.mock("@/lib/undo-engine", () => ({ registerReversibleAction: lib.registerReversibleAction }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: lib.offlineFetch, enqueue: lib.enqueue }));
vi.mock("@/hooks/useCustomerSearchIndex", () => ({ invalidateCustomerSearchIndex: lib.invalidateCustomerSearchIndex }));

import { EditCustomerDialog } from "@/components/customers/EditCustomerDialog";

const CUSTOMER = {
  id: "c1",
  name: "לקוח",
  name_for_invoice: null,
  registration_number: null,
  phone: "050-1111111",
  whatsapp: null,
  email: null,
  address: null,
  notes: "הערה",
  active: true,
  requires_prepayment: false,
  linked_user_id: null,
  contacts: CONTACTS,
};

let online = true;
beforeEach(() => {
  vi.clearAllMocks();
  online = true;
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  lib.fetchCustomerContactsDirect.mockResolvedValue(CONTACTS);
  lib.fetchCustomerBranchesDirect.mockResolvedValue([{ id: "b1", customer_id: "c1", name: "מרכז", address: null, phone: null, active: true }]);
  lib.updateCustomerBranchDirect.mockResolvedValue({ ok: true });
  lib.fetchExistingTagIds.mockResolvedValue(["t1"]);
});

function openDialog(props: Partial<Parameters<typeof EditCustomerDialog>[0]> = {}) {
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  const onUndone = vi.fn();
  render(
    <EditCustomerDialog open onOpenChange={onOpenChange} customer={CUSTOMER} onSaved={onSaved} onUndone={onUndone} {...props} />
  );
  return { onSaved, onOpenChange, onUndone };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "שמירת שינויים" }));

describe("EditCustomerDialog — opening", () => {
  it("with no connection keeps the contacts it was handed, and says what wasn't loaded", () => {
    online = false;
    openDialog();
    expect(screen.getByDisplayValue("דני")).toBeInTheDocument();
    expect(screen.getByText(/לא ניתן היה לרענן את אנשי הקשר/)).toBeInTheDocument();
    expect(screen.getByText(/הסניפים לא נטענו/)).toBeInTheDocument();
    expect(screen.getByText(/את התגיות אפשר לערוך כשיחזור החיבור/)).toBeInTheDocument();
    expect(screen.queryByTestId("tag-picker")).toBeNull();
    expect(lib.fetchCustomerContactsDirect).not.toHaveBeenCalled();
  });

  it("keeps the known contacts when the read answers nothing (a failed read does)", async () => {
    lib.fetchCustomerContactsDirect.mockResolvedValue([]);
    openDialog();
    await waitFor(() => expect(screen.getByText(/לא ניתן היה לרענן את אנשי הקשר/)).toBeInTheDocument());
    expect(screen.getByDisplayValue("דני")).toBeInTheDocument();
  });
});

describe("EditCustomerDialog — saving with no connection", () => {
  it("queues the customer, then its contacts and new branches in order, and says the save is waiting", async () => {
    online = false;
    lib.offlineFetch.mockResolvedValue({ queued: true, reason: "offline" });
    const { onSaved, onOpenChange } = openDialog();
    fireEvent.change(screen.getByDisplayValue("דני"), { target: { value: "דני כהן" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספת איש קשר" }));
    const nameFields = screen.getAllByText("שם מלא *").map((label) => label.parentElement!.querySelector("input")!);
    fireEvent.change(nameFields[nameFields.length - 1], { target: { value: "רותי" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספת סניף" }));
    const branchName = screen.getByText("שם הסניף *").parentElement!.querySelector("input")!;
    fireEvent.change(branchName, { target: { value: "צפון" } });
    save();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    // The first goes through offlineFetch (it queues it); the rest wait right behind it.
    expect(lib.offlineFetch).toHaveBeenCalledTimes(1);
    expect(lib.offlineFetch.mock.calls[0][0]).toBe("/api/customers/update");
    expect(lib.enqueue.mock.calls.map(([entry]) => entry.url)).toEqual([
      "/api/customer-contacts/update",
      "/api/customer-contacts/create",
      "/api/customer-branches/create",
    ]);
    // Creates carry an idempotency key, so a replay can't make two.
    expect(lib.enqueue.mock.calls[1][0].idempotencyKey).toBeTruthy();
    expect(lib.enqueue.mock.calls[0][0].idempotencyKey).toBeUndefined();
    expect(onSaved.mock.calls[0][0]).toMatchObject({ queued: true, customer: { id: "c1", name: "לקוח", notes: "הערה" } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Nothing on the server yet: no undo, and the search index isn't reloaded.
    expect(lib.registerReversibleAction).not.toHaveBeenCalled();
    expect(lib.invalidateCustomerSearchIndex).not.toHaveBeenCalled();
  });

  it("refuses a change to an existing branch before writing anything", async () => {
    const view = openDialog();
    await waitFor(() => expect(screen.getByDisplayValue("מרכז")).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue("מרכז"), { target: { value: "מרכז העיר" } });
    online = false;
    save();
    expect(await screen.findByText(/שינוי בסניפים קיימים נשמר רק עם חיבור/)).toBeInTheDocument();
    expect(lib.offlineFetch).not.toHaveBeenCalled();
    expect(lib.updateCustomerBranchDirect).not.toHaveBeenCalled();
    expect(view.onSaved).not.toHaveBeenCalled();
  });
});

describe("EditCustomerDialog — saving online", () => {
  function answerLikeTheRoutes() {
    lib.offlineFetch.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      if (url === "/api/customers/update") return { queued: false, ok: true, data: { customer: { ...body } } };
      if (url === "/api/customer-contacts/update") return { queued: false, ok: true, data: { contact: { ...body } } };
      if (url === "/api/customer-contacts/create") {
        if (body.full_name === "נדחה") return { queued: false, ok: false, status: 400, error: "שם איש הקשר לא תקין" };
        return { queued: false, ok: true, data: { contact: { id: `new-${String(body.full_name)}`, ...body } } };
      }
      return { queued: false, ok: true, data: {} };
    });
  }

  it("goes through the app's queue, makes the customer searchable at once, and its undo patches the list (no refresh)", async () => {
    answerLikeTheRoutes();
    const { onSaved, onUndone } = openDialog();
    await waitFor(() => expect(lib.fetchExistingTagIds).toHaveBeenCalled());
    fireEvent.change(screen.getByDisplayValue("הערה"), { target: { value: "הערה חדשה" } });
    save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(lib.offlineFetch.mock.calls[0][0]).toBe("/api/customers/update");
    expect(lib.invalidateCustomerSearchIndex).toHaveBeenCalled();

    const { onUndo } = lib.registerReversibleAction.mock.calls[0][0] as { onUndo: () => Promise<{ ok: boolean }> };
    lib.offlineFetch.mockClear();
    await expect(onUndo()).resolves.toEqual({ ok: true });
    const undoBody = lib.offlineFetch.mock.calls[0][1] as Record<string, unknown>;
    expect(undoBody).toMatchObject({ id: "c1", notes: "הערה" });
    // The tags weren't touched by the save, so the undo doesn't send them.
    expect(undoBody).not.toHaveProperty("tag_ids");
    expect(onUndone).toHaveBeenCalledWith(expect.objectContaining({ customer: expect.objectContaining({ id: "c1", notes: "הערה" }) }));
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("a contact refused after the customer saved: says so, stays open, and a second save doesn't repeat what went through", async () => {
    answerLikeTheRoutes();
    const { onSaved, onOpenChange } = openDialog();
    await waitFor(() => expect(lib.fetchCustomerContactsDirect).toHaveBeenCalled());
    const addContact = () => {
      fireEvent.click(screen.getByRole("button", { name: "הוספת איש קשר" }));
      const nameFields = screen.getAllByText("שם מלא *").map((label) => label.parentElement!.querySelector("input")!);
      return nameFields[nameFields.length - 1];
    };
    fireEvent.change(addContact(), { target: { value: "חדש" } });
    fireEvent.change(addContact(), { target: { value: "נדחה" } });
    save();

    expect(await screen.findByText(/פרטי הלקוח נשמרו, אבל/)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ queued: false }));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    lib.offlineFetch.mockClear();
    save();
    await waitFor(() => expect(lib.offlineFetch).toHaveBeenCalled());
    const creates = lib.offlineFetch.mock.calls.filter(([url]) => url === "/api/customer-contacts/create").map(([, body]) => body.full_name);
    expect(creates).toEqual(["נדחה"]);
  });
});
