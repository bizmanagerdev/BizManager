// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// The new-order wizard (app/(app)/sales/orders/new/NewOrderClient.tsx): one
// question per step, Enter or Next moves on, and the last step sends the order.
// Characterization tests — what a person sees and what is sent — with every
// way out of the browser stubbed at its module boundary: the server (fetch),
// the phone's copy (PowerSync), Supabase (product search, accounts) and the
// storage uploads. The pure helpers in NewOrderClient.ui.tsx have their own
// test next to this one (NewOrderClient.ui.test.ts) — and this file is not
// called NewOrderClient.ui.test.tsx on purpose: of two files that differ only
// by .ts/.tsx, tsc keeps the .ts and never type-checks the other.

// A stable search-params object: the component lists it as an effect
// dependency, and the shared mock hands out a new one on every render.
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", async () => ({
  ...(await import("@/__tests__/mocks/next-navigation")),
  useSearchParams: () => nav.params,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

// The phone's copy (lib/orders/device-order-saves.ts). null: this person saves
// on the server, which is where most tests send the order.
type DeviceSaves = {
  create: Mock<(body: Record<string, unknown>, restore: { key: string; draft: unknown } | null) => Promise<string>>;
  update: Mock<(id: string, body: Record<string, unknown>) => Promise<boolean>>;
};
const device = vi.hoisted(() => ({
  saves: null as DeviceSaves | null,
  /** Everything made on the phone has reached the server (a customer just made there, say). */
  sent: vi.fn(async (_timeoutMs?: number) => true),
}));
vi.mock("@/lib/orders/device-order-saves", () => ({
  deviceOrderSaves: () => device.saves,
  ORDER_NOT_SENT_YET: "ההזמנה עוד לא הגיעה לשרת — אפשר למחוק אותה כשיחזור החיבור.",
}));
vi.mock("@/lib/powersync/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/powersync/store")>()),
  whenDeviceSavesSent: device.sent,
}));

// The autosaved draft — a Map standing in for localStorage, so a test can both
// seed a draft and read back what was saved.
const drafts = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    saveDraft: vi.fn((key: string, data: unknown) => void store.set(key, JSON.parse(JSON.stringify(data)))),
    loadDraft: vi.fn((key: string) => store.get(key) ?? null),
    clearDraft: vi.fn((key: string) => void store.delete(key)),
  };
});
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  saveDraft: drafts.saveDraft,
  loadDraft: drafts.loadDraft,
  clearDraft: drafts.clearDraft,
}));

type UndoArgs = { scope: string; id: string; message: string; onUndo: () => Promise<unknown> | void };
const undo = vi.hoisted(() => ({ registerReversibleCreate: vi.fn((_args: UndoArgs) => {}) }));
vi.mock("@/lib/undo-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/undo-engine")>()),
  registerReversibleCreate: undo.registerReversibleCreate,
}));

// Supabase, behind the product search box and the account picker.
const catalog = vi.hoisted(() => ({
  searchProducts: vi.fn(async (_q: string, _limit?: number, _signal?: AbortSignal) => [] as Record<string, unknown>[]),
}));
vi.mock("@/lib/orders/searchProducts", () => ({ searchProducts: catalog.searchProducts }));

const accounts = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  /** Held to make the accounts arrive late (resolved by default). */
  gate: Promise.resolve() as Promise<void>,
}));
vi.mock("@/lib/accounts/accountsClient", () => ({
  fetchAccountsDirect: async () => {
    await accounts.gate;
    return accounts.list;
  },
}));

const photos = vi.hoisted(() => ({
  upload: vi.fn(async (_items: Array<{ paymentId: string; files: File[] }>) => {}),
}));
vi.mock("@/lib/payments/uploadCheckPhotos", () => ({ uploadCheckPhotosForPayments: photos.upload }));

// The inline customer form is a whole form of its own (contacts, tags, its own
// saves) with its own tests; here it only has to hand a saved customer back.
vi.mock("@/components/customers/CustomerForm", () => ({
  CustomerForm: ({
    mode,
    initialName,
    onSaved,
    onCancel,
  }: {
    mode: "create" | "edit";
    initialName?: string;
    onSaved: (result: { customer: Record<string, unknown>; contacts: unknown[] }) => void;
    onCancel?: () => void;
  }) => (
    <div>
      <p>{mode === "create" ? `טופס לקוח חדש: ${initialName ?? ""}` : "טופס עריכת לקוח"}</p>
      <button
        type="button"
        onClick={() =>
          onSaved({
            customer: {
              id: "c-new",
              name: "נגריית השרון",
              name_for_invoice: null,
              registration_number: null,
              phone: "054-7654321",
              whatsapp: null,
              email: null,
              address: "כפר סבא",
              active: true,
              notes: null,
              requires_prepayment: false,
            },
            contacts: [],
          })
        }
      >
        שמירת הלקוח
      </button>
      <button type="button" onClick={onCancel}>
        סגירת הטופס
      </button>
    </div>
  ),
}));

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { push, refresh } from "@/__tests__/mocks/next-navigation";
import NewOrderClient from "@/app/(app)/sales/orders/new/NewOrderClient";
import { formatCurrency } from "@/app/(app)/sales/orders/new/NewOrderClient.ui";
import { invalidateAccountsCache } from "@/components/financial/AccountSelect";
import { invalidateCustomerSearchIndex } from "@/hooks/useCustomerSearchIndex";
import { ORDER_NOT_SENT_YET } from "@/lib/orders/device-order-saves";

// ---------------------------------------------------------------- fixtures

