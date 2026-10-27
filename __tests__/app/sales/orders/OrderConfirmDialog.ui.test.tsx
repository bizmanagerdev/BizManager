// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { OfflineUploadResult } from "@/lib/offline-upload";
import type { Account } from "@/lib/accounts";

// The "אישור אספקה" wizard (deliveries queue, dashboard, the order's page): what
// the driver sees step by step, and exactly what goes out when they confirm.
// Mocked only at the edges — the phone's copy (PowerSync), the server (fetch),
// the send queue (offlineUpload / offlineFetch), and Supabase behind the
// product search and the accounts list. The confirmed-deliveries store is the
// real one, so "leaves the lists at once" is read the way the lists read it.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: (report: (s: typeof sentry) => void) => report(sentry) }));

// The phone's copy: an open database (or none), the order as the server's own
// loader reads it over the copy, and the customer's saved arrival details.
// loadOrderEditData itself has its own tests (__tests__/lib/orders/).
const device = vi.hoisted(() => ({
  db: null as unknown,
  order: null as unknown,
  customer: null as Record<string, unknown> | null,
  /** The copy can't be read (a closed or broken database). */
  customerReadFails: false,
  /** Who is signed in on this device (LocalDataHost's viewer). */
  viewer: null as { id: string; role: string; locale: string; name: string | null } | null,
}));
vi.mock("@/lib/powersync/store", () => ({ readyLocalDatabase: () => device.db, useLocalViewer: () => device.viewer }));
vi.mock("@/lib/powersync/local-results", () => ({
  localClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (device.customerReadFails) throw new Error("database closed");
            return { data: device.customer, error: null };
          },
        }),
      }),
    }),
  }),
}));
const loadOrderEditData = vi.hoisted(() =>
  vi.fn(async (_client: unknown, _id: string, _options?: unknown) =>
    device.order ? { ok: true, data: device.order } : { ok: false, status: 404, error: "Order not found" }
  )
);
vi.mock("@/lib/orders/order-edit-data", () => ({ loadOrderEditData }));

// The save boundary: the confirmation goes through the upload queue (it can
// carry photos), the customer's arrival details through the JSON send queue.
type UploadInput = { fields?: Record<string, string>; files?: { fieldName: string; file: File }[]; label: string };
const saves = vi.hoisted(() => ({
  upload: vi.fn(
    async (_url: string, _input: UploadInput): Promise<OfflineUploadResult> => ({ queued: false, ok: true, data: {} })
  ),
  arrival: vi.fn(async (_url: string, _body?: unknown, _label?: string) => ({ ok: true, queued: false, data: {} })),
}));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: saves.upload }));
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  offlineFetch: saves.arrival,
}));

const search = vi.hoisted(() => ({
  products: vi.fn(async (_query: string, _limit?: number): Promise<Record<string, unknown>[]> => []),
}));
vi.mock("@/lib/orders/searchProducts", () => ({ searchProducts: search.products }));

const accounts = vi.hoisted(() => ({ list: [] as Account[], gate: null as Promise<void> | null }));
vi.mock("@/lib/accounts/accountsClient", () => ({
  fetchAccountsDirect: async () => {
    if (accounts.gate) await accounts.gate;
    return accounts.list;
  },
}));

// The microphone and /api/transcribe: a mic that "hears" the set phrase the
// moment it's tapped.
const dictation = vi.hoisted(() => ({ heard: "" }));
vi.mock("@/hooks/useAudioTranscription", () => ({
  useAudioTranscription: ({ onResult }: { onResult: (text: string) => void }) => ({
    supported: true,
    state: "idle",
    start: () => {},
    stop: () => {},
    toggle: () => onResult(dictation.heard),
  }),
}));

// Picked photos skip the canvas downscale (jsdom has no canvas).
vi.mock("@/lib/images", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/images")>()),
  compressImageFiles: async (files: File[]) => files,
}));

import OrderConfirmDialog, { MARK_DELIVERED_LABEL } from "@/app/(app)/sales/orders/OrderConfirmDialog";
import { invalidateAccountsCache } from "@/components/financial/AccountSelect";
import { useConfirmedDeliveries } from "@/lib/orders/confirmed-deliveries";
import { parseOrderComments } from "@/lib/orders/comments";
import { israelDateKey } from "@/lib/timezone";
import { refresh } from "@/__tests__/mocks/next-navigation";

// Each test walks a real Radix dialog through up to a dozen steps: ~2s on an
// idle machine, past the 5s default on a busy one or under coverage.
vi.setConfig({ testTimeout: 20_000 });

type Line = {
  product_id: string;
  product_name: string;
  quantity_ordered: number;
  quantity_delivered: number;
  available_quantity: number | null;
  unit_price: number;
  discount_amount: number;
  notes: string;
};

const EXISTING_NOTE = "משרד · 05.10.2026, 09:00\nלהשאיר ליד הדלת";

/** Two lines: 2 × 100 + 3 × 50 = ₪350, nothing delivered or paid yet. */
function makeOrder(
  overrides: {
    items?: Line[];
    payments?: { amount_total: number; payment_method?: string; payment_status?: string; due_date?: string }[];
    requested_delivery_date?: string | null;
    deliveryImages?: { id: string; file_name: string | null; uploaded_at: string | null; url: string | null }[];
  } = {}
) {
  return {
    initialOrder: {
      id: "o1",
      customer_id: "c1",
      order_date: "2026-10-05",
      status: "pending",
      payment_status: "unpaid",
      discount_amount: 0,
      notes: EXISTING_NOTE,
      requested_delivery_date: overrides.requested_delivery_date ?? null,
      items: overrides.items ?? [
        {
          product_id: "p1",
          product_name: "קמח 25 ק״ג",
          quantity_ordered: 2,
          quantity_delivered: 0,
          available_quantity: 10,
          unit_price: 100,
          discount_amount: 0,
          notes: "",
        },
        {
          product_id: "p2",
          product_name: "שמן 18 ליטר",
          quantity_ordered: 3,
          quantity_delivered: 0,
          available_quantity: null,
          unit_price: 50,
          discount_amount: 0,
          notes: "לאחסן בצל",
        },
      ],
    },
    initialPayments: (overrides.payments ?? []).map((payment, index) => ({
      id: `pay-${index}`,
      payment_date: "2026-10-05",
      payment_method: "cash",
      reference_number: "",
      notes: "",
      ...payment,
    })),
    deliveryImages: overrides.deliveryImages ?? [],
  };
}