// What page.tsx hands the form: the first customers and products, as rows.
const CUSTOMER_ROWS = [
  { id: "c1", name: "משכן משה", phone: "052-1234567", email: "office@mishkan.example", address: "בני ברק", requires_prepayment: false },
  { id: "c2", name: "בית הכנסת הגדול", phone: "03-5555555", email: null, address: "ירושלים", requires_prepayment: true },
];
const PRODUCT_ROWS = [
  { id: "p1", name: "שקית חול", sku: "SAND-25", base_price: 120, stock: 10 },
  { id: "p2", name: "מטאטא", sku: "BRM-1", base_price: 35, stock: 1 },
];

/** The same customers as the search index (/api/search-index/customers) serves them. */
function indexEntry(row: (typeof CUSTOMER_ROWS)[number], extra: Record<string, unknown> = {}) {
  return { name_for_invoice: null, whatsapp: null, active: true, contacts: [], branches: [], ...row, ...extra };
}

const CASH_ACCOUNT = { id: "acc-cash", name: "קופה", kind: "cash", openingBalance: 0, openingDate: "2026-01-01", isActive: true, sortOrder: 0, notes: null };
const BANK_A = { id: "acc-bank-a", name: "לאומי", kind: "bank", openingBalance: 0, openingDate: "2026-01-01", isActive: true, sortOrder: 1, notes: null };
const BANK_B = { id: "acc-bank-b", name: "פועלים", kind: "bank", openingBalance: 0, openingDate: "2026-01-01", isActive: true, sortOrder: 2, notes: null };

// ------------------------------------------------------------ the server

type Reply = { status: number; body: unknown };
const server = {
  customerIndex: [] as Record<string, unknown>[],
  /** What /api/orders/create (or /update) answers — or a promise of it, to hold the save open. */
  orderReply: { status: 200, body: { order_id: "o-new", payment_ids: [] } } as Reply | Promise<Reply>,
};

function response({ status, body }: Reply) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url === "/api/search-index/customers") return response({ status: 200, body: { rows: server.customerIndex } });
  if (url === "/api/orders/create" || url === "/api/orders/update") return response(await server.orderReply);
  if (url === "/api/orders/delete") return response({ status: 200, body: { ok: true } });
  return response({ status: 404, body: {} });
});

/** The order as it was sent to the server (parsed back from the request). */
function sentOrder(url = "/api/orders/create") {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === url);
  if (!call) throw new Error(`nothing was sent to ${url}`);
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}
const orderRequests = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/orders/"));

// ------------------------------------------------------------- helpers

async function renderForm(props: Partial<ComponentProps<typeof NewOrderClient>> = {}) {
  const view = render(
    <NewOrderClient
      customers={CUSTOMER_ROWS}
      products={PRODUCT_ROWS}
      customersError={null}
      productsError={null}
      mode="create"
      draftKey="order-create"
      {...props}
    />
  );
  // The customer index and the accounts load once the form opens.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

/** he-IL currency carries bidi marks and a no-break space around the digits. */
const plain = (text: string | null | undefined) => (text ?? "").replace(/[\s‎‏]/g, "");
const shekels = (amount: number) => plain(formatCurrency(amount));

/** What's printed beside each occurrence of a label: a summary row's value, a total's amount. */
function besides(label: string) {
  return screen.getAllByText(label).map((el) => plain(el.nextElementSibling?.textContent));
}

// The helpers that walk the wizard find things by their visible text: a role
// query has to work out the accessible name of every element on the page, and
// on the products step (a card per product, a cart) that cost seconds a test.

/** Next, by its short label (the long "המשך ל<step>" one shows from sm up). */
const nextButton = () => screen.getByText("המשך").closest("button")!;
const createButton = () => screen.getByRole("button", { name: "יצירת הזמנה" });
const next = () => fireEvent.click(nextButton());

/** The step's question — every step opens with one, as its h2. */
const question = (text: string) => screen.queryByText(text, { selector: "h2" });
const expectStep = (text: string) => expect(question(text)).toBeInTheDocument();

/** Next, Next, … until the step asking `text` is on screen. */
function goOnTo(text: string) {
  for (let i = 0; i < 15 && !question(text); i++) next();
  expectStep(text);
}

/** A customer row, product card or option row, by the name it shows. */
function tap(name: string) {
  const button = screen
    .getAllByText(name)
    .map((el) => el.closest("button"))
    .find((el) => el !== null);
  if (!button) throw new Error(`no button shows "${name}"`);
  fireEvent.click(button);
}

/** The usual start: משכן משה, one bag of sand. */
function chooseCustomerAndSand() {
  tap("משכן משה");
  next();
  tap("שקית חול");
}

/** The step bar and the action bar both say where the wizard is. */
const stepCounter = (n: number, of: number) => screen.getAllByText(`שלב ${n} מתוך ${of}`);

/** The new-payment card's fields. Their labels aren't tied to the inputs, so they're found by what they hold. */
const paymentMethodSelect = () => screen.getByDisplayValue("בחר אמצעי תשלום...");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};

  nav.params = new URLSearchParams();
  device.saves = null;
  device.sent.mockReset().mockResolvedValue(true);
  drafts.store.clear();
  drafts.saveDraft.mockClear();
  drafts.loadDraft.mockClear();
  drafts.clearDraft.mockClear();
  undo.registerReversibleCreate.mockClear();
  catalog.searchProducts.mockReset().mockResolvedValue([]);
  photos.upload.mockClear();
  accounts.list = [];
  accounts.gate = Promise.resolve();
  push.mockClear();
  refresh.mockClear();
  vi.mocked(toast.warning).mockClear();

  server.customerIndex = CUSTOMER_ROWS.map((row) => indexEntry(row));
  server.orderReply = { status: 200, body: { order_id: "o-new", payment_ids: [] } };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);

  // Both are module-level caches shared by every mounted picker.
  invalidateCustomerSearchIndex();
  invalidateAccountsCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ===================================================================== tests

describe("the new-order wizard — the first step", () => {
  it("opens on the customer question, with Next off until a customer is chosen", async () => {
    await renderForm();
    expectStep("איזה לקוח?");
    // 12 steps for a customer with no branches on the default term (שוטף, which has a due date).
    expect(stepCounter(1, 12)).toHaveLength(2);
    expect(screen.getByText("בחרו לקוח מהרשימה")).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();
    // Step one has no back button; the way out is a cancel link to the sales page.
    expect(screen.queryByRole("button", { name: "חזרה" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ביטול" })).toHaveAttribute("href", "/sales");

    tap("משכן משה");
    expect(screen.getByRole("heading", { name: "משכן משה" })).toBeInTheDocument();
    expect(screen.getByText("נבחר")).toBeInTheDocument();
    expect(nextButton()).toBeEnabled();
    next();
    expectStep("אילו מוצרים?");
    expect(stepCounter(2, 12)).toHaveLength(2);
  });

  it("marks a pay-ahead customer in the list and on the chosen card", async () => {
    await renderForm();
    const row = screen.getByRole("button", { name: /^בית הכנסת הגדול/ });
    expect(within(row).getByText("תשלום מראש")).toBeInTheDocument();
    fireEvent.click(row);
    expect(besides("אופן תשלום:")).toEqual(["תשלוםמראש"]);
  });

  it("narrows the list as the search is typed, and offers a new customer when nothing matches", async () => {
    await renderForm();
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש לקוח" }), { target: { value: "משכן" } });
    expect(screen.getByRole("button", { name: /^משכן משה/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^בית הכנסת הגדול/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש לקוח" }), { target: { value: "נגריית" } });
    expect(screen.getByText("לא נמצאו לקוחות לחיפוש הזה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הוספת לקוח חדש" }));
    // The new-customer form starts from what was searched.
    expect(screen.getByText("טופס לקוח חדש: נגריית")).toBeInTheDocument();
  });

  it("blocks Next while the new-customer form is open, and picks the customer it saves", async () => {
    await renderForm();
    tap("משכן משה");
    fireEvent.click(screen.getByRole("button", { name: "לקוח חדש" }));
    // A customer is chosen, but leaving now would drop the half-made one.
    expect(nextButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "שמירת הלקוח" }));
    expect(screen.getByRole("heading", { name: "נגריית השרון" })).toBeInTheDocument();
    expect(nextButton()).toBeEnabled();
  });

  it("shows the server's load errors above the form", async () => {
    await renderForm({ customersError: "timeout", productsError: "permission denied" });
    expect(screen.getByText("שגיאת לקוחות: timeout")).toBeInTheDocument();
    expect(screen.getByText("שגיאת מוצרים: permission denied")).toBeInTheDocument();
  });
});

describe("the products step", () => {
  it("keeps Next off until a product is added, and again once the last line is removed", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    expect(screen.getByText("עדיין לא נוספו מוצרים. הקליקו על מוצר כדי להוסיף.")).toBeInTheDocument();
    expect(nextButton()).toBeDisabled();

    tap("שקית חול");
    expect(nextButton()).toBeEnabled();
    fireEvent.click(screen.getByLabelText("הסרת שקית חול"));
    expect(nextButton()).toBeDisabled();
  });

  it("adds up the lines: a second tap is one more unit, and the totals follow every change", async () => {
    await renderForm();
    chooseCustomerAndSand();
    tap("שקית חול");
    expect(besides("פריטי הזמנה")).toEqual(["2"]);
    // The cart's own total row and the running total in the action bar.
    expect(besides("סכום ביניים")).toEqual([shekels(240), shekels(240)]);
    expect(besides("סה״כ")).toEqual([shekels(240)]);

    fireEvent.click(screen.getByLabelText("הגדלת כמות של שקית חול"));
    expect(besides("סה״כ")).toEqual([shekels(360)]);
    fireEvent.click(screen.getByLabelText("הפחתת כמות של שקית חול"));
    fireEvent.click(screen.getByLabelText("הפחתת כמות של שקית חול"));
    // Never below one — the button turns off there.
    expect(screen.getByLabelText("הפחתת כמות של שקית חול")).toBeDisabled();
    expect(besides("סה״כ")).toEqual([shekels(120)]);
  });

  it("takes a whole-order discount in ₪ or %, and never lets it take the order below zero", async () => {
    await renderForm();
    chooseCustomerAndSand();
    tap("שקית חול");
    const discountBox = () => within(screen.getAllByText("הנחת הזמנה")[0].parentElement!);

    fireEvent.change(discountBox().getByRole("textbox"), { target: { value: "40" } });
    expect(besides("סה״כ")).toEqual([shekels(200)]);
    // With a discount the action bar says what is left to pay.
    expect(besides("סכום לתשלום")).toEqual([shekels(200)]);
    expect(screen.queryAllByText("סכום ביניים")).toHaveLength(1);

    fireEvent.change(discountBox().getByRole("textbox"), { target: { value: "1000" } });
    expect(discountBox().getByRole("textbox")).toHaveValue("240");
    expect(besides("סה״כ")).toEqual([shekels(0)]);

    fireEvent.click(discountBox().getByRole("button", { name: "%" }));
    fireEvent.change(discountBox().getByRole("textbox"), { target: { value: "10" } });
    expect(besides("סה״כ")).toEqual([shekels(216)]);
  });

  it("keeps a line's own discount as ₪ — typed as % it is worked out once, and a later price change keeps the ₪", async () => {
    await renderForm();
    chooseCustomerAndSand();
    tap("שקית חול");
    // The line's ₪/% switch and fields sit before the whole-order ones.
    fireEvent.click(screen.getAllByText("%")[0]);
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], { target: { value: "10" } });
    expect(besides("סה״כ")).toEqual([shekels(216)]);
    fireEvent.change(screen.getByPlaceholderText("מחיר"), { target: { value: "100" } });
    expect(besides("סה״כ")).toEqual([shekels(176)]);
    fireEvent.change(screen.getAllByPlaceholderText("אופציונלי")[0], { target: { value: "  שקיות כפולות  " } });

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder().items).toEqual([
      { product_id: "p1", description: "", quantity_ordered: 2, unit_price: 100, discount_amount: 24, notes: "שקיות כפולות" },
    ]);
  });

  it("a lower quantity never leaves a line's discount bigger than the line", async () => {
    await renderForm();
    chooseCustomerAndSand();
    tap("שקית חול");
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], { target: { value: "200" } });
    expect(besides("סה״כ")).toEqual([shekels(40)]);

    // ₪200 off one ₪120 bag would be −₪80: the discount comes down with the line.
    fireEvent.click(screen.getByLabelText("הפחתת כמות של שקית חול"));
    expect(besides("סה״כ")).toEqual([shekels(0)]);

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder().items).toEqual([
      expect.objectContaining({ quantity_ordered: 1, unit_price: 120, discount_amount: 120 }),
    ]);
  });

  it("warns when an order takes more than is in stock — and says it again at save", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    tap("מטאטא");
    expect(toast.warning).not.toHaveBeenCalled();
    tap("מטאטא");
    expect(toast.warning).toHaveBeenCalledWith("נשארו רק 1 במלאי ממטאטא", { id: "stock-shortfall-p2" });
    expect(screen.getByText("חסר במלאי — במלאי 1, הוזמנו 2")).toBeInTheDocument();

    goOnTo("לאשר ולשמור?");
    expect(screen.getByText(/יש חוסר במלאי בהזמנה זו/)).toBeInTheDocument();
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    // Backorders are allowed — the order goes, with a heads-up.
    expect(toast.warning).toHaveBeenLastCalledWith("שימו לב: קיים חוסר במלאי בהזמנה זו.");
  });

  it("searches the catalog: filters at once, then shows what the server found", async () => {
    catalog.searchProducts.mockResolvedValue([{ id: "p3", name: "מטאטא כביש", sku: "BRM-2", base_price: 60, available_quantity: 4 }]);
    await renderForm();
    tap("משכן משה");
    next();
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש מוצר" }), { target: { value: "מטאטא" } });
    expect(screen.queryByText("שקית חול")).not.toBeInTheDocument();
    expect(await screen.findByText("מטאטא כביש")).toBeInTheDocument();
    expect(catalog.searchProducts).toHaveBeenCalledWith("מטאטא", 50, expect.any(AbortSignal));
  });

  it("shows a failed catalog search", async () => {
    catalog.searchProducts.mockRejectedValue(new Error("שירות החיפוש לא זמין"));
    await renderForm();
    tap("משכן משה");
    next();
    fireEvent.change(screen.getByRole("textbox", { name: "חיפוש מוצר" }), { target: { value: "חול" } });
    expect(await screen.findByText("שגיאת חיפוש מוצרים: שירות החיפוש לא זמין")).toBeInTheDocument();
  });
});