// The server, as the dialog's fetches see it.
const net = {
  online: true,
  order: null as ReturnType<typeof makeOrder> | null,
  orderStatus: 200,
  orderError: undefined as string | undefined,
  orderUnreachable: false,
  arrival: null as { instructions: string | null; lat: number | null; lng: number | null } | null,
  arrivalUnreachable: false,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn(async (input: string, _init?: unknown) => {
  if (input.startsWith("/api/orders/o1/edit-data")) {
    if (net.orderUnreachable) throw new TypeError("Failed to fetch");
    return net.order ? json(net.order, net.orderStatus) : json({ error: net.orderError }, net.orderStatus);
  }
  if (input.startsWith("/api/customers/delivery-location")) {
    if (net.arrivalUnreachable) throw new TypeError("Failed to fetch");
    return net.arrival ? json(net.arrival) : json({}, 404);
  }
  return json({}, 404);
});

// The app's money format (lib/money.ts): ₪ first, he-IL grouping, decimals
// only when present — "₪350" (owner, 2026-10-11: the dashboard's way).
const money = (value: number) => `₪${value.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

beforeEach(() => {
  localStorage.clear();
  device.db = null;
  device.order = null;
  device.customer = null;
  device.customerReadFails = false;
  device.viewer = null;
  net.online = true;
  net.order = makeOrder();
  net.orderStatus = 200;
  net.orderError = undefined;
  net.orderUnreachable = false;
  net.arrival = null;
  net.arrivalUnreachable = false;
  accounts.list = [];
  accounts.gate = null;
  // AccountSelect keeps the list for the life of the module; each test sets its own.
  invalidateAccountsCache();
  saves.upload.mockReset();
  saves.upload.mockResolvedValue({ queued: false, ok: true, data: {} });
  saves.arrival.mockReset();
  search.products.mockReset();
  search.products.mockResolvedValue([]);
  loadOrderEditData.mockReset();
  sentry.captureMessage.mockClear();
  sentry.captureException.mockClear();
  refresh.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => net.online });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "onLine");
  Reflect.deleteProperty(window.navigator, "geolocation");
});

// ── Driving the wizard ────────────────────────────────────────────────────────

function openDialog(props: Partial<React.ComponentProps<typeof OrderConfirmDialog>> = {}) {
  render(
    <OrderConfirmDialog orderId="o1" customerName="פיצה אורי" authorName="דנה" buttonLabel="סמן כסופק" {...props} />
  );
  fireEvent.click(screen.getByRole("button", { name: "סמן כסופק" }));
}

async function openOnItems(props: Partial<React.ComponentProps<typeof OrderConfirmDialog>> = {}) {
  openDialog(props);
  await screen.findByRole("heading", { name: "מה נמסר בפועל?" });
}

async function next(heading: string) {
  fireEvent.click(screen.getByRole("button", { name: "הבא" }));
  return screen.findByRole("heading", { name: heading });
}

/** From "items" to the payment question, then "yes" — onto the amount keypad. */
async function startPayment() {
  await next("האם נגבה תשלום במסירה?");
  fireEvent.click(screen.getByRole("button", { name: "כן, נגבה תשלום" }));
  // The choice advances by itself, a beat later (the step list reshapes first).
  await screen.findByRole("heading", { name: "כמה נגבה במסירה?" });
}

/**
 * The "נמסר כעת" fields, one per line. Input never renders type=number (the
 * Samsung keyboard can't type into one in the Android app), so they're text
 * boxes with a decimal keypad — the only ones on the items step.
 */
function deliveredNowFields() {
  return screen
    .getAllByRole("textbox")
    .filter((field): field is HTMLInputElement => field.getAttribute("inputmode") === "decimal");
}

function press(...keys: string[]) {
  for (const key of keys) fireEvent.click(screen.getByRole("button", { name: key }));
}

/** What the amount keypad shows, beside its ₪. */
function amountShown() {
  // The sign beside the amount is the ₪ / $ / C$ menu (2026-10-24).
  return screen.getByRole("button", { name: /^מטבע:/ }).previousElementSibling?.textContent;
}

/** A date field shows dd/mm/yy; today's, as it appears before anything is typed. */
function todayShown() {
  const [year, month, day] = israelDateKey().split("-");
  return `${day}/${month}/${year.slice(2)}`;
}

/** Amount (keys pressed on the keypad) → date → method → reference → note. No accounts configured. */
async function payOnDelivery(keys: string[], method: string) {
  await startPayment();
  press(...keys);
  await next("מתי שולם?");
  await next("באיזה אמצעי תשלום?");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: method } });
  await next("אסמכתא");
  await next("הערת תשלום");
}

/** From the delivery-date step on to the summary, touching nothing. */
async function deliveryDateToReview() {
  await next("צירוף תמונות");
  await next("הערות למסירה");
  await next("איך מגיעים למקום?");
  await next("לאשר את האספקה?");
}

/** Items as they are, nothing collected, straight to the summary. */
async function straightToReview() {
  await next("האם נגבה תשלום במסירה?");
  await next("מתי סופק?");
  await deliveryDateToReview();
}

async function confirmDelivery() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "אישור אספקה" }));
  });
}

/** A summary row's value, by its label. */
function reviewValue(label: string) {
  return screen.getByText(label).nextElementSibling?.textContent ?? "";
}

function sentPayload() {
  expect(saves.upload).toHaveBeenCalledTimes(1);
  const [url, input] = saves.upload.mock.calls[0];
  expect(url).toBe("/api/orders/update");
  return JSON.parse(input.fields?.payload ?? "{}");
}

/** Whether the deliveries lists on this phone already leave the order out. */
function confirmedOnThisPhone(orderId: string) {
  const { result } = renderHook(() => useConfirmedDeliveries());
  return result.current.has(orderId);
}

// ── Opening ───────────────────────────────────────────────────────────────────

describe("opening", () => {
  it("opens on the items step with each line pre-filled to what is still owed", async () => {
    await openOnItems();

    expect(screen.getByRole("dialog", { name: "פיצה אורי" })).toBeInTheDocument();
    expect(screen.getByText("קמח 25 ק״ג")).toBeInTheDocument();
    expect(screen.getByText("שמן 18 ליטר")).toBeInTheDocument();
    expect(screen.getByText("הערות: לאחסן בצל")).toBeInTheDocument();
    // "Delivered everything" is the common case, so it's already filled in.
    expect(deliveredNowFields().map((field) => field.value)).toEqual(["2", "3"]);
    // Step 1 has nowhere to go back to.
    expect(screen.queryByRole("button", { name: "חזרה" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/o1/edit-data?scope=confirm", { cache: "no-store" });
  });

  it("names its button ✓ אישור אספקה when the caller gives none — the one name every list uses", () => {
    render(<OrderConfirmDialog orderId="o1" />);
    const trigger = screen.getByRole("button", { name: MARK_DELIVERED_LABEL });
    expect(MARK_DELIVERED_LABEL).toBe("אישור אספקה");
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the default title when no customer name is given", async () => {
    render(<OrderConfirmDialog orderId="o1" buttonLabel="סמן כסופק" />);
    fireEvent.click(screen.getByRole("button", { name: "סמן כסופק" }));
    expect(await screen.findByRole("dialog", { name: "אישור אספקת הזמנה" })).toBeInTheDocument();
  });

  it("shows a loading line, with confirming held back, until the order arrives", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
    openDialog();

    expect(await screen.findByText("טוען את פרטי ההזמנה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הבא" })).toBeDisabled();

    await act(async () => answer(json(makeOrder())));
    expect(await screen.findByRole("heading", { name: "מה נמסר בפועל?" })).toBeInTheDocument();
    expect(screen.queryByText("טוען את פרטי ההזמנה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הבא" })).toBeEnabled();
  });

  it("shows the server's own message when the order can't be loaded", async () => {
    net.order = null;
    net.orderStatus = 404;
    net.orderError = "ההזמנה לא נמצאה";
    openDialog();

    expect(await screen.findByText("ההזמנה לא נמצאה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הבא" })).toBeDisabled();
  });

  it("a server answer that isn't JSON (a proxy's error page) gets the generic message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    openDialog();
    expect(await screen.findByText("טעינת נתוני האישור נכשלה.")).toBeInTheDocument();
  });

  it("with no signal and no copy on the phone, says so — not that it will be sent later", async () => {
    net.online = false;
    net.orderUnreachable = true;
    openDialog();

    expect(
      await screen.findByText("אין חיבור, וההזמנה הזו לא שמורה בטלפון — אפשר לאשר אותה כשיחזור החיבור.")
    ).toBeInTheDocument();
  });

  it("from the phone's copy: opens with no signal at all, and asks the server for nothing", async () => {
    device.db = {};
    device.order = makeOrder();
    net.online = false;
    await openOnItems();

    expect(screen.getByText("קמח 25 ק״ג")).toBeInTheDocument();
    expect(loadOrderEditData).toHaveBeenCalledWith(expect.anything(), "o1", { confirm: true, deliveryImages: false });
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/edit-data"), expect.anything());
  });

  it("from the phone's copy, online: the photos already taken still come from the server", async () => {
    device.db = {};
    device.order = makeOrder();
    net.order = makeOrder({
      deliveryImages: [{ id: "img1", file_name: "door.jpg", uploaded_at: "2026-10-10T08:00:00Z", url: null }],
    });
    await openOnItems();

    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");
    expect(await screen.findByText("תמונות קיימות")).toBeInTheDocument();
    expect(screen.getByText("door.jpg")).toBeInTheDocument();
  });

  it.each([
    ["answers with an error", () => fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500))],
    ["can't be reached", () => fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))],
  ])("from the phone's copy: when the server %s, the photos are just missing — no error", async (_case, serverFails) => {
    device.db = {};
    device.order = makeOrder();
    serverFails();
    await openOnItems();

    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");
    expect(screen.queryByText("תמונות קיימות")).not.toBeInTheDocument();
    expect(screen.queryByText(/נכשל/)).not.toBeInTheDocument();
  });

  it("a photo already taken shows as a picture, linking to itself", async () => {
    net.order = makeOrder({
      deliveryImages: [
        { id: "img1", file_name: "door.jpg", uploaded_at: "2026-10-10T08:00:00Z", url: "/signed/door.jpg" },
        { id: "img2", file_name: null, uploaded_at: null, url: null },
      ],
    });
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");

    expect(screen.getByRole("img", { name: "door.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /door\.jpg/ })).toHaveAttribute("href", "/signed/door.jpg");
    // View and download on hover, as every file (owner, 2026-10-12).
    expect(screen.getByRole("link", { name: "צפייה" })).toHaveAttribute("href", "/signed/door.jpg");
    expect(screen.getByRole("link", { name: "הורדה" })).toHaveAttribute("download", "door.jpg");
    // No name, no link: still listed, under a generic name, with nothing to open.
    expect(screen.getByText("תמונה")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /תמונה/ })).toBeNull();
  });

  it("an order the copy doesn't hold is loaded from the server", async () => {
    device.db = {};
    device.order = null;
    await openOnItems();

    expect(loadOrderEditData).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/o1/edit-data?scope=confirm", { cache: "no-store" });
  });

  it("a copy that can't be read falls back to the server", async () => {
    device.db = {};
    device.order = makeOrder();
    loadOrderEditData.mockRejectedValueOnce(new Error("database closed"));
    await openOnItems();

    expect(screen.getByText("קמח 25 ק״ג")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/orders/o1/edit-data?scope=confirm", { cache: "no-store" });
  });

  it("closing on the first step just closes", async () => {
    await openOnItems();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closing past the first step asks before dropping what was entered", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));

    const ask = await screen.findByRole("dialog", { name: "יש שינויים שלא נשמרו" });
    fireEvent.click(within(ask).getByRole("button", { name: "סגור בלי לשמור" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(saves.upload).not.toHaveBeenCalled();
  });
});

// ── Quantities ────────────────────────────────────────────────────────────────

describe("quantities", () => {
  it("a partial delivery is flagged, summarised, and sent as partially delivered", async () => {
    await openOnItems();
    fireEvent.change(deliveredNowFields()[0], { target: { value: "1" } });

    expect(screen.getByText(/^אספקה חלקית — ההזמנה תישאר פתוחה/)).toBeInTheDocument();

    await straightToReview();
    expect(reviewValue("סטטוס אחרי שמירה")).toBe("סופק חלקית");
    expect(reviewValue("נמסר מתוך ההזמנה")).toBe("4 / 5");

    await confirmDelivery();
    const payload = sentPayload();
    expect(payload.status).toBe("partially_delivered");
    expect(payload.items.map((item: { quantity_delivered: number }) => item.quantity_delivered)).toEqual([1, 3]);
    // Still owed something, so it stays on the deliveries lists.
    expect(confirmedOnThisPhone("o1")).toBe(false);
  });

  it("won't move on with nothing marked as delivered", async () => {
    await openOnItems();
    const [first, second] = deliveredNowFields();
    fireEvent.change(first, { target: { value: "0" } });
    fireEvent.change(second, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));

    expect(screen.getByText("יש לסמן כמות שנמסרה בפריט אחד לפחות.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "מה נמסר בפועל?" })).toBeInTheDocument();
  });

  it("caps a line at what is still owed, and a negative entry at zero", async () => {
    await openOnItems();
    const [first, second] = deliveredNowFields();
    fireEvent.change(first, { target: { value: "9" } });
    fireEvent.change(second, { target: { value: "-4" } });

    expect(first.value).toBe("2");
    expect(second.value).toBe("0");

    // Anything that isn't a number counts as none.
    fireEvent.change(first, { target: { value: "abc" } });
    expect(first.value).toBe("0");
  });

  it("an order with no lines can't be confirmed", async () => {
    net.order = makeOrder({ items: [] });
    await openOnItems();

    expect(screen.getByText("אין פריטים בהזמנה זו.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    expect(screen.getByText("לא ניתן לאשר הזמנה ללא פריטים.")).toBeInTheDocument();
  });

  it("counts an earlier partial delivery: shows it, owes only the rest, sends the running total", async () => {
    net.order = makeOrder({
      items: [
        {
          product_id: "p1",
          product_name: "קמח 25 ק״ג",
          quantity_ordered: 5,
          quantity_delivered: 2,
          available_quantity: null,
          unit_price: 100,
          discount_amount: 0,
          notes: "",
        },
      ],
    });
    await openOnItems();

    expect(screen.getByText(/נמסר עד כה: 2/)).toBeInTheDocument();
    expect(deliveredNowFields()[0].value).toBe("3");

    await straightToReview();
    await confirmDelivery();
    expect(sentPayload().items[0]).toMatchObject({ product_id: "p1", quantity_ordered: 5, quantity_delivered: 5 });
  });

  it("an order already fully delivered can still be run through — for photos and notes", async () => {
    net.order = makeOrder({
      items: [
        {
          product_id: "p1",
          product_name: "קמח 25 ק״ג",
          quantity_ordered: 2,
          quantity_delivered: 2,
          available_quantity: null,
          unit_price: 100,
          discount_amount: 0,
          notes: "",
        },
      ],
    });
    await openOnItems();

    // Nothing left to mark, so the field is locked and no quantity is demanded.
    expect(deliveredNowFields()[0]).toBeDisabled();
    await straightToReview();
    expect(reviewValue("סטטוס אחרי שמירה")).toBe("סופק");

    await confirmDelivery();
    expect(sentPayload()).toMatchObject({ status: "delivered", items: [{ quantity_delivered: 2 }] });
  });

  describe("delivering more than is in stock", () => {
    beforeEach(() => {
      net.order = makeOrder({
        items: [
          {
            product_id: "p1",
            product_name: "קמח 25 ק״ג",
            quantity_ordered: 2,
            quantity_delivered: 0,
            available_quantity: 1,
            unit_price: 100,
            discount_amount: 0,
            notes: "",
          },
        ],
      });
    });

    it("is flagged on the line and in the summary, and asks once more before saving", async () => {
      await openOnItems();
      expect(screen.getByText("חוסר במלאי — במלאי 1, נמסר כעת 2")).toBeInTheDocument();

      await straightToReview();
      expect(reviewValue("מלאי")).toBe("חוסר במלאי");

      await confirmDelivery();
      const ask = screen.getByRole("dialog", { name: "חוסר במלאי" });
      expect(saves.upload).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(within(ask).getByRole("button", { name: "סגירה בכל זאת" }));
      });
      expect(sentPayload().items[0].quantity_delivered).toBe(2);
    });

    it("'check again' saves nothing", async () => {
      await openOnItems();
      await straightToReview();
      await confirmDelivery();

      fireEvent.click(within(screen.getByRole("dialog", { name: "חוסר במלאי" })).getByRole("button", { name: "לבדוק שוב" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "חוסר במלאי" })).not.toBeInTheDocument());
      expect(saves.upload).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { name: "לאשר את האספקה?" })).toBeInTheDocument();
    });
  });

  describe("adding a product the customer took as well", () => {
    it("finds it by search and adds it as one ordered, one delivered", async () => {
      search.products.mockResolvedValue([
        { id: "p9", name: "סוכר 1 ק״ג", sku: "SUG-1", base_price: 8, available_quantity: 40 },
      ]);
      await openOnItems();
      fireEvent.change(screen.getByPlaceholderText("חיפוש מוצר לפי שם, מק״ט או ברקוד..."), {
        target: { value: "סוכר" },
      });
      expect(screen.getByText("מחפש...")).toBeInTheDocument();

      fireEvent.click(await screen.findByRole("button", { name: /סוכר 1 ק״ג/ }));
      expect(search.products).toHaveBeenCalledWith("סוכר", 20);
      expect(deliveredNowFields().map((field) => field.value)).toEqual([
        "2",
        "3",
        "1",
      ]);
      // The search box is cleared for the next one.
      expect(screen.getByPlaceholderText("חיפוש מוצר לפי שם, מק״ט או ברקוד...")).toHaveValue("");

      await straightToReview();
      await confirmDelivery();
      expect(sentPayload().items[2]).toEqual({
        product_id: "p9",
        quantity_ordered: 1,
        quantity_delivered: 1,
        unit_price: 8,
        discount_amount: 0,
        notes: "",
      });
    });

    it("a product already on the order gets one more ordered and delivered", async () => {
      search.products.mockResolvedValue([
        { id: "p1", name: "קמח 25 ק״ג", sku: null, base_price: 100, available_quantity: 10 },
      ]);
      await openOnItems();
      fireEvent.change(screen.getByPlaceholderText("חיפוש מוצר לפי שם, מק״ט או ברקוד..."), {
        target: { value: "קמח" },
      });
      // The result row (not the order line's own label).
      const result = await screen.findByRole("button", { name: /קמח 25 ק״ג/ });
      fireEvent.click(result);

      expect(screen.getByText("קמח 25 ק״ג").nextElementSibling).toHaveTextContent(/^הוזמן: 3 · נותר: 3$/);
      expect(deliveredNowFields()[0].value).toBe("3");
    });

    it("says so when nothing matches", async () => {
      await openOnItems();
      fireEvent.change(screen.getByPlaceholderText("חיפוש מוצר לפי שם, מק״ט או ברקוד..."), {
        target: { value: "אין כזה" },
      });
      expect(await screen.findByText("לא נמצאו מוצרים.")).toBeInTheDocument();
    });

    it("a failed search reads as no results, not an error", async () => {
      search.products.mockRejectedValue(new Error("network"));
      await openOnItems();
      fireEvent.change(screen.getByPlaceholderText("חיפוש מוצר לפי שם, מק״ט או ברקוד..."), {
        target: { value: "סוכר" },
      });
      expect(await screen.findByText("לא נמצאו מוצרים.")).toBeInTheDocument();
    });
  });
});

// ── Payment taken on delivery ─────────────────────────────────────────────────

describe("payment", () => {
  it("none: no payment steps, nothing sent as paid", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    fireEvent.click(screen.getByRole("button", { name: "לא נגבה תשלום" }));
    await screen.findByRole("heading", { name: "מתי סופק?" });
    await deliveryDateToReview();

    expect(reviewValue("סטטוס תשלום")).toBe("לא שולם");
    expect(reviewValue("יתרה")).toBe(money(350));

    await confirmDelivery();
    expect(sentPayload()).toMatchObject({ payment_status: "unpaid", payments: [], refunds: [] });
  });

  it("full, in cash: the summary says paid, and one payment for the whole amount is sent", async () => {
    await openOnItems();
    await startPayment();
    expect(screen.getByText(/יתרה לתשלום/)).toHaveTextContent(money(350).replace(/\s/g, " "));
    press("הכל");
    await next("מתי שולם?");
    await next("באיזה אמצעי תשלום?");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
    await next("אסמכתא");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " 4417 " } });
    await next("הערת תשלום");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " נמסר לנהג " } });
    await next("מתי סופק?");
    await deliveryDateToReview();

    expect(reviewValue("סטטוס תשלום")).toBe("שולם");
    expect(reviewValue("שולם נטו")).toBe(money(350));
    expect(reviewValue("יתרה")).toBe(money(0));

    await confirmDelivery();
    const payload = sentPayload();
    expect(payload.payment_status).toBe("paid");
    expect(payload.payments).toEqual([
      {
        amount_total: 350,
        payment_date: israelDateKey(),
        payment_method: "cash",
        account_id: null,
        reference_number: "4417",
        notes: "נמסר לנהג",
        // Its currency goes with it (2026-10-24): shekels unless the sign was changed.
        currency: "ILS",
      },
    ]);
  });

  it("partial, by bank transfer: the summary says partly paid with the balance left", async () => {
    await openOnItems();
    await payOnDelivery(["חצי"], "bank_transfer");
    await next("מתי סופק?");
    await deliveryDateToReview();

    expect(reviewValue("סטטוס תשלום")).toBe("שולם חלקית");
    expect(reviewValue("שולם נטו")).toBe(money(175));
    expect(reviewValue("יתרה")).toBe(money(175));

    await confirmDelivery();
    const payload = sentPayload();
    expect(payload.payment_status).toBe("partial");
    expect(payload.payments).toMatchObject([{ amount_total: 175, payment_method: "bank_transfer" }]);
  });

  it("a check stays pending: the summary never shows it as paid, though the check itself is sent", async () => {
    await openOnItems();
    await payOnDelivery(["הכל"], "check");
    await next("מתי סופק?");
    await deliveryDateToReview();

    // It isn't money in until it clears (lib/payments starts a check as pending).
    expect(reviewValue("סטטוס תשלום")).toBe("לא שולם");
    expect(reviewValue("שולם נטו")).toBe(money(0));
    expect(reviewValue("יתרה")).toBe(money(350));

    await confirmDelivery();
    const payload = sentPayload();
    expect(payload.payment_status).toBe("unpaid");
    expect(payload.payments).toMatchObject([{ amount_total: 350, payment_method: "check" }]);
    expect(payload.refunds).toEqual([]);
  });

  it("an earlier payment is taken off what is left to collect", async () => {
    net.order = makeOrder({ payments: [{ amount_total: 100 }] });
    await openOnItems();
    await startPayment();

    expect(screen.getByText(/יתרה לתשלום/)).toHaveTextContent(money(250).replace(/\s/g, " "));
    press("הכל");
    expect(amountShown()).toBe("250");
  });

  // The server counts only money received (splitPaymentAmounts) — a check not
  // yet cleared or a bounced payment isn't, so the whole 350 is still to collect.
  it("an earlier check not yet cleared, or a bounced payment, is not money received", async () => {
    net.order = makeOrder({
      payments: [
        { amount_total: 100, payment_method: "check", payment_status: "pending", due_date: "2026-11-01" },
        { amount_total: 50, payment_status: "rejected" },
      ],
    });
    await openOnItems();
    await startPayment();

    expect(screen.getByText(/יתרה לתשלום/)).toHaveTextContent(money(350).replace(/\s/g, " "));
    press("הכל");
    expect(amountShown()).toBe("350");
  });

  it("the keypad types an amount, one decimal point at most, and erases", async () => {
    await openOnItems();
    await startPayment();
    expect(amountShown()).toBe("0");
    press("0", "1", "2", ".", ".", "5");
    expect(amountShown()).toBe("12.5");
    press("מחיקה");
    expect(amountShown()).toBe("12.");
    press("לא שולם");
    expect(amountShown()).toBe("0");
  });

  it("a decimal point on an empty amount starts from zero", async () => {
    await openOnItems();
    await startPayment();
    press(".", "5");
    expect(amountShown()).toBe("0.5");
  });

  it("'yes' with no amount won't move on", async () => {
    await openOnItems();
    await startPayment();
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    expect(screen.getByText("יש להזין סכום תשלום.")).toBeInTheDocument();
  });

  it("a cleared payment date won't move on", async () => {
    await openOnItems();
    await startPayment();
    press("5", "0");
    await next("מתי שולם?");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    expect(screen.getByText("יש לבחור תאריך תשלום.")).toBeInTheDocument();
  });

  it("no payment method chosen won't move on", async () => {
    await openOnItems();
    await startPayment();
    press("5", "0");
    await next("מתי שולם?");
    await next("באיזה אמצעי תשלום?");
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    expect(screen.getByText("יש לבחור אמצעי תשלום.")).toBeInTheDocument();
  });

  it("going back to the question and answering 'no' drops the amount typed", async () => {
    await openOnItems();
    await startPayment();
    press("5", "0");
    fireEvent.click(screen.getByRole("button", { name: "חזרה" }));
    await screen.findByRole("heading", { name: "האם נגבה תשלום במסירה?" });
    fireEvent.click(screen.getByRole("button", { name: "לא נגבה תשלום" }));
    await screen.findByRole("heading", { name: "מתי סופק?" });
    await deliveryDateToReview();

    await confirmDelivery();
    expect(sentPayload().payments).toEqual([]);
  });

  describe("a card in installments", () => {
    it("is sent as that many payments, a month apart", async () => {
      await openOnItems();
      await startPayment();
      press("3", "0", "0");
      await next("מתי שולם?");
      // A fixed date, so the months are known.
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "15/10/26" } });
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "credit_card" } });
      fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "3" } });
      await next("אסמכתא");
      await next("הערת תשלום");
      await next("מתי סופק?");
      await deliveryDateToReview();

      await confirmDelivery();
      expect(sentPayload().payments).toEqual([
        expect.objectContaining({ amount_total: 100, payment_date: "2026-10-15", due_date: "2026-11-10", notes: "תשלום 1/3" }),
        expect.objectContaining({ amount_total: 100, payment_date: "2026-11-15", due_date: "2026-12-10", notes: "תשלום 2/3" }),
        expect.objectContaining({ amount_total: 100, payment_date: "2026-12-15", due_date: "2027-01-10", notes: "תשלום 3/3" }),
      ]);
    });

    it("opening the dialog again starts the card back at one payment", async () => {
      await openOnItems();
      await startPayment();
      press("3", "0", "0");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "credit_card" } });
      fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "3" } });

      // Closed without saving, then opened again for the same order.
      fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
      const ask = await screen.findByRole("dialog", { name: "יש שינויים שלא נשמרו" });
      fireEvent.click(within(ask).getByRole("button", { name: "סגור בלי לשמור" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "סמן כסופק" }));
      await screen.findByRole("heading", { name: "מה נמסר בפועל?" });

      await startPayment();
      press("3", "0", "0");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "credit_card" } });
      expect(screen.getByLabelText("מספר תשלומים")).toHaveValue("1");
    });

    it("an impossible number of installments won't move on", async () => {
      await openOnItems();
      await startPayment();
      press("3", "0", "0");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "credit_card" } });
      fireEvent.change(screen.getByLabelText("מספר תשלומים"), { target: { value: "40" } });
      fireEvent.click(screen.getByRole("button", { name: "הבא" }));

      // Once under the field, once in the wizard's footer.
      expect(screen.getAllByText("מספר התשלומים צריך להיות בין 1 ל-36.")).toHaveLength(2);
      expect(screen.getByRole("heading", { name: "באיזה אמצעי תשלום?" })).toBeInTheDocument();
    });
  });

  describe("with accounts set up", () => {
    beforeEach(() => {
      const base = { openingBalance: 0, openingDate: "2026-01-01", isActive: true, sortOrder: 0, notes: null };
      accounts.list = [
        { ...base, id: "acc-cash", name: "קופה", kind: "cash" },
        { ...base, id: "acc-bank", name: "בנק הפועלים", kind: "bank" },
      ];
    });

    it("asks which account, pre-picks the one that fits the method, and sends it", async () => {
      await openOnItems();
      await startPayment();
      press("הכל");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
      await next("לאיזה חשבון נכנס התשלום?");
      // The step's picker comes first; the dialog keeps a hidden one that
      // loads the list early, showing the same choice.
      expect(screen.getAllByRole("button", { name: "חשבון" })[0]).toHaveTextContent("קופה");
      await next("אסמכתא");
      await next("הערת תשלום");
      await next("מתי סופק?");
      await deliveryDateToReview();

      await confirmDelivery();
      expect(sentPayload().payments).toMatchObject([{ amount_total: 350, account_id: "acc-cash" }]);
    });

    it("a method no account fits leaves the choice to the driver — and insists on one", async () => {
      await openOnItems();
      await startPayment();
      press("הכל");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
      await next("לאיזה חשבון נכנס התשלום?");
      fireEvent.click(screen.getByRole("button", { name: "הבא" }));
      expect(screen.getByText("יש לבחור חשבון לתשלום.")).toBeInTheDocument();
    });

    it("a refund asks which account it leaves from, pre-picked the same way", async () => {
      await openOnItems();
      await startPayment();
      press("4", "0", "0");
      await next("מתי שולם?");
      await next("באיזה אמצעי תשלום?");
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
      await next("לאיזה חשבון נכנס התשלום?");
      await next("אסמכתא");
      await next("הערת תשלום");
      await next("רישום החזר ללקוח");

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "other" } });
      fireEvent.click(screen.getByRole("button", { name: "הבא" }));
      expect(screen.getByText("יש לבחור חשבון להחזר.")).toBeInTheDocument();

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
      await next("מתי סופק?");
      await deliveryDateToReview();
      await confirmDelivery();
      expect(sentPayload().refunds).toMatchObject([{ amount_total: 50, payment_method: "cash", account_id: "acc-cash" }]);
    });

    it("accounts that arrive after the payment steps were passed still demand one before saving", async () => {
      let release: () => void = () => {};
      accounts.gate = new Promise<void>((resolve) => (release = resolve));
      await openOnItems();
      // No accounts known yet, so the flow has no account step.
      await payOnDelivery(["הכל"], "cash");
      await next("מתי סופק?");
      await deliveryDateToReview();

      await act(async () => release());
      await confirmDelivery();
      expect(screen.getByText("יש לבחור חשבון לתשלום.")).toBeInTheDocument();
      expect(saves.upload).not.toHaveBeenCalled();
    });
  });

  describe("collecting more than the order", () => {
    async function overpayInCash() {
      await openOnItems();
      await payOnDelivery(["4", "0", "0"], "cash");
      await next("רישום החזר ללקוח");
    }

    it("adds a refund step for the difference, which needs a method", async () => {
      await overpayInCash();
      expect(screen.getByText(/סכום החזר/)).toHaveTextContent(money(50).replace(/\s/g, " "));

      fireEvent.click(screen.getByRole("button", { name: "הבא" }));
      expect(screen.getByText("יש לבחור אמצעי החזר.")).toBeInTheDocument();

      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
      fireEvent.change(screen.getByPlaceholderText("אופציונלי"), { target: { value: "R-9" } });
      fireEvent.change(screen.getByPlaceholderText("למשל: הוחזר עקב שינוי בכמויות"), {
        target: { value: "עודף" },
      });
      await next("מתי סופק?");
      await deliveryDateToReview();
      expect(reviewValue("סטטוס תשלום")).toBe("שולם");
      expect(reviewValue("שולם נטו")).toBe(money(350));

      await confirmDelivery();
      const payload = sentPayload();
      expect(payload.payments).toMatchObject([{ amount_total: 400 }]);
      expect(payload.refunds).toEqual([
        {
          amount_total: 50,
          payment_date: israelDateKey(),
          payment_method: "cash",
          account_id: null,
          reference_number: "R-9",
          notes: "עודף",
        },
      ]);
    });

    it("a refund date is required while it's being recorded", async () => {
      await overpayInCash();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "cash" } });
      fireEvent.change(screen.getByDisplayValue(todayShown()), { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: "הבא" }));
      expect(screen.getByText("יש לבחור תאריך החזר.")).toBeInTheDocument();
    });

    it("unticked, the refund isn't recorded now", async () => {
      await overpayInCash();
      fireEvent.click(screen.getByRole("checkbox", { name: "לרשום החזר עכשיו" }));
      expect(screen.getByText("ההחזר לא יירשם במערכת עד שתסמן ותמלא פרטי החזר.")).toBeInTheDocument();
      await next("מתי סופק?");
      await deliveryDateToReview();

      await confirmDelivery();
      expect(sentPayload().refunds).toEqual([]);
    });
  });
});

// ── Delivery details ──────────────────────────────────────────────────────────

describe("delivery details", () => {
  it("warns when the delivery date isn't the one the customer asked for, and sends the date chosen", async () => {
    net.order = makeOrder({ requested_delivery_date: "2020-01-15" });
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");

    expect(screen.getByText(/זה לא התאריך למשלוח שהלקוח ביקש/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "15/01/20" } });
    expect(screen.queryByText(/זה לא התאריך למשלוח שהלקוח ביקש/)).not.toBeInTheDocument();

    await deliveryDateToReview();
    await confirmDelivery();
    expect(sentPayload().delivery_date).toBe("2020-01-15");
  });

  // Confirmed on the day itself with no hour typed: the moment the button was
  // pressed is what's stored (owner, 2026-10-15: "when the delivery was delivered").
  function expectPressedJustNow(sent: unknown) {
    expect(typeof sent).toBe("string");
    const at = new Date(sent as string).getTime();
    expect(Math.abs(Date.now() - at)).toBeLessThan(60_000);
    expect(israelDateKey(new Date(at))).toBe(israelDateKey());
  }

  it("today's delivery is sent as the moment of confirming when nothing is changed", async () => {
    await openOnItems();
    await straightToReview();
    await confirmDelivery();
    expectPressedJustNow(sentPayload().delivery_date);
  });

  it("an earlier day with an hour typed in is sent as that moment on Israel's clock", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "15/01/20" } });
    fireEvent.change(screen.getByLabelText("שעה"), { target: { value: "09:30" } });
    await deliveryDateToReview();
    await confirmDelivery();
    // January: Israel is UTC+2.
    expect(sentPayload().delivery_date).toBe("2020-01-15T07:30:00.000Z");
  });

  it("a cleared delivery date isn't demanded — today's is sent", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    await deliveryDateToReview();
    await confirmDelivery();
    expectPressedJustNow(sentPayload().delivery_date);
  });

  describe("photos", () => {
    // The picker previews each chosen photo through an object URL, which jsdom lacks.
    const { createObjectURL, revokeObjectURL } = URL;
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => "blob:photo");
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    });

    async function pick(file: File) {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("no file input");
      await act(async () => {
        fireEvent.change(input, { target: { files: [file] } });
      });
    }

    it("a photo goes out with the confirmation, and the summary counts it", async () => {
      const photo = new File(["x"], "door.jpg", { type: "image/jpeg" });
      await openOnItems();
      await next("האם נגבה תשלום במסירה?");
      await next("מתי סופק?");
      await next("צירוף תמונות");
      await pick(photo);
      await next("הערות למסירה");
      await next("איך מגיעים למקום?");
      await next("לאשר את האספקה?");
      expect(reviewValue("תמונות חדשות")).toBe("1");

      await confirmDelivery();
      const [, input] = saves.upload.mock.calls[0];
      expect(input.files).toEqual([{ fieldName: "delivery_images", file: photo }]);
      expect(input.label).toBe("אישור האספקה");
    });

    it("a file that isn't a picture won't move on", async () => {
      await openOnItems();
      await next("האם נגבה תשלום במסירה?");
      await next("מתי סופק?");
      await next("צירוף תמונות");
      await pick(new File(["%PDF"], "invoice.pdf", { type: "application/pdf" }));
      fireEvent.click(screen.getByRole("button", { name: "הבא" }));
      expect(screen.getByText("ניתן לצרף רק קובץ תמונה.")).toBeInTheDocument();
    });
  });

  it("a delivery note is added to the order's thread under the driver's name — the thread is kept", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");
    await next("הערות למסירה");
    fireEvent.change(screen.getByPlaceholderText("הערות למסירה, חוסרים, מצב אספקה..."), {
      target: { value: "  חסר קרטון אחד  " },
    });
    await next("איך מגיעים למקום?");
    await next("לאשר את האספקה?");

    await confirmDelivery();
    const comments = parseOrderComments(sentPayload().notes);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({ author_name: "משרד", body: "להשאיר ליד הדלת" });
    expect(comments[1]).toMatchObject({ author_name: "דנה", body: "חסר קרטון אחד" });
  });

  // Six of the eight places that open the dialog pass no name; the note then
  // takes the person signed in on this device, never a bare "משתמש".
  it("with no name from the page, the note is signed by whoever is signed in", async () => {
    device.viewer = { id: "u1", role: "worker", locale: "he", name: "יוסי הנהג" };
    openDialog({ authorName: undefined });
    await screen.findByRole("heading", { name: "מה נמסר בפועל?" });
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");
    await next("הערות למסירה");
    fireEvent.change(screen.getByPlaceholderText("הערות למסירה, חוסרים, מצב אספקה..."), {
      target: { value: "איסוף עצמי" },
    });
    await next("איך מגיעים למקום?");
    await next("לאשר את האספקה?");

    await confirmDelivery();
    const comments = parseOrderComments(sentPayload().notes);
    expect(comments[comments.length - 1]).toMatchObject({ author_name: "יוסי הנהג", body: "איסוף עצמי" });
  });

  it("a dictated note carries on from what was typed", async () => {
    await openOnItems();
    await next("האם נגבה תשלום במסירה?");
    await next("מתי סופק?");
    await next("צירוף תמונות");
    await next("הערות למסירה");
    const note = screen.getByPlaceholderText("הערות למסירה, חוסרים, מצב אספקה...");
    fireEvent.change(note, { target: { value: "חסר קרטון" } });
    dictation.heard = "אחד";
    fireEvent.click(screen.getByRole("button", { name: "הכתבה קולית" }));
    expect(note).toHaveValue("חסר קרטון אחד");
  });

  it("with no note, the order's thread goes back untouched", async () => {
    await openOnItems();
    await straightToReview();
    await confirmDelivery();
    expect(sentPayload().notes).toBe(EXISTING_NOTE);
  });

  describe("arrival details (saved on the customer)", () => {
    async function toArrival() {
      await openOnItems();
      await next("האם נגבה תשלום במסירה?");
      await next("מתי סופק?");
      await next("צירוף תמונות");
      await next("הערות למסירה");
      await next("איך מגיעים למקום?");
    }

    it("start from what the phone's copy holds; untouched, nothing is written", async () => {
      device.db = {};
      device.order = makeOrder();
      device.customer = { delivery_instructions: "שער כחול", delivery_lat: 32.08, delivery_lng: 34.78 };
      await toArrival();

      expect(screen.getByDisplayValue("שער כחול")).toBeInTheDocument();
      expect(screen.getByText("נקודה נשמרה: 32.08000, 34.78000")).toBeInTheDocument();
      await next("לאשר את האספקה?");
      expect(reviewValue("פרטי הגעה")).toBe("ללא שינוי");

      await confirmDelivery();
      expect(saves.arrival).not.toHaveBeenCalled();
    });

    it("changed, they go to the customer through the send queue — beside the confirmation", async () => {
      net.arrival = { instructions: "שער כחול", lat: null, lng: null };
      await toArrival();
      const directions = await screen.findByDisplayValue("שער כחול");
      fireEvent.change(directions, { target: { value: "שער כחול, קומה 2 " } });
      await next("לאשר את האספקה?");
      expect(reviewValue("פרטי הגעה")).toBe("יישמרו ללקוח");

      await confirmDelivery();
      expect(saves.arrival).toHaveBeenCalledWith(
        "/api/customers/delivery-location",
        { customer_id: "c1", instructions: "שער כחול, קומה 2", lat: null, lng: null },
        "עדכון פרטי ההגעה"
      );
      expect(saves.upload).toHaveBeenCalledTimes(1);
    });

    it("a copy that can't be read: the server's saved details are used instead", async () => {
      device.db = {};
      device.order = makeOrder();
      device.customerReadFails = true;
      net.arrival = { instructions: null, lat: 32.08, lng: 34.78 };
      await toArrival();

      expect(await screen.findByText("נקודה נשמרה: 32.08000, 34.78000")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith("/api/customers/delivery-location?customer_id=c1", { cache: "no-store" });
    });

    it("saved details out of reach: the driver starts empty and can still write them — by voice too", async () => {
      net.arrivalUnreachable = true;
      await toArrival();
      const directions = screen.getByPlaceholderText("לדוגמה: לעקוף את הבניין מימין, שער כחול בחניון");
      expect(directions).toHaveValue("");
      expect(screen.getByText("לא נשמרה נקודה")).toBeInTheDocument();

      dictation.heard = "שער כחול בחניון";
      fireEvent.click(screen.getByRole("button", { name: "הכתבה קולית" }));
      expect(directions).toHaveValue("שער כחול בחניון");
      await next("לאשר את האספקה?");
      expect(reviewValue("פרטי הגעה")).toBe("יישמרו ללקוח");
    });

    it("a failure saving them never holds up the confirmation", async () => {
      saves.arrival.mockRejectedValueOnce(new Error("queue full"));
      await toArrival();
      fireEvent.change(screen.getByPlaceholderText("לדוגמה: לעקוף את הבניין מימין, שער כחול בחניון"), {
        target: { value: "שער כחול" },
      });
      await next("לאשר את האספקה?");
      await confirmDelivery();

      expect(saves.arrival).toHaveBeenCalled();
      expect(saves.upload).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("while the phone is locating, the button says so and can't be pressed again", async () => {
      const getCurrentPosition = vi.fn();
      Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
      await toArrival();
      fireEvent.click(screen.getByRole("button", { name: "שמירת המיקום שאני נמצא בו" }));

      expect(screen.getByRole("button", { name: "מאתר..." })).toBeDisabled();
      expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it("'save where I am' stores the phone's position", async () => {
      Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (ok: (position: { coords: { latitude: number; longitude: number } }) => void) =>
            ok({ coords: { latitude: 31.7683, longitude: 35.2137 } }),
        },
      });
      await toArrival();
      expect(screen.getByText("לא נשמרה נקודה")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "שמירת המיקום שאני נמצא בו" }));
      expect(screen.getByText("נקודה נשמרה: 31.76830, 35.21370")).toBeInTheDocument();

      await next("לאשר את האספקה?");
      await confirmDelivery();
      expect(saves.arrival).toHaveBeenCalledWith(
        "/api/customers/delivery-location",
        { customer_id: "c1", instructions: null, lat: 31.7683, lng: 35.2137 },
        "עדכון פרטי ההגעה"
      );
    });

    it("a blocked location names the permission, not a failure", async () => {
      Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_ok: unknown, fail: (error: { code: number; PERMISSION_DENIED: number }) => void) =>
            fail({ code: 1, PERMISSION_DENIED: 1 }),
        },
      });
      await toArrival();
      fireEvent.click(screen.getByRole("button", { name: "שמירת המיקום שאני נמצא בו" }));
      expect(screen.getByText("הגישה למיקום נחסמה. אפשרו מיקום לאתר בהגדרות הדפדפן.")).toBeInTheDocument();
    });

    it("any other location failure says it couldn't be found", async () => {
      Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition: (_ok: unknown, fail: (error: { code: number; PERMISSION_DENIED: number }) => void) =>
            fail({ code: 3, PERMISSION_DENIED: 1 }),
        },
      });
      await toArrival();
      fireEvent.click(screen.getByRole("button", { name: "שמירת המיקום שאני נמצא בו" }));
      expect(screen.getByText("לא הצלחנו לקבוע את המיקום.")).toBeInTheDocument();
    });

    it("a device without location says so", async () => {
      Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: undefined });
      await toArrival();
      fireEvent.click(screen.getByRole("button", { name: "שמירת המיקום שאני נמצא בו" }));
      expect(screen.getByText("המכשיר הזה לא תומך באיתור מיקום.")).toBeInTheDocument();
    });
  });
});

// ── Saving ────────────────────────────────────────────────────────────────────

describe("confirming", () => {
  it("sends the whole order as it now stands, closes, refreshes, and takes it off this phone's lists", async () => {
    await openOnItems();
    await straightToReview();
    expect(reviewValue("סטטוס אחרי שמירה")).toBe("סופק");
    expect(confirmedOnThisPhone("o1")).toBe(false);

    await confirmDelivery();
    expect(sentPayload()).toEqual({
      order_id: "o1",
      customer_id: "c1",
      order_date: "2026-10-05",
      status: "delivered",
      payment_status: "unpaid",
      delivery_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      discount_amount: 0,
      notes: EXISTING_NOTE,
      items: [
        { product_id: "p1", quantity_ordered: 2, quantity_delivered: 2, unit_price: 100, discount_amount: 0, notes: "" },
        {
          product_id: "p2",
          quantity_ordered: 3,
          quantity_delivered: 3,
          unit_price: 50,
          discount_amount: 0,
          notes: "לאחסן בצל",
        },
      ],
      payments: [],
      refunds: [],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    expect(confirmedOnThisPhone("o1")).toBe(true);
  });

  it("with no signal: queued, said plainly, and still off this phone's lists at once", async () => {
    device.db = {};
    device.order = makeOrder();
    net.online = false;
    saves.upload.mockResolvedValue({ queued: true, reason: "offline" });
    await openOnItems();
    await straightToReview();
    await confirmDelivery();

    // Not a silent close — that looked exactly like a real success.
    expect(screen.getByRole("heading", { name: "אין כרגע חיבור לאינטרנט" })).toBeInTheDocument();
    expect(screen.getByText(/נשמר במכשיר ויישלח אוטומטית/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "חזרה" })).not.toBeInTheDocument();
    // So it can't be confirmed (and paid) a second time from a list that hasn't caught up.
    expect(confirmedOnThisPhone("o1")).toBe(true);
    expect(refresh).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  // It's saved on the phone — the X closes it without asking about unsaved
  // changes (it used to ask, though nothing could be lost).
  it("once saved on the phone, the X closes it without asking", async () => {
    saves.upload.mockResolvedValue({ queued: true, reason: "offline" });
    await openOnItems();
    await straightToReview();
    await confirmDelivery();
    await screen.findByRole("heading", { name: "אין כרגע חיבור לאינטרנט" });

    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("יש שינויים שלא נשמרו")).not.toBeInTheDocument();
  });

  it("a slow connection is told apart from no connection", async () => {
    saves.upload.mockResolvedValue({ queued: true, reason: "slow" });
    await openOnItems();
    await straightToReview();
    await confirmDelivery();
    expect(screen.getByRole("heading", { name: "החיבור איטי מדי" })).toBeInTheDocument();
  });

  it("a partial delivery that's queued stays on the lists — it's still owed", async () => {
    saves.upload.mockResolvedValue({ queued: true, reason: "offline" });
    await openOnItems();
    fireEvent.change(deliveredNowFields()[0], { target: { value: "1" } });
    await straightToReview();
    await confirmDelivery();
    expect(confirmedOnThisPhone("o1")).toBe(false);
  });

  it("refused by the server: shows its message, stays open, stays on the lists, and reports it", async () => {
    saves.upload.mockResolvedValue({ queued: false, ok: false, status: 400, error: "אחד הפריטים בהזמנה אינו תקין." });
    await openOnItems();
    await straightToReview();
    await confirmDelivery();

    expect(screen.getByText("אחד הפריטים בהזמנה אינו תקין.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "לאשר את האספקה?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור אספקה" })).toBeEnabled();
    expect(confirmedOnThisPhone("o1")).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      "order confirm failed",
      expect.objectContaining({
        extra: { orderId: "o1", status: 400, serverError: "אחד הפריטים בהזמנה אינו תקין." },
      })
    );
  });

  // The route's drive moves on to the next stop from here (owner, 2026-10-27).
  describe("tells the page it's saved", () => {
    it("on the server", async () => {
      const onConfirmed = vi.fn();
      await openOnItems({ onConfirmed });
      await straightToReview();
      await confirmDelivery();
      await waitFor(() => expect(onConfirmed).toHaveBeenCalledTimes(1));
    });

    it("on the phone, waiting for a connection", async () => {
      saves.upload.mockResolvedValue({ queued: true, reason: "offline" });
      const onConfirmed = vi.fn();
      await openOnItems({ onConfirmed });
      await straightToReview();
      await confirmDelivery();
      await screen.findByRole("heading", { name: "אין כרגע חיבור לאינטרנט" });
      expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it("not when the server refused it", async () => {
      saves.upload.mockResolvedValue({ queued: false, ok: false, status: 400, error: "אחד הפריטים בהזמנה אינו תקין." });
      const onConfirmed = vi.fn();
      await openOnItems({ onConfirmed });
      await straightToReview();
      await confirmDelivery();
      await screen.findByText("אחד הפריטים בהזמנה אינו תקין.");
      expect(onConfirmed).not.toHaveBeenCalled();
    });
  });

  it.each([
    [413, "הקבצים שצורפו גדולים מדי. צמצמו את מספר התמונות ונסו שוב."],
    [504, "השרת לא הגיב בזמן. נסו שוב."],
    [408, "השרת לא הגיב בזמן. נסו שוב."],
    [500, "אישור ההזמנה נכשל."],
  ])("refused with %i and no message: says what that means", async (status, message) => {
    saves.upload.mockResolvedValue({ queued: false, ok: false, status, error: "" });
    await openOnItems();
    await straightToReview();
    await confirmDelivery();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("a save that throws shows a generic error and reports the exception", async () => {
    const boom = new Error("IndexedDB unavailable");
    saves.upload.mockRejectedValue(boom);
    await openOnItems();
    await straightToReview();
    await confirmDelivery();

    expect(screen.getByText("שגיאה לא ידועה")).toBeInTheDocument();
    expect(sentry.captureException).toHaveBeenCalledWith(boom, { tags: { area: "order-confirm" } });
    expect(confirmedOnThisPhone("o1")).toBe(false);
  });

  it("can't be pressed twice while it's saving", async () => {
    let finish: (result: OfflineUploadResult) => void = () => {};
    saves.upload.mockImplementation(() => new Promise<OfflineUploadResult>((resolve) => (finish = resolve)));
    await openOnItems();
    await straightToReview();
    await confirmDelivery();

    expect(screen.getByRole("button", { name: "אישור אספקה" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "חזרה" })).toBeDisabled();
    await confirmDelivery();
    expect(saves.upload).toHaveBeenCalledTimes(1);

    await act(async () => finish({ queued: false, ok: true, data: {} }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