describe("moving on with Enter (owner rule: Enter in a field moves a new order on, like Next)", () => {
  it("moves on from a date field", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("תאריך פירעון?");
    fireEvent.keyDown(screen.getByPlaceholderText("מחושב מצורת התשלום"), { key: "Enter" });
    expectStep("תשלומים");
  });

  it("moves on from a free line's name, on the products step", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    fireEvent.click(screen.getByRole("button", { name: "שורה חופשית" }));
    fireEvent.keyDown(screen.getByPlaceholderText("שם השורה (למשל: משלוח)"), { key: "Enter" });
    expectStep("צריך חשבונית?");
  });

  it("leaves the search boxes and the notes alone — Enter means something else there", async () => {
    await renderForm();
    tap("משכן משה");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "חיפוש לקוח" }), { key: "Enter" });
    expectStep("איזה לקוח?");

    next();
    tap("שקית חול");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "חיפוש מוצר" }), { key: "Enter" });
    expectStep("אילו מוצרים?");

    goOnTo("הערות להזמנה?");
    // A multi-line field: Enter is a new line.
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expectStep("הערות להזמנה?");
  });
});

describe("the choice steps", () => {
  it("offers only פתוח and סופק as the order's status, פתוח first and chosen", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("מה סטטוס ההזמנה?");
    const body = question("מה סטטוס ההזמנה?")!.parentElement!;
    const options = within(body).getAllByRole("button");
    expect(options.map((option) => option.textContent)).toEqual(["פתוח", "סופק"]);
    expect(options[0]).toHaveClass("bg-primary");
    expect(options[1]).not.toHaveClass("bg-primary");

    // A tap is the answer: it moves straight on.
    fireEvent.click(options[1]);
    expectStep("תאריך אספקה מבוקש?");
  });

  it("drops the due-date step for מיידי, and jumps from the term straight to the payments", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("מהי צורת התשלום?");
    fireEvent.click(screen.getByRole("button", { name: "מיידי" }));
    expectStep("תשלומים");
    expect(stepCounter(6, 11)).toHaveLength(2);
  });

  it("moves the suggested due date with a new order date", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("מתי בוצעה ההזמנה?");
    fireEvent.change(screen.getByPlaceholderText("בחר תאריך הזמנה"), { target: { value: "15/11/26" } });
    goOnTo("לאשר ולשמור?");
    expect(besides("תאריך הזמנה")).toEqual(["2026-11-15"]);
    // שוטף: the end of the new date's month.
    expect(besides("תאריך פירעון")).toEqual(["2026-11-30"]);
  });

  it("asks which branch when the customer has branches, and sends the one chosen", async () => {
    server.customerIndex = [
      indexEntry(CUSTOMER_ROWS[0], {
        branches: [{ id: "b-north", name: "סניף צפון", address: "חיפה", phone: null }],
      }),
    ];
    await renderForm();
    tap("משכן משה");
    expect(stepCounter(1, 13)).toHaveLength(2);
    next();
    expectStep("לאיזה סניף?");
    expect(screen.getByText("למשכן משה יש סניפים — לאיזה מהם ההזמנה?")).toBeInTheDocument();
    tap("סניף צפון");
    expectStep("אילו מוצרים?");

    tap("שקית חול");
    goOnTo("לאשר ולשמור?");
    expect(besides("סניף")).toEqual(["סניףצפון"]);
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder()).toMatchObject({ customer_id: "c1", branch_id: "b-north" });
  });
});

describe("saving the order", () => {
  it("sends what was built, with each step's default, and goes back to the sales page", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    expect(besides("שם")).toEqual(["משכןמשה"]);
    expect(besides("תאריך הזמנה")).toEqual(["2026-10-11"]);
    expect(besides("סטטוס הזמנה")).toEqual(["פתוח"]);
    expect(besides("חשבונית")).toEqual(["צריךחשבונית"]);
    expect(besides("גבייה")).toEqual(["תשלוםלמשרד"]);
    expect(besides("צורת תשלום")).toEqual(["שוטף"]);
    expect(besides("תאריך פירעון")).toEqual(["2026-10-31"]);
    expect(besides("סטטוס תשלום")).toEqual(["לאשולם"]);
    expect(besides("יתרה אחרי שמירה")).toEqual([shekels(120)]);

    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));

    expect(sentOrder()).toEqual({
      customer_id: "c1",
      branch_id: null,
      order_date: "2026-10-11",
      status: "draft",
      payment_status: "unpaid",
      payment_terms: "eom",
      collect_payment_on_delivery: false,
      // שוטף: the end of the order's month.
      due_date: "2026-10-31",
      requested_delivery_date: null,
      discount_amount: 0,
      needs_invoice: true,
      notes: null,
      payments: [],
      items: [{ product_id: "p1", description: "", quantity_ordered: 1, unit_price: 120, discount_amount: 0, notes: null }],
      existing_payment_notes: [],
    });
    const [, init] = orderRequests()[0];
    // A retried create must not make a second order: the server dedupes on this key.
    expect(init?.headers).toEqual({ "content-type": "application/json", "Idempotency-Key": expect.any(String) });
    // A customer just made on the phone has to reach the server before its order does.
    const createCall = fetchMock.mock.calls.findIndex(([input]) => String(input) === "/api/orders/create");
    expect(device.sent.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[createCall]);
    expect(refresh).toHaveBeenCalled();
    expect(drafts.clearDraft).toHaveBeenCalledWith("order-create");
    expect(undo.registerReversibleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "order", id: "o-new", message: "ההזמנה נוצרה" })
    );
  });

  it("sends every answer the steps were given", async () => {
    await renderForm();
    chooseCustomerAndSand();
    next();
    fireEvent.click(screen.getByRole("button", { name: "לא צריך חשבונית" }));
    fireEvent.click(screen.getByRole("button", { name: "הנהג גובה תשלום במסירה" }));
    fireEvent.click(screen.getByRole("button", { name: "שוטף+30" }));
    // The suggested due date follows the term — still editable.
    expect(screen.getByPlaceholderText("מחושב מצורת התשלום")).toHaveValue("30/11/26");
    goOnTo("מה סטטוס ההזמנה?");
    fireEvent.click(screen.getByRole("button", { name: "סופק" }));
    fireEvent.change(screen.getByPlaceholderText("dd/mm/yy"), { target: { value: "20/10/26" } });
    next();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  להשאיר ליד הדלת  " } });
    next();

    expect(besides("סטטוס הזמנה")).toEqual(["סופק"]);
    expect(besides("תאריך אספקה מבוקש")).toEqual(["2026-10-20"]);
    expect(besides("הערות")).toEqual(["להשאירלידהדלת"]);
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder()).toMatchObject({
      status: "delivered",
      needs_invoice: false,
      collect_payment_on_delivery: true,
      payment_terms: "eom_30",
      due_date: "2026-11-30",
      requested_delivery_date: "2026-10-20",
      notes: "להשאיר ליד הדלת",
    });
  });

  it("sends a free line by its name, with no product, and the order discount", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    fireEvent.click(screen.getByRole("button", { name: "שורה חופשית" }));
    fireEvent.change(screen.getByPlaceholderText("שם השורה (למשל: משלוח)"), { target: { value: "משלוח" } });
    fireEvent.change(screen.getByPlaceholderText("מחיר"), { target: { value: "50" } });
    tap("שקית חול");
    fireEvent.change(within(screen.getAllByText("הנחת הזמנה")[0].parentElement!).getByRole("textbox"), {
      target: { value: "20" },
    });
    expect(besides("סה״כ")).toEqual([shekels(150)]);

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    const order = sentOrder();
    expect(order.items).toEqual([
      { product_id: "", description: "משלוח", quantity_ordered: 1, unit_price: 50, discount_amount: 0, notes: null },
      { product_id: "p1", description: "", quantity_ordered: 1, unit_price: 120, discount_amount: 0, notes: null },
    ]);
    expect(order.discount_amount).toBe(20);
  });

  it("goes back from each summary section's pencil to the step it sums up", async () => {
    await renderForm();
    chooseCustomerAndSand();
    for (const [pencil, step] of [
      ["עריכת תשלום", "צריך חשבונית?"],
      ["עריכת פרטי הזמנה", "מתי בוצעה ההזמנה?"],
      ["עריכת פריטים (1)", "אילו מוצרים?"],
      ["עריכת לקוח", "איזה לקוח?"],
    ] as const) {
      goOnTo("לאשר ולשמור?");
      fireEvent.click(screen.getByLabelText(pencil));
      expectStep(step);
    }
  });

  it("refuses a free line with no name, and sends nothing", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    fireEvent.click(screen.getByRole("button", { name: "שורה חופשית" }));
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    expect(await screen.findByText("יש להזין שם לכל שורה חופשית.")).toBeInTheDocument();
    expect(orderRequests()).toHaveLength(0);
  });

  it("shows the server's refusal on the summary, and stays to fix it", async () => {
    server.orderReply = { status: 400, body: { error: "הלקוח חסום להזמנות" } };
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    expect(await screen.findByText("הלקוח חסום להזמנות")).toBeInTheDocument();
    expect(createButton()).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
    expect(drafts.clearDraft).not.toHaveBeenCalled();
    expect(undo.registerReversibleCreate).not.toHaveBeenCalled();
  });

  it("falls back to a plain Hebrew message when the server's error isn't one it knows", async () => {
    server.orderReply = { status: 500, body: {} };
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    expect(await screen.findByText("יצירת ההזמנה נכשלה.")).toBeInTheDocument();
  });

  it("says there's no connection when the request itself fails", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(createButton());
    expect(await screen.findByText("אין חיבור לשרת. נסו שוב.")).toBeInTheDocument();
  });

  it("shows it's saving and won't send the order twice", async () => {
    let answer: (reply: Reply) => void = () => {};
    server.orderReply = new Promise<Reply>((resolve) => (answer = resolve));
    const onActionLockedChange = vi.fn();
    await renderForm({ onActionLockedChange });
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());

    const saving = await screen.findByRole("button", { name: "יוצר..." });
    expect(saving).toBeDisabled();
    expect(screen.getByText("ההזמנה נוצרת כעת, נא להמתין...")).toBeInTheDocument();
    expect(onActionLockedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(saving);
    expect(orderRequests()).toHaveLength(1);

    await act(async () => answer({ status: 200, body: { order_id: "o-new", payment_ids: [] } }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    expect(onActionLockedChange).toHaveBeenLastCalledWith(false);
  });

  it("saves on the phone's copy when it has one — nothing is sent from the form", async () => {
    device.saves = { create: vi.fn(async () => "o-device"), update: vi.fn(async () => true) };
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));

    expect(orderRequests()).toHaveLength(0);
    const [body, restore] = device.saves.create.mock.calls[0];
    expect(body).toMatchObject({ customer_id: "c1", items: [expect.objectContaining({ product_id: "p1" })] });
    // If the server later refuses it, the form comes back as it stood.
    expect(restore).toEqual({ key: "order-create", draft: expect.objectContaining({ step: "summary", customerId: "c1" }) });
    expect(undo.registerReversibleCreate).toHaveBeenCalledWith(expect.objectContaining({ id: "o-device" }));
  });

  it("undo deletes the new order on the server", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(undo.registerReversibleCreate).toHaveBeenCalled());
    const { onUndo } = undo.registerReversibleCreate.mock.calls[0][0];

    let result: unknown;
    await act(async () => {
      result = await onUndo();
    });
    expect(result).toEqual({ ok: true });
    expect(sentOrder("/api/orders/delete")).toEqual({ order_id: "o-new" });
  });

  it("undo the server refuses says why", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(undo.registerReversibleCreate).toHaveBeenCalled());
    const { onUndo } = undo.registerReversibleCreate.mock.calls[0][0];

    fetchMock.mockResolvedValueOnce(response({ status: 409, body: { error: "ההזמנה כבר סופקה" } }));
    expect(await onUndo()).toEqual({ ok: false, error: "ההזמנה כבר סופקה" });
  });

  it("undo waits for an order made on the phone to reach the server first", async () => {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(undo.registerReversibleCreate).toHaveBeenCalled());
    const { onUndo } = undo.registerReversibleCreate.mock.calls[0][0];

    device.sent.mockResolvedValue(false);
    expect(await onUndo()).toEqual({ ok: false, error: ORDER_NOT_SENT_YET });
    expect(orderRequests().filter(([input]) => String(input) === "/api/orders/delete")).toHaveLength(0);
  });
});

describe("payments", () => {
  async function toPayments() {
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("תשלומים");
    expect(screen.getByText("עדיין לא הוזנו תשלומים חדשים.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "תשלום" }));
    // The payment card's account picker loads the accounts on its own; a method
    // picked before they arrive gets no default account.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("a method picked before the accounts arrive still gets its account", async () => {
    accounts.list = [CASH_ACCOUNT];
    let arrive: () => void = () => {};
    accounts.gate = new Promise<void>((resolve) => (arrive = resolve));
    await renderForm();
    chooseCustomerAndSand();
    goOnTo("תשלומים");
    fireEvent.click(screen.getByRole("button", { name: "תשלום" }));
    fireEvent.change(paymentMethodSelect(), { target: { value: "cash" } });
    await act(async () => {
      arrive();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder().payments).toEqual([expect.objectContaining({ payment_method: "cash", account_id: "acc-cash" })]);
  });

  it("starts a payment at the open balance; one cash account is its account; the order goes paid", async () => {
    accounts.list = [CASH_ACCOUNT];
    await toPayments();
    expect(screen.getByText("תשלום חדש #1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("120.00")).toBeInTheDocument();
    fireEvent.change(paymentMethodSelect(), { target: { value: "cash" } });

    goOnTo("לאשר ולשמור?");
    expect(besides("סטטוס תשלום")).toEqual(["שולם"]);
    expect(besides("שולם / יוזן")).toEqual([shekels(120)]);
    expect(besides("יתרה אחרי שמירה")).toEqual([shekels(0)]);
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder()).toMatchObject({
      payment_status: "paid",
      payments: [
        {
          amount_total: 120,
          payment_date: "2026-10-11",
          payment_method: "cash",
          account_id: "acc-cash",
          due_date: null,
          reference_number: null,
          check_number: null,
          notes: null,
        },
      ],
    });
  });

  it("sends a card payment in installments as one payment a month, each due on the 10th of the next", async () => {
    await toPayments();
    fireEvent.change(paymentMethodSelect(), { target: { value: "credit_card" } });
    fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "3" } });
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sentOrder().payments).toEqual([
      expect.objectContaining({ amount_total: 40, payment_date: "2026-10-11", due_date: "2026-11-10", notes: "תשלום 1/3" }),
      expect.objectContaining({ amount_total: 40, payment_date: "2026-11-11", due_date: "2026-12-10", notes: "תשלום 2/3" }),
      expect.objectContaining({ amount_total: 40, payment_date: "2026-12-11", due_date: "2027-01-10", notes: "תשלום 3/3" }),
    ]);
  });

  it("starts a second payment at what the first leaves open", async () => {
    await toPayments();
    fireEvent.change(screen.getByDisplayValue("120.00"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "תשלום" }));
    expect(screen.getByText("תשלום חדש #2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("70.00")).toBeInTheDocument();
  });

  it("removes a payment that's no longer wanted", async () => {
    await toPayments();
    fireEvent.click(screen.getByRole("button", { name: "הסרת תשלום" }));
    expect(screen.getByText("עדיין לא הוזנו תשלומים חדשים.")).toBeInTheDocument();
  });

  it.each([
    {
      what: "a payment with no method",
      fill: () => {},
      message: "יש להשלים לכל תשלום חדש סכום, תאריך ואמצעי תשלום.",
    },
    {
      what: "a check with no due date",
      fill: () => fireEvent.change(paymentMethodSelect(), { target: { value: "check" } }),
      message: "יש להזין תאריך פירעון לכל צ'ק.",
    },
    {
      what: "card installments out of range",
      fill: () => {
        fireEvent.change(paymentMethodSelect(), { target: { value: "credit_card" } });
        fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "40" } });
      },
      message: "מספר התשלומים צריך להיות בין 1 ל-36.",
    },
    {
      what: "no account where there are several to choose from",
      accounts: [BANK_A, BANK_B],
      fill: () => fireEvent.change(paymentMethodSelect(), { target: { value: "bank_transfer" } }),
      message: "יש לבחור חשבון לכל תשלום חדש.",
    },
  ])("refuses $what at save, and sends nothing", async ({ fill, message, accounts: list }) => {
    accounts.list = list ?? [];
    await toPayments();
    fill();
    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(orderRequests()).toHaveLength(0);
  });

  it("sends a check with a photo to the server — not the phone's copy — and the photo up with its payment", async () => {
    device.saves = { create: vi.fn(async () => "o-device"), update: vi.fn(async () => true) };
    server.orderReply = { status: 200, body: { order_id: "o-new", payment_ids: ["pay-1"] } };
    await toPayments();
    fireEvent.change(paymentMethodSelect(), { target: { value: "check" } });
    // The check's own fields: its due date is the second date field on the card (the first is the payment's date).
    fireEvent.change(screen.getAllByPlaceholderText("dd/mm/yy")[1], { target: { value: "01/11/26" } });
    fireEvent.change(screen.getByPlaceholderText("לדוגמה 123456"), { target: { value: "1234" } });
    const photo = new File(["%PDF"], "check.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [photo] } });
    });

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(device.saves.create).not.toHaveBeenCalled();
    expect(sentOrder().payments).toEqual([
      expect.objectContaining({ payment_method: "check", due_date: "2026-11-01", check_number: "1234" }),
    ]);
    expect(photos.upload).toHaveBeenCalledWith([{ paymentId: "pay-1", files: [photo] }]);
  });
});

describe("a pay-ahead customer", () => {
  it("is warned about on the payments step, and asked about once more before an unpaid order is saved", async () => {
    await renderForm();
    tap("בית הכנסת הגדול");
    next();
    tap("שקית חול");
    goOnTo("תשלומים");
    expect(screen.getByText(/לקוח זה מסומן לתשלום מראש/)).toBeInTheDocument();

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/בית הכנסת הגדול מסומן לתשלום מראש/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "חזרה לתשלום" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(orderRequests()).toHaveLength(0);

    fireEvent.click(createButton());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "יצירה בכל זאת" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    expect(sentOrder()).toMatchObject({ customer_id: "c2", payment_status: "unpaid" });
  });
});

describe("the draft", () => {
  it("is autosaved as the form changes, and dropped by the cancel link", async () => {
    await renderForm();
    tap("משכן משה");
    next();
    expect(drafts.store.get("order-create")).toMatchObject({ step: "items", customerId: "c1", lines: [] });

    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    // jsdom can't follow the link to /sales; only the click's own effect matters here.
    const stayHere = (event: Event) => event.preventDefault();
    document.addEventListener("click", stayHere);
    fireEvent.click(screen.getByRole("link", { name: "ביטול" }));
    document.removeEventListener("click", stayHere);
    expect(drafts.clearDraft).toHaveBeenCalledWith("order-create");
  });

  it("is restored on open, on the step it was left at", async () => {
    drafts.store.set("order-create", {
      step: "notes",
      customerId: "c1",
      branchId: "",
      orderDate: "2026-10-09",
      orderStatus: "draft",
      paymentTerms: "eom",
      dueDate: "2026-10-31",
      requestedDeliveryDate: "",
      orderDiscount: "0",
      orderDiscountMode: "amount",
      needsInvoice: true,
      collectOnDelivery: false,
      notes: "מהטיוטה",
      lineDiscountModes: {},
      lines: [{ product_id: "p1", product_name: "שקית חול", quantity_ordered: 3, unit_price: 120, discount_amount: 0, notes: "" }],
      newPayments: [],
    });
    await renderForm();
    expectStep("הערות להזמנה?");
    expect(screen.getByRole("textbox")).toHaveValue("מהטיוטה");
    expect(besides("סכום ביניים")).toEqual([shekels(360)]);
    next();
    expect(besides("תאריך הזמנה")).toEqual(["2026-10-09"]);
  });

  it("restored without its lines, it is refused at save", async () => {
    drafts.store.set("order-create", { step: "summary", customerId: "c1", lines: [], newPayments: [] });
    await renderForm();
    fireEvent.click(createButton());
    expect(await screen.findByText("יש להוסיף לפחות מוצר אחד.")).toBeInTheDocument();
    expect(orderRequests()).toHaveLength(0);
  });
});

describe("opened for a customer (?customer_id=)", () => {
  it("starts on the products step with that customer chosen", async () => {
    nav.params = new URLSearchParams("customer_id=c2");
    await renderForm();
    expectStep("אילו מוצרים?");
    tap("שקית חול");
    goOnTo("לאשר ולשמור?");
    expect(besides("שם")).toEqual(["ביתהכנסתהגדול"]);
  });
});

describe("inside a dialog (embedded)", () => {
  it("closes by its X, reports progress, and hands the new order to the dialog instead of navigating", async () => {
    const onCancel = vi.fn();
    const onSubmitted = vi.fn();
    const onDirtyChange = vi.fn();
    await renderForm({ embedded: true, draftKey: "order-quick", onCancel, onSubmitted, onDirtyChange });
    expect(screen.queryByRole("link", { name: "ביטול" })).not.toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    chooseCustomerAndSand();
    // Past its first step — closing the dialog now asks first.
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(drafts.store.get("order-quick")).toMatchObject({ step: "items" });

    // The X is a deliberate close: the draft goes with it.
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(onCancel).toHaveBeenCalled();
    expect(drafts.clearDraft).toHaveBeenCalledWith("order-quick");

    goOnTo("לאשר ולשמור?");
    fireEvent.click(createButton());
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith("o-new"));
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("editing an order (one open form)", () => {
  const initialOrder = {
    id: "o-7",
    customer_id: "c1",
    branch_id: null,
    order_date: "2026-10-01",
    status: "closed",
    payment_status: "partial",
    payment_terms: "immediate",
    due_date: "2026-10-01",
    requested_delivery_date: null,
    discount_amount: 0,
    needs_invoice: true,
    collect_payment_on_delivery: false,
    notes: "",
    items: [{ product_id: "p1", product_name: "שקית חול", quantity_ordered: 2, unit_price: 120, discount_amount: 0, notes: "" }],
  };
  const initialPayments = [
    { id: "pay-1", payment_date: "2026-10-01", amount_total: 100, payment_method: "cash", reference_number: "", notes: "ישן" },
  ];
  const saveButton = () => screen.getByText("שמירת שינויים").closest("button")!;

  it("shows every section at once, keeps an old status on offer, and sends only what changed in the saved payments", async () => {
    server.orderReply = { status: 200, body: { order_id: "o-7" } };
    await renderForm({ mode: "edit", initialOrder, initialPayments });
    // No steps: every question is on the page, Save is always there.
    expect(screen.queryByText(/^שלב \d+ מתוך/)).not.toBeInTheDocument();
    for (const section of ["איזה לקוח?", "אילו מוצרים?", "מה סטטוס ההזמנה?", "תשלומים", "הערות להזמנה?"]) {
      expectStep(section);
    }
    // An order already in an old status keeps it on offer, so an edit never changes it unasked.
    expect(screen.getByText("סגור").closest("button")).toHaveClass("bg-primary");

    fireEvent.change(screen.getByDisplayValue("ישן"), { target: { value: "  חדש  " } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    const order = sentOrder("/api/orders/update");
    expect(order).toMatchObject({
      order_id: "o-7",
      status: "closed",
      payment_terms: "immediate",
      existing_payment_notes: [{ id: "pay-1", notes: "חדש" }],
    });
    // Already paid 100 of 240.
    expect(order.payment_status).toBe("partial");
    const [, init] = orderRequests()[0];
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(undo.registerReversibleCreate).not.toHaveBeenCalled();
    // A draft is never kept for an edit.
    expect(drafts.saveDraft).not.toHaveBeenCalled();
  });

  it("saves an edit on the phone's copy when it has the order, and on the server when it doesn't", async () => {
    device.saves = { create: vi.fn(async () => "unused"), update: vi.fn(async () => true) };
    const { unmount } = await renderForm({ mode: "edit", initialOrder, initialPayments });
    fireEvent.click(saveButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    expect(device.saves.update).toHaveBeenCalledWith("o-7", expect.objectContaining({ order_id: "o-7", customer_id: "c1" }));
    expect(orderRequests()).toHaveLength(0);
    unmount();

    // The phone doesn't hold this order (yet): the server saves it.
    push.mockClear();
    device.saves.update.mockResolvedValue(false);
    server.orderReply = { status: 200, body: { order_id: "o-7" } };
    await renderForm({ mode: "edit", initialOrder, initialPayments });
    fireEvent.click(saveButton());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sales"));
    expect(sentOrder("/api/orders/update")).toMatchObject({ order_id: "o-7" });
  });

  it("shows a refused edit beside Save", async () => {
    server.orderReply = { status: 500, body: {} };
    await renderForm({ mode: "edit", initialOrder, initialPayments });
    fireEvent.click(saveButton());
    expect(await screen.findByText("עדכון ההזמנה נכשל.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
