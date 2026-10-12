// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Characterization of the project page's body (ProjectTabsClient): the money
// cards (תשלום, סיכום כספי), the תנועות ledger with its add/share buttons and
// row actions, the tasks and documents sections. The pure helpers it uses have
// their own test (ProjectTabsClient.helpers.test.tsx); this one is about what
// the owner sees on the page and what each button does.
//
// Everything that leaves the page — fetch, the offline queue/upload, the
// undo engine's timers, the PDF builder, Supabase-backed helpers — is mocked
// at its module boundary, so no test talks to a server.

const h = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-1"),
    dismiss: vi.fn(),
  });
  return {
    toast,
    shareTableSheet: vi.fn(async () => {}),
    offlineFetch: vi.fn(async () => ({ ok: true as const, queued: false as const, data: {} })),
    offlineUpload: vi.fn(),
    scheduleDeferredAction: vi.fn(),
    scheduleDeferredDelete: vi.fn(),
    scheduleDeferredEdit: vi.fn(),
    resyncAlerts: vi.fn(async () => {}),
    deviceProjectSaves: vi.fn(() => null),
    updateDocumentTag: vi.fn(async () => ({ ok: true })),
    fetchChecklistForEntity: vi.fn(async () => [] as unknown[]),
  };
});

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: h.toast }));

// next/dynamic's loader resolves on a later tick; React.lazy + Suspense is the
// closest stand-in that still renders the (mocked) dialog itself, so a test can
// see a click actually open it. A loader returns either the component (the
// `.then((m) => m.X)` form) or the whole module (default export).
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: (loader: () => Promise<unknown>) => {
      const Lazy = React.lazy(async () => {
        const loaded = (await loader()) as { default?: React.ComponentType } & React.ComponentType;
        return { default: loaded.default ?? loaded };
      });
      return function Dynamic(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={null}>
            <Lazy {...props} />
          </React.Suspense>
        );
      };
    },
  };
});

// The shared expense/session dialog: a stub that shows what the page handed it
// and lets a test "save" through the page's own onSaved. (session()/payment()
// are the fixture builders further down — called only on a click, by when
// they exist.)
vi.mock("@/components/expenses/ExpenseDialog", () => ({
  ExpenseDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lockedProjectId: string;
    users: Array<{ label: string }>;
    defaultSessionClockIn: string | null;
    editingExpense: { id: string; description: string | null; amount: unknown; billed_to_customer: boolean } | null;
    editingSession: { id: string } | null;
    onSaved: (data: unknown) => Promise<void>;
  }) =>
    props.open ? (
      <div role="dialog" aria-label="דיאלוג הוצאה">
        <span>פרויקט: {props.lockedProjectId}</span>
        <span>עובדים: {props.users.map((u) => u.label).join(", ")}</span>
        <span>כניסה ראשונה: {props.defaultSessionClockIn ?? "אין"}</span>
        <span>
          עריכת הוצאה: {props.editingExpense ? `${props.editingExpense.description} ${String(props.editingExpense.amount)} ${props.editingExpense.billed_to_customer ? "לחיוב" : "לא לחיוב"}` : "אין"}
        </span>
        <span>עריכת משמרת: {props.editingSession?.id ?? "אין"}</span>
        <button
          type="button"
          onClick={() =>
            void props.onSaved({
              sourceType: "expense",
              // A new expense, or — when editing — the same one with a new amount.
              expense: props.editingExpense
                ? { id: props.editingExpense.id, description: "חומרי בניין (מעודכן)", amount: 1300, expense_date: "2026-09-05" }
                : { id: "e-new", description: "שכירות מנוף", amount: 900, payment_status: "not_paid", expense_date: "2026-10-02" },
              projectExpense: { expense_id: props.editingExpense?.id ?? "e-new", billed_to_customer: false },
            })
          }
        >
          שמירת הוצאה
        </button>
        <button
          type="button"
          onClick={() =>
            void props.onSaved({
              sourceType: "session",
              session: props.editingSession
                ? session({ id: props.editingSession.id, user_id: "u2", clock_in: "2026-09-12T05:00:00Z", labor_cost: 260 })
                : session({ id: "s-new", user_id: "u2", clock_in: "2026-10-03T05:00:00Z", labor_cost: 350 }),
            })
          }
        >
          שמירת משמרת
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          סגירת הוצאה
        </button>
      </div>
    ) : null,
}));

vi.mock("@/app/(app)/projects/[id]/ProjectExpenseDialogs", () => ({
  AddIncomeDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editingPayment: { id: string } | null;
    vatRate: number;
    priceIncludesVat: boolean;
    onSaved: (saved: unknown) => void;
  }) =>
    props.open ? (
      <div role="dialog" aria-label="דיאלוג הכנסה">
        <span>עריכת תשלום: {props.editingPayment?.id ?? "אין"}</span>
        <span>
          מע״מ: {props.vatRate} {props.priceIncludesVat ? "כולל" : "לא כולל"}
        </span>
        <button
          type="button"
          onClick={() =>
            props.onSaved(
              props.editingPayment
                ? payment({ id: props.editingPayment.id, amount_total: 3300 })
                : payment({ id: "p-new", payment_date: "2026-10-05", amount_total: 3500, reference_number: "7788" })
            )
          }
        >
          שמירת הכנסה
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          סגירת הכנסה
        </button>
      </div>
    ) : null,
}));

vi.mock("@/app/(app)/projects/[id]/ProjectTasksMini", () => ({
  default: (props: { tasks: Array<{ title?: string }>; onChange: () => void }) => (
    <div>
      <ol aria-label="משימות הפרויקט">
        {props.tasks.map((t, i) => (
          <li key={i}>{t.title}</li>
        ))}
      </ol>
      <button type="button" onClick={props.onChange}>
        משימה השתנתה
      </button>
    </div>
  ),
}));

// The Morning dialog never opens from this page (see the report); its panel
// talks to the server, so it stays a stub.
vi.mock("@/components/morning/MorningDocumentsPanel", () => ({ default: () => null }));

// The תצוגה menu and each row's ⋮ menu as a plain stand-in (same as
// TaskUpsertDialog.ui.test.tsx): an open Radix menu stalls jsdom's timers for
// a minute and more on a page this size, and these tests are about what the
// menu's choices do, not the menu. Items fire both onSelect (the תצוגה menu)
// and onClick (the row menu), as Radix does on a click.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children }: Children) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
        onClick: () => setOpen(!open),
      });
    },
    DropdownMenuContent: ({ children }: Children) =>
      React.useContext(Menu).open ? <div role="menu">{children}</div> : null,
    DropdownMenuLabel: ({ children }: Children) => <div>{children}</div>,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({
      children,
      onClick,
      onSelect,
    }: Children & { onClick?: () => void; onSelect?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
          onClick={() => {
            onSelect?.();
            onClick?.();
            setOpen(false);
          }}
        >
          {children}
        </div>
      );
    },
  };
});

vi.mock("@/lib/share-pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/share-pdf")>()),
  shareTableSheet: h.shareTableSheet,
}));
vi.mock("@/lib/native-share", () => ({
  isNativePlatform: vi.fn(async () => false),
  shareFileNative: vi.fn(async () => "unavailable"),
  shareImageNative: vi.fn(async () => "unavailable"),
}));
vi.mock("@/lib/offline-queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline-queue")>()),
  offlineFetch: h.offlineFetch,
}));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: h.offlineUpload }));
// Only the scheduling calls are replaced — the hide/patch overlay that the
// documents list reads (useUndoOverlay) stays real. scheduleDeferredAction
// still applies its optimistic step, as the real one does at once; the commit
// waits for a test to call it (no 5-second timers left running).
vi.mock("@/lib/undo-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/undo-engine")>()),
  scheduleDeferredAction: (args: { onApplyOptimistic: () => void }) => {
    h.scheduleDeferredAction(args);
    args.onApplyOptimistic();
  },
  scheduleDeferredDelete: h.scheduleDeferredDelete,
  scheduleDeferredEdit: h.scheduleDeferredEdit,
}));
vi.mock("@/lib/ui/alerts-refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ui/alerts-refresh")>()),
  resyncAlerts: h.resyncAlerts,
}));
vi.mock("@/lib/projects/device-project-saves", () => ({ deviceProjectSaves: h.deviceProjectSaves }));
vi.mock("@/lib/documents/updateDocumentTag", () => ({ updateDocumentTag: h.updateDocumentTag }));
vi.mock("@/lib/documents/checklist", () => ({ fetchChecklistForEntity: h.fetchChecklistForEntity }));

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { refresh } from "@/__tests__/mocks/next-navigation";
import ProjectTabsClient, {
  type AssignableUser,
  type ExpenseListItem,
  type ProjectMonthlySalaryItem,
  type ProjectOverview,
} from "@/app/(app)/projects/[id]/ProjectTabsClient";
import type { PaymentRow } from "@/lib/payments";
import type { WorkSessionRow } from "@/lib/payroll";
import type { TableSheet } from "@/lib/share-pdf";

// ---------------------------------------------------------------------------
// Fixtures: a renovation project with two payments in (one collected, one a
// future-dated check), two expenses and two worker shifts out. One shift's note
// was written in Arabic and carries its Hebrew translation (notes_he).
// ---------------------------------------------------------------------------

function payment(over: Partial<PaymentRow> = {}): PaymentRow {
  return {
    id: "p1",
    payment_date: "2026-09-01",
    amount_total: 3000,
    payment_method: "bank_transfer",
    reference_number: "4411",
    check_number: null,
    amount_including_vat: null,
    amount_before_vat: null,
    net_amount: null,
    vat_amount: null,
    vat_rate: null,
    payment_status: "paid",
    business_domain: null,
    project_id: "proj-1",
    order_id: null,
    property_id: null,
    due_date: null,
    requires_split: null,
    recorded_by: null,
    account_id: "acc-bank",
    notes: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: null,
    ...over,
  };
}

function session(over: Partial<WorkSessionRow> = {}): WorkSessionRow {
  return {
    id: "s1",
    user_id: "u1",
    clock_in: "2026-09-03T05:00:00Z",
    clock_out: "2026-09-03T13:00:00Z",
    worked_minutes: 480,
    labor_cost: 400,
    is_billable_to_customer: false,
    bill_to_customer_amount: null,
    billing_status: null,
    notes: null,
    notes_he: null,
    business_domain: null,
    project_id: "proj-1",
    property_id: null,
    payment_status: "paid",
    ...over,
  };
}

function expenseItem(
  expense: Record<string, unknown>,
  projectExpense: Record<string, unknown> = {}
): ExpenseListItem {
  return {
    source_type: "expense",
    expense,
    project_expense: { expense_id: expense.id, billed_to_customer: false, ...projectExpense },
    session: null,
  };
}

function sessionItem(over: Partial<WorkSessionRow>): ExpenseListItem {
  return { source_type: "session", session: session(over), expense: null, project_expense: null };
}

function user(over: Partial<AssignableUser>): AssignableUser {
  return {
    id: "u1",
    full_name: "אחמד חסן",
    email: "ahmad@example.test",
    role: "worker",
    active: true,
    payroll_worker_type: "hourly_payslip",
    pay_tracking_mode: null,
    ...over,
  };
}

const OVERVIEW: ProjectOverview = {
  id: "proj-1",
  name: "שיפוץ דירה ברחוב הרצל",
  status: "active",
  project_type: "renovation",
  start_date: "2026-09-01",
  end_date: null,
  agreed_base_price: 10000,
  actual_price: null,
  expenses_billed_separately: null,
  price_includes_vat: false,
  no_charge: false,
  vat_rate: null,
  customer_id: "cust-1",
  customer_name: "משפחת לוי",
  project_manager_id: null,
  project_manager_name: null,
  notes: null,
  items_to_move: null,
  origin_address: null,
  origin_floor: null,
  origin_has_elevator: null,
  destination_address: null,
  destination_floor: null,
  destination_has_elevator: null,
  created_at: "2026-08-20T08:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
};

const PAYMENTS: PaymentRow[] = [
  payment(),
  payment({
    id: "p2",
    payment_date: "2026-09-20",
    amount_total: 2000,
    payment_method: "check",
    reference_number: null,
    check_number: "1234",
    payment_status: "pending",
    due_date: "2026-12-01",
    account_id: null,
  }),
];

const EXPENSES: ExpenseListItem[] = [
  expenseItem(
    {
      id: "e1",
      description: "חומרי בניין",
      category: "חומרים",
      amount: 1200,
      payment_status: "paid",
      expense_date: "2026-09-05",
      account_id: "acc-bank",
      notes: "ברזל ומלט",
    },
    { billed_to_customer: true }
  ),
  expenseItem({ id: "e2", description: "פינוי פסולת", amount: 500, payment_status: "not_paid", expense_date: "2026-09-10" }),
  sessionItem({
    id: "s1",
    user_id: "u1",
    labor_cost: 400,
    is_billable_to_customer: true,
    bill_to_customer_amount: 600,
    notes: "تم تركيب الأبواب",
    notes_he: "הותקנו הדלתות",
  }),
  sessionItem({
    id: "s2",
    user_id: "u2",
    clock_in: "2026-09-12T05:00:00Z",
    clock_out: "2026-09-12T09:00:00Z",
    labor_cost: 200,
    notes: "עבודה בחצר",
    payment_status: "not_paid",
  }),
];

const USERS: AssignableUser[] = [
  user({}),
  user({ id: "u2", full_name: "יוסי כהן", email: "yossi@example.test", payroll_worker_type: "session_only" }),
  user({ id: "u3", full_name: "מוחמד עלי", email: "m@example.test", payroll_worker_type: "monthly_payslip" }),
  user({ id: "u4", full_name: "עובד לשעבר", email: "old@example.test", active: false }),
];

type Props = Parameters<typeof ProjectTabsClient>[0];

function props(over: Partial<Props> = {}): Props {
  return {
    viewerRole: "admin",
    initialLedgerPrefs: { groupBy: "none", sortBy: "date", sortDirection: "desc" },
    overview: OVERVIEW,
    currentVatRate: 0.18,
    paymentTerms: "eom_30",
    dueDate: "2026-11-30",
    financials: {
      id: "proj-1",
      agreed_base_price: 10000,
      actual_price: null,
      total_expenses: 2300,
      expenses_billed: 1800,
      customer_total_price: 11800,
      gross_profit: 9500,
    },
    tasks: null,
    projectTasks: [],
    projectDocuments: [],
    projectDocumentsError: null,
    assignableUsers: USERS,
    expenses: EXPENSES,
    expenseRecordedByNameByValue: {},
    expenseAuditById: {},
    payments: PAYMENTS,
    morningDocuments: [],
    morningDocumentsError: null,
    paymentRecordedByNameByValue: {},
    paymentAuditById: {},
    workerBalance: null,
    salaryAgreements: [],
    monthlySalaryItems: [],
    accountNameById: { "acc-bank": "בנק הפועלים", "acc-cash": "קופה" },
    wageAccountIdsBySource: { "session:s1": ["acc-cash"] },
    ...over,
  };
}

// Amounts are ₪ first (lib/money; owner, 2026-10-11), and a he-IL negative
// carries a left-to-right mark — compare text with marks and spaces stripped:
// "₪1,200".
function clean(text: string | null | undefined) {
  return (text ?? "").replace(/[\s\p{Cf}]/gu, "");
}

function ledgerTable() {
  return screen.getByRole("table");
}

/** The desktop ledger's cells for the row whose description reads `name`:
 *  [chevron, date, description, status, account, billed, in, out, actions]. */
function rowCells(name: string) {
  const row = within(ledgerTable()).getByText(name).closest("tr");
  if (!row) throw new Error(`no ledger row for ${name}`);
  return within(row).getAllByRole("cell").map((cell) => clean(cell.textContent));
}

function ledgerRowNames() {
  return within(ledgerTable())
    .getAllByRole("row")
    .slice(1, -1) // thead and tfoot
    .map((row) => within(row).getAllByRole("cell")[2]?.querySelector(".font-semibold")?.textContent ?? "");
}

/** Opens the ledger's תצוגה menu (the header copy) and returns it. */
function openViewMenu() {
  const trigger = screen.getAllByText(/^(תצוגה|קיבוץ: .+)$/)[0]!.closest("button")!;
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

/** A group-by choice in the open תצוגה menu ("תאריך" is also a sort label there). */
function groupByItem(menu: HTMLElement, label: string) {
  const item = within(menu)
    .getAllByRole("menuitem")
    .find((el) => el.textContent === label);
  if (!item) throw new Error(`no group-by item ${label}`);
  return item;
}

/** Opens the ⋮ menu on the ledger row named `name` and clicks `action` in it. */
function rowAction(name: string, action: "עריכה" | "מחיקה") {
  const row = within(ledgerTable()).getByText(name).closest("tr")!;
  fireEvent.click(within(row).getByLabelText("פעולות"));
  fireEvent.click(within(within(row).getByRole("menu")).getByText(action));
}

/** The תשלום (collection) card in the head row. */
function paymentCard() {
  return screen.getByText("תשלום", { selector: "div.text-muted-foreground" }).closest<HTMLElement>("div.rounded-card")!;
}

function cardValue(card: HTMLElement) {
  return clean(card.querySelector(".text-lg")?.textContent);
}

/** The card's label→value lines, each as one cleaned string. */
function cardDetails(card: HTMLElement) {
  return Array.from(card.querySelectorAll(".border-t > div")).map((line) => clean(line.textContent));
}

/** The סיכום כספי section box (the first copy — it's rendered twice, phone +
 *  desktop): the nearest box around its title that holds the money lines. */
function financialSummary() {
  let box: HTMLElement | null = screen.getAllByText("סיכום כספי")[0]!;
  while (box && !box.querySelector("dl")) box = box.parentElement;
  if (!box) throw new Error("no סיכום כספי box");
  return box;
}

function sheetCells(html: string, wrapper: "tbody" | "tfoot") {
  const doc = new DOMParser().parseFromString(`<table><${wrapper}>${html}</${wrapper}></table>`, "text/html");
  return Array.from(doc.querySelectorAll("tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => clean(td.textContent))
  );
}

function lastSheet(): TableSheet {
  const call = h.shareTableSheet.mock.calls.at(-1) as unknown as [TableSheet, { fileName: string; shareFileName: string }, string];
  return call[0];
}

beforeEach(() => {
  // Only Date is frozen (collection status and the share file name read
  // "today"); timers stay real so Radix and React run as they do in the app.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T09:00:00Z"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ synced: true }), { status: 200 }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  h.deviceProjectSaves.mockImplementation(() => null);
  h.fetchChecklistForEntity.mockImplementation(async () => []);
});

describe("ProjectTabsClient — תנועות ledger", () => {
  it("lists every payment in and expense/wage out, each amount in its own column", () => {
    render(<ProjectTabsClient {...props()} />);

    // The section title counts every movement.
    const title = screen.getAllByText("תנועות").find((el) => el.tagName === "SPAN")!;
    expect(clean(title.textContent)).toBe("תנועות6");

    // [chevron, date, description, status, account, billed, in, out, actions]
    const bank = rowCells("אסמכתא 4411");
    expect(bank[3]).toBe("שולם");
    expect(bank[4]).toBe("בנקהפועלים");
    expect(bank[6]).toBe("₪3,000");
    expect(bank[7]).toBe("—");

    const materials = rowCells("חומרי בניין");
    expect(materials[2]).toBe("חומריםחומריבנייןברזלומלט"); // category chip, name, note
    expect(materials[5]).toBe("₪1,200"); // a pass-through expense bills its own amount
    expect(materials[6]).toBe("—");
    expect(materials[7]).toBe("₪1,200");

    const unbilled = rowCells("פינוי פסולת");
    expect(unbilled[5]).toBe("—");
    expect(unbilled[7]).toBe("₪500");

    // A shift: its cost is the money out; what the customer is billed for it
    // (at a markup) has its own column. The account is the wage payment's.
    const shift = rowCells("אחמד חסן");
    expect(shift[2]).toBe("שכרעובדאחמדחסןהותקנוהדלתות"); // chip, worker, note
    expect(shift[4]).toBe("קופה");
    expect(shift[5]).toBe("₪600");
    expect(shift[7]).toBe("₪400");
  });

  it("totals the ins, the outs and what's billed to the customer in the footer", () => {
    render(<ProjectTabsClient {...props()} />);
    const footer = within(ledgerTable()).getAllByRole("row").at(-1)!;
    const cells = within(footer).getAllByRole("cell").map((cell) => clean(cell.textContent));
    // 3,000 + 2,000 in (a pending check counts here); 1,200 + 500 + 400 + 200
    // out; 1,200 + 600 billed.
    expect(cells).toEqual(["", "סה״כ", "₪1,800", "₪5,000", "₪2,300", ""]);
  });

  it("a shift's Arabic note shows as its Hebrew translation; a note with no translation shows as written", () => {
    render(<ProjectTabsClient {...props()} />);
    const table = ledgerTable();
    expect(within(table).getByText("הותקנו הדלתות")).toBeInTheDocument();
    expect(screen.queryByText("تم تركيب الأبواب")).not.toBeInTheDocument();
    expect(within(table).getByText("עבודה בחצר")).toBeInTheDocument();
    // An expense's own note and a payment's method are the row's hint line too.
    expect(within(table).getByText("ברזל ומלט")).toBeInTheDocument();
    expect(within(table).getByText("העברה בנקאית")).toBeInTheDocument();
  });

  it("opening a row shows what isn't in the columns: method, check number, notes, who recorded it, files", () => {
    render(
      <ProjectTabsClient
        {...props({
          payments: [
            payment({ notes: "מקדמה", recorded_by: "user-9" }),
            {
              ...PAYMENTS[1]!,
              attachments: [{ document_id: "f-check", file_name: "check.jpg", url: "https://files.example.test/check.jpg" }],
            },
          ],
          paymentRecordedByNameByValue: { "user-9": "דנה" },
          expenses: [
            expenseItem({
              id: "e3",
              description: "שליח",
              amount: 500,
              payment_method: "cash",
              payment_status: "partial",
              paid_amount: 200,
              expense_date: "2026-09-08",
              recorded_by: "user-9",
            }),
            EXPENSES[2]!,
          ],
          expenseRecordedByNameByValue: { "user-9": "דנה" },
        })}
      />
    );
    const details = (name: string) => {
      const row = within(ledgerTable()).getByText(name).closest("tr")!;
      fireEvent.click(within(row).getByLabelText("פתיחת פרטים"));
      const detailRow = row.nextElementSibling as HTMLElement;
      return {
        facts: Array.from(detailRow.querySelectorAll("dl > div")).map((line) => clean(line.textContent)),
        links: Array.from(detailRow.querySelectorAll("a")).map((a) => [clean(a.textContent), a.getAttribute("href")]),
      };
    };

    // A note that isn't the row's hint, and who recorded it.
    expect(details("אסמכתא 4411").facts).toEqual(["אמצעי:העברהבנקאית", "אסמכתא:4411", "הערות:מקדמה", "נרשם:הוזןע״ידנה"]);
    // A check: its number, when it's due, its photo, and its place on the checks page.
    const check = details("תשלום");
    expect(check.facts).toEqual(["אמצעי:צ'ק", "מס'צ'ק:1234", "פירעון:01/12/26"]);
    expect(check.links).toEqual([
      ["צילוםהצ׳ק", "https://files.example.test/check.jpg"],
      // Its הורדה glyph right after it (owner, 2026-10-12).
      ["", "https://files.example.test/check.jpg"],
      ["לצ׳קבדףהצ׳קים←", "/checks?focus=p2"],
    ]);
    // A partly paid expense says how much of it was paid.
    expect(details("שליח").facts).toEqual(["אמצעי:מזומן", "שולם:₪200", "נרשם:הוזןע״ידנה"]);
    // An hourly worker's shift shows its hours.
    expect(details("אחמד חסן").facts.map((fact) => fact.split(":")[0])).toEqual(["כניסה", "יציאה", "משך"]);
  });

  it("newest first by default; the sort buttons reorder the rows", () => {
    render(<ProjectTabsClient {...props()} />);
    expect(ledgerRowNames()).toEqual(["תשלום", "יוסי כהן", "פינוי פסולת", "חומרי בניין", "אחמד חסן", "אסמכתא 4411"]);

    const menu = openViewMenu();
    fireEvent.click(within(menu).getByLabelText("סכום · יורד"));
    expect(ledgerRowNames()).toEqual(["אסמכתא 4411", "תשלום", "חומרי בניין", "פינוי פסולת", "אחמד חסן", "יוסי כהן"]);
    fireEvent.click(within(menu).getByLabelText("סכום · עולה"));
    expect(ledgerRowNames()[0]).toBe("יוסי כהן");
    // The chosen sort is the app's one toggle look, blue (owner, 2026-10-11:
    // "all the toggles should be blue"); the others stay quiet.
    expect(within(menu).getByLabelText("סכום · עולה")).toHaveAttribute("aria-pressed", "true");
    expect(within(menu).getByLabelText("סכום · עולה")).toHaveClass("bg-secondary", "text-secondary-foreground");
    expect(within(menu).getByLabelText("סכום · יורד")).toHaveAttribute("aria-pressed", "false");
    expect(within(menu).getByLabelText("סכום · יורד")).not.toHaveClass("bg-secondary");
  });

  it("grouping by worker folds the shifts under each worker and saves the choice (debounced)", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(groupByItem(openViewMenu(), "עובד"));

    // The menu's button now says what the list is grouped by.
    expect(screen.getAllByText("קיבוץ: עובד").length).toBeGreaterThan(0);
    // One collapsed header per worker, with how many movements it holds; the
    // payments and expenses (no worker) stay as plain rows under them.
    const table = ledgerTable();
    expect(within(table).getByText("אחמד חסן")).toBeInTheDocument();
    expect(within(table).getAllByText(/1 תנועות/)).toHaveLength(2);
    expect(within(table).getByText("חומרי בניין")).toBeInTheDocument();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/profile/ledger-prefs");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      prefs: { groupBy: "employee", sortBy: "date", sortDirection: "desc" },
    });
  });

  it("a view change still waiting to be saved is sent when the page closes", () => {
    const { unmount } = render(<ProjectTabsClient {...props()} />);
    fireEvent.click(groupByItem(openViewMenu(), "קטגוריה"));
    expect(fetch).not.toHaveBeenCalled(); // still inside the 500ms debounce
    unmount();
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body)).prefs.groupBy).toBe("category");
  });

  it("a saved view that only reached the device, or failed, says so", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ synced: false }), { status: 200 }));
    const first = render(<ProjectTabsClient {...props()} />);
    fireEvent.click(groupByItem(openViewMenu(), "תאריך"));
    first.unmount();
    await waitFor(() => expect(h.toast.warning).toHaveBeenCalledWith("השינויים נשמרו מקומית אך טרם סונכרנו לחשבון"));

    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 500 }));
    const second = render(<ProjectTabsClient {...props()} />);
    fireEvent.click(groupByItem(openViewMenu(), "ללא"));
    second.unmount();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("שמירת ההעדפה נכשלה, נסו שוב"));
  });

  it("an error loading the money rows is stated above the list; no rows → an empty state and no share buttons", () => {
    render(<ProjectTabsClient {...props({ payments: [], expenses: [], moneyError: "timeout" })} />);
    expect(screen.getByText("שגיאה בטעינת תנועות: timeout")).toBeInTheDocument();
    // The app's one empty box (owner, 2026-10-11), not a plain line.
    expect(screen.getByText("אין תנועות להצגה.").closest(".border-dashed")).not.toBeNull();
    expect(screen.queryByTitle("שיתוף כל התנועות — נכנס ויוצא (PDF)")).not.toBeInTheDocument();
    expect(screen.queryByTitle("שיתוף לחיוב לקוח (PDF)")).not.toBeInTheDocument();
    // Adding stays possible: "+ הוצאה" and "+ הכנסה" are a section's "+"
    // buttons, both the less-important look — white, dashed outline — a step
    // below the page's main "רישום תשלום" (owner, 2026-10-11).
    const expenseButtons = screen.getAllByRole("button", { name: "הוצאה" });
    const incomeButtons = screen.getAllByRole("button", { name: "הכנסה" });
    expect(expenseButtons.length).toBeGreaterThan(0);
    expect(incomeButtons.length).toBeGreaterThan(0);
    for (const button of [...expenseButtons, ...incomeButtons]) {
      expect(button).toHaveClass("border-dashed", "bg-background", "text-secondary");
      expect(button).not.toHaveClass("bg-secondary");
    }
    // The section's count: the grey pill every section wears.
    const ledgerTitle = screen.getByText("תנועות").closest("span")!;
    expect(within(ledgerTitle).getByText("0")).toHaveClass("rounded-full", "bg-muted");
  });

  it("a monthly salary on the project is money out dated to its pay day, not editable here", () => {
    render(
      <ProjectTabsClient
        {...props({
          payments: [],
          expenses: [],
          salaryAgreements: [{ user_id: "u3", due_day_of_next_month: 10 } as never],
          monthlySalaryItems: [
            {
              payslip_id: "ps1",
              user_id: "u3",
              period_month: "2026-09",
              earned_amount: 6000,
              paid_amount: 0,
              owed_amount: 6000,
              payment_status: null,
              is_billable_to_customer: true,
              bill_to_customer_amount: 6500,
            },
            // Nothing earned — not a movement at all.
            { payslip_id: "ps0", user_id: "u3", period_month: "2026-08", earned_amount: 0 } as ProjectMonthlySalaryItem,
          ],
        })}
      />
    );
    expect(ledgerRowNames()).toEqual(["מוחמד עלי"]);
    const cells = rowCells("מוחמד עלי");
    expect(cells[1]).toBe("10/10/26"); // September's salary, paid on the 10th of October
    expect(cells[2]).toBe("משכורתחודשיתמוחמדעלי");
    expect(cells[3]).toBe("לאשולם");
    expect(cells[5]).toBe("₪6,500");
    expect(cells[7]).toBe("₪6,000");
    // No edit/delete menu on a payslip row.
    expect(within(within(ledgerTable()).getByText("מוחמד עלי").closest("tr")!).queryByRole("button", { name: "פעולות" })).toBeNull();
  });
});

describe("ProjectTabsClient — sharing the ledger as PDF", () => {
  it("תנועות shares every movement with its totals and in-minus-out", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getAllByTitle("שיתוף כל התנועות — נכנס ויוצא (PDF)")[0]!);
    await waitFor(() => expect(h.shareTableSheet).toHaveBeenCalledTimes(1));

    const [sheet, names, title] = h.shareTableSheet.mock.calls[0] as unknown as [
      TableSheet,
      { fileName: string; shareFileName: string },
      string,
    ];
    expect(title).toBe("תנועות — שיפוץ דירה ברחוב הרצל · משפחת לוי");
    // A shared file goes out under a plain Latin name; a download keeps the Hebrew one.
    expect(names).toEqual({ fileName: "תנועות - שיפוץ דירה ברחוב הרצל.pdf", shareFileName: "BizH-movements-2026-10-11.pdf" });

    const rows = sheetCells(sheet.rowsHtml.join(""), "tbody");
    expect(rows).toHaveLength(6);
    // The shift row: its note in Hebrew, its billed and out amounts.
    const shift = rows.find((cells) => cells[1]?.startsWith("שכרעובד—אחמדחסן"))!;
    expect(shift[1]).toContain("הותקנוהדלתות");
    expect(shift.slice(4)).toEqual(["₪600", "", "₪400"]);
    expect(sheet.rowsHtml.join("")).not.toContain("تم");

    expect(sheetCells(sheet.tfootHtml, "tfoot")).toEqual([
      ["סה״כ", "₪1,800", "₪5,000", "₪2,300"],
      ["נכנספחותיוצא", "₪2,700"],
    ]);
  });

  it("לחיוב לקוח shares only what's billed to the customer, with the project's billed total", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getAllByTitle("שיתוף לחיוב לקוח (PDF)")[0]!);
    await waitFor(() => expect(h.shareTableSheet).toHaveBeenCalledTimes(1));
    const sheet = lastSheet();
    expect(sheetCells(sheet.rowsHtml.join(""), "tbody")).toEqual([
      ["05/09/26", "חומריבניין", "₪1,200"],
      ["03/09/26", "שכרעובד—אחמדחסן", "₪600"],
    ]);
    expect(sheetCells(sheet.tfootHtml, "tfoot")).toEqual([["סה״כלחיובלקוח", "₪1,800"]]);
  });

  it("a billed monthly salary joins the לחיוב לקוח sheet", async () => {
    render(
      <ProjectTabsClient
        {...props({
          // The server's billed figure counts billed payslips too (the
          // project_financials view): 1,800 + 6,500.
          financials: { ...props().financials!, expenses_billed: 8300 },
          monthlySalaryItems: [
            {
              payslip_id: "ps1",
              user_id: "u3",
              period_month: "2026-09",
              earned_amount: 6000,
              paid_amount: 6000,
              owed_amount: 0,
              payment_status: null,
              is_billable_to_customer: true,
              bill_to_customer_amount: 6500,
            },
          ],
        })}
      />
    );
    fireEvent.click(screen.getAllByTitle("שיתוף לחיוב לקוח (PDF)")[0]!);
    await waitFor(() => expect(h.shareTableSheet).toHaveBeenCalledTimes(1));
    const rows = sheetCells(lastSheet().rowsHtml.join(""), "tbody");
    // No agreement → paid on the 9th of the next month, by convention.
    expect(rows.at(-1)).toEqual(["09/10/26", "שכר—מוחמדעלי", "₪6,500"]);
    expect(sheetCells(lastSheet().tfootHtml, "tfoot")).toEqual([["סה״כלחיובלקוח", "₪8,300"]]);
    // Paid in full, with no status of its own → reads as paid in the ledger.
    expect(rowCells("מוחמד עלי")[3]).toBe("שולם");
  });
});

describe("ProjectTabsClient — adding and editing money", () => {
  it("+ הוצאה opens the expense dialog locked to this project, with active workers only; a save adds the row and closes it", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "הוצאה" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הוצאה" });
    expect(within(dialog).getByText("פרויקט: proj-1")).toBeInTheDocument();
    expect(within(dialog).getByText("עובדים: אחמד חסן, יוסי כהן, מוחמד עלי")).toBeInTheDocument();
    // A new shift starts from the project's first shift's hours.
    expect(within(dialog).getByText("כניסה ראשונה: 2026-09-03T05:00:00Z")).toBeInTheDocument();
    expect(within(dialog).getByText("עריכת הוצאה: אין")).toBeInTheDocument();

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "שמירת הוצאה" })));
    // The dialog waits for the page's refresh before closing (no flash of the
    // old list) — then the new row is in the ledger.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "דיאלוג הוצאה" })).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalled();
    expect(rowCells("שכירות מנוף")[7]).toBe("₪900");
  });

  it("a saved shift that's new joins the ledger under its worker", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "הוצאה" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הוצאה" });
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "שמירת משמרת" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "דיאלוג הוצאה" })).not.toBeInTheDocument());
    expect(within(ledgerTable()).getAllByText("יוסי כהן")).toHaveLength(2);
  });

  it("editing an expense from its row hands the dialog that expense; its save replaces the row", async () => {
    render(<ProjectTabsClient {...props()} />);
    rowAction("חומרי בניין", "עריכה");
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הוצאה" });
    expect(within(dialog).getByText("עריכת הוצאה: חומרי בניין 1200 לחיוב")).toBeInTheDocument();

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "שמירת הוצאה" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "דיאלוג הוצאה" })).not.toBeInTheDocument());
    // The same row, updated — not a second one beside the old.
    expect(within(ledgerTable()).queryByText("חומרי בניין")).not.toBeInTheDocument();
    expect(rowCells("חומרי בניין (מעודכן)")[7]).toBe("₪1,300");
    expect(ledgerRowNames()).toHaveLength(6);
  });

  it("closing the expense dialog drops what was being edited", async () => {
    render(<ProjectTabsClient {...props()} />);
    rowAction("חומרי בניין", "עריכה");
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הוצאה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירת הוצאה" }));
    // + הוצאה after it starts empty.
    fireEvent.click(screen.getAllByRole("button", { name: "הוצאה" })[0]!);
    expect(await screen.findByText("עריכת הוצאה: אין")).toBeInTheDocument();
  });

  it("editing a shift from its row hands the dialog that shift; its save replaces the row", async () => {
    render(<ProjectTabsClient {...props()} />);
    rowAction("יוסי כהן", "עריכה");
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הוצאה" });
    expect(within(dialog).getByText("עריכת משמרת: s2")).toBeInTheDocument();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "שמירת משמרת" })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "דיאלוג הוצאה" })).not.toBeInTheDocument());
    expect(rowCells("יוסי כהן")[7]).toBe("₪260");
    expect(ledgerRowNames()).toHaveLength(6);
  });

  it("+ הכנסה and רישום תשלום open the income dialog; a saved payment joins the ledger", async () => {
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "רישום תשלום" }));
    let dialog = await screen.findByRole("dialog", { name: "דיאלוג הכנסה" });
    expect(within(dialog).getByText("עריכת תשלום: אין")).toBeInTheDocument();
    expect(within(dialog).getByText("מע״מ: 0.18 לא כולל")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירת הכנסה" }));
    expect(screen.queryByRole("dialog", { name: "דיאלוג הכנסה" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "הכנסה" })[0]!);
    dialog = await screen.findByRole("dialog", { name: "דיאלוג הכנסה" });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירת הכנסה" }));
    expect(screen.queryByRole("dialog", { name: "דיאלוג הכנסה" })).not.toBeInTheDocument();
    expect(rowCells("אסמכתא 7788")[6]).toBe("₪3,500");
    expect(refresh).toHaveBeenCalled();
  });

  it("a price that includes VAT hands the income dialog the project's own rate", async () => {
    render(<ProjectTabsClient {...props({ overview: { ...OVERVIEW, price_includes_vat: true, vat_rate: 0.17 } })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "הכנסה" })[0]!);
    expect(await screen.findByText("מע״מ: 0.17 כולל")).toBeInTheDocument();
  });

  it("editing a payment from its row hands the dialog that payment; its save replaces the row", async () => {
    render(<ProjectTabsClient {...props()} />);
    rowAction("אסמכתא 4411", "עריכה");
    const dialog = await screen.findByRole("dialog", { name: "דיאלוג הכנסה" });
    expect(within(dialog).getByText("עריכת תשלום: p1")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירת הכנסה" }));
    expect(rowCells("אסמכתא 4411")[6]).toBe("₪3,300");
    expect(ledgerRowNames()).toHaveLength(6);
  });
});

describe("ProjectTabsClient — deleting money rows", () => {
  async function requestDelete(name: string) {
    rowAction(name, "מחיקה");
    return screen.findByRole("dialog");
  }

  function lastDeferred() {
    return h.scheduleDeferredAction.mock.calls.at(-1)![0] as {
      key: string;
      onCommit: () => Promise<{ ok: boolean; error?: string }>;
      onRevert: () => void;
    };
  }

  it("an expense: asks first, then leaves the list at once and is deleted on commit", async () => {
    render(<ProjectTabsClient {...props()} />);
    const dialog = await requestDelete("פינוי פסולת");
    expect(within(dialog).getByText("מחיקת הוצאה")).toBeInTheDocument();
    expect(within(dialog).getByText("פינוי פסולת", { selector: "span" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    expect(within(ledgerTable()).queryByText("פינוי פסולת")).not.toBeInTheDocument();
    const deferred = lastDeferred();
    expect(deferred.key).toBe("project-expense:delete:e2");
    await act(async () => {
      await expect(deferred.onCommit()).resolves.toEqual({ ok: true });
    });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/expenses/delete", { id: "e2", project_id: "proj-1" }, "מחיקת חיוב");

    // Undo puts it back.
    act(() => deferred.onRevert());
    expect(within(ledgerTable()).getByText("פינוי פסולת")).toBeInTheDocument();
  });

  it("a failed delete reports the server's error to the undo engine", async () => {
    h.offlineFetch.mockResolvedValueOnce({ ok: false, queued: false, error: "boom" } as never);
    render(<ProjectTabsClient {...props()} />);
    const dialog = await requestDelete("אסמכתא 4411");
    // A payment is named by its amount and date.
    expect(within(dialog).getByText("מחיקת הכנסה")).toBeInTheDocument();
    expect(clean(within(dialog).getByText(/01\/09\/26/).textContent)).toBe("₪3,000•01/09/26");
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    const deferred = lastDeferred();
    expect(deferred.key).toBe("project-payment:delete:p1");
    const result = await deferred.onCommit();
    expect(result.ok).toBe(false);
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/payments/delete", { id: "p1", project_id: "proj-1" }, "מחיקת הכנסה");
  });

  it("a shift: asks first by its start time, leaves the list at once, and an admin deletes it through payroll", async () => {
    render(<ProjectTabsClient {...props()} />);
    const dialog = await requestDelete("יוסי כהן");
    expect(within(dialog).getByText("מחיקת משמרת")).toBeInTheDocument();
    expect(within(dialog).getByText(/משמרת מ־/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(within(ledgerTable()).queryByText("יוסי כהן")).not.toBeInTheDocument();
    await act(async () => {
      await lastDeferred().onCommit();
    });
    expect(h.offlineFetch).toHaveBeenLastCalledWith("/api/payroll/sessions/delete", { session_id: "s2" }, "מחיקת משמרת");
    expect(refresh).toHaveBeenCalled();
  });

  it("cancelling the question deletes nothing", async () => {
    render(<ProjectTabsClient {...props()} />);
    const dialog = await requestDelete("חומרי בניין");
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.scheduleDeferredAction).not.toHaveBeenCalled();
    expect(within(ledgerTable()).getByText("חומרי בניין")).toBeInTheDocument();
  });
});

describe("ProjectTabsClient — money cards", () => {
  it("סיכום כספי builds the price up line by line, with the gross profit and its share", () => {
    render(<ProjectTabsClient {...props()} />);
    // Rendered twice on purpose (phone tab + desktop side column) — read the first.
    const summary = financialSummary();
    // The page's own section box, like its neighbours (owner, 2026-10-11), and
    // still one that never folds.
    expect(screen.getAllByText("סיכום כספי")[0]!.closest("button")).toBeDisabled();
    const lines = Array.from(summary.querySelectorAll("dl > div")).map((line) => clean(line.textContent));
    expect(lines).toEqual([
      "מחירבסיסשסוכם₪10,000עדכון",
      "חיוביםללקוח₪1,800",
      "מחירבפועל₪11,800",
      "הוצאות₪2,300",
      "רווחגולמי81%מהמחירבפועל₪9,500",
    ]);
  });

  it("תשלום states what's still owed, what was collected out of the price, and the expected check", () => {
    render(<ProjectTabsClient {...props()} />);
    const card = paymentCard();
    // 11,800 price − 3,000 collected (the pending check isn't collected yet).
    expect(cardValue(card)).toBe("₪8,800");
    // Part of it is in: partly paid, whatever is still expected.
    expect(within(card).getByText("שולם חלקית")).toBeInTheDocument();
    expect(cardDetails(card)).toEqual([
      "נגבה₪3,000מתוך₪11,800",
      "תשלומים2",
      "צפוילגבייה₪2,000",
      "תנאיתשלוםשוטף+30·פירעון30/11/26",
    ]);
  });

  it("nothing in yet but a future-dated check reads as expected payment", () => {
    render(<ProjectTabsClient {...props({ payments: [PAYMENTS[1]!] })} />);
    const card = paymentCard();
    expect(cardValue(card)).toBe("₪11,800");
    expect(within(card).getByText("תשלום צפוי")).toBeInTheDocument();
  });

  it("a debt past its due date reads late, with how many days — and so does an overdue check", () => {
    const { unmount } = render(<ProjectTabsClient {...props({ dueDate: "2026-10-01" })} />);
    expect(within(paymentCard()).getByText("באיחור (10 ימים)")).toBeInTheDocument();
    unmount();

    // The check was due yesterday: still pending, now also late.
    render(
      <ProjectTabsClient {...props({ payments: [PAYMENTS[0]!, { ...PAYMENTS[1]!, due_date: "2026-10-10" }] })} />
    );
    expect(cardDetails(paymentCard())).toContain("צפוילגבייה₪2,000(₪2,000באיחור)");
  });

  it("a no-charge project says so, with its terms only, and offers no payment button", () => {
    render(<ProjectTabsClient {...props({ overview: { ...OVERVIEW, no_charge: true } })} />);
    const card = paymentCard();
    expect(cardValue(card)).toBe("ללאחיוב");
    expect(cardDetails(card)).toEqual(["תנאיתשלוםשוטף+30"]);
    expect(within(card).queryByText("רישום תשלום")).not.toBeInTheDocument();
  });

  it("a fully collected project reads paid", () => {
    render(<ProjectTabsClient {...props({ payments: [payment({ amount_total: 11800 })] })} />);
    const card = paymentCard();
    expect(cardValue(card)).toBe("שולם");
    expect(cardDetails(card)[0]).toBe("נגבה₪11,800מתוך₪11,800");
  });

  it("an unpriced project reads 'לא סוכם מחיר', never 'שולם', with 'לא סוכם תשלום' beside it", () => {
    // With no price there's no balance — and "no balance" used to be drawn as a
    // green "שולם" (fixed 2026-10-11).
    render(
      <ProjectTabsClient
        {...props({
          overview: { ...OVERVIEW, agreed_base_price: null },
          financials: null,
          payments: [],
        })}
      />
    );
    const card = paymentCard();
    expect(cardValue(card)).toBe("לאסוכםמחיר"); // cardValue drops the spaces
    expect(within(card).getByText("לא סוכם תשלום")).toBeInTheDocument();
    expect(cardDetails(card)[0]).toBe("נגבה₪0מתוך—");
  });

  it("VAT collected on official payments is shown beside what actually arrived", () => {
    render(
      <ProjectTabsClient
        {...props({ payments: [payment({ amount_total: 1180, net_amount: 1000, vat_amount: 180 })] })}
      />
    );
    const line = screen.getAllByText(/מע״מ שנגבה/)[0]!.parentElement!;
    expect(clean(line.textContent)).toBe("סה״כהתקבלבפועל₪1,180·מע״משנגבה₪180");
  });

  it("what we still owe on the project includes the wages from the worker balance", () => {
    render(
      <ProjectTabsClient
        {...props({ workerBalance: { project_id: "proj-1", earned_amount: 900, paid_amount: 300, owed_amount: 600 } })}
      />
    );
    expect(screen.getAllByText("הוצאות שלא שולמו").length).toBeGreaterThan(0);
    expect(screen.getAllByText("שכר עובדים").length).toBeGreaterThan(0);
  });

  it("updating the base price: validates, shows the resulting price, and saves through the undo window", async () => {
    render(<ProjectTabsClient {...props()} />);
    // 28px to look at, 44 to tap: a ::before reaches past its edge (owner,
    // 2026-10-11: tap targets ≥ 44px on the phone).
    expect(screen.getAllByRole("button", { name: "עדכון" })[0]).toHaveClass("h-7", "relative", "before:absolute", "before:-inset-2");
    fireEvent.click(screen.getAllByRole("button", { name: "עדכון" })[0]!);
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByPlaceholderText("לדוגמה: 12000");
    expect(input).toHaveValue("10,000");

    fireEvent.change(input, { target: { value: "" } });
    expect(within(dialog).getAllByText("שדה חובה").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "שמירה" })).toBeDisabled();

    fireEvent.change(input, { target: { value: "12000" } });
    // 12,000 + 1,800 billed.
    expect(clean(within(dialog).getByText(/המחיר בפועל שיוצג/).textContent)).toBe("המחירבפועלשיוצגלאחרהשמירה:₪13,800");
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));

    // Optimistic: the summary shows the new price at once.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const summary = financialSummary();
    expect(clean(summary.querySelector("dl > div")?.textContent)).toBe("מחירבסיסשסוכם₪12,000עדכון");

    const deferred = h.scheduleDeferredAction.mock.calls.at(-1)![0] as {
      key: string;
      onCommit: () => Promise<{ ok: boolean }>;
    };
    expect(deferred.key).toBe("project-base-price:edit:proj-1");
    await act(async () => {
      await deferred.onCommit();
    });
    expect(h.offlineFetch).toHaveBeenCalledWith(
      "/api/projects/update-agreed-base-price",
      { project_id: "proj-1", agreed_base_price: 12000 },
      "עדכון מחיר בסיס"
    );
    // Setting a price resolves the "closed unbilled" alert.
    expect(h.resyncAlerts).toHaveBeenCalled();
  });

  it("on the phone, a new base price is saved on the device first and never sent twice", async () => {
    const change = vi.fn(async () => true);
    h.deviceProjectSaves.mockImplementation((() => ({ change })) as never);
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "עדכון" })[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("לדוגמה: 12000"), { target: { value: "15000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    const deferred = h.scheduleDeferredAction.mock.calls.at(-1)![0] as { onCommit: () => Promise<{ ok: boolean }> };
    await act(async () => {
      await expect(deferred.onCommit()).resolves.toEqual({ ok: true });
    });
    expect(change).toHaveBeenCalledWith("proj-1", { kind: "agreed-price", agreed_base_price: 15000 });
    expect(h.offlineFetch).not.toHaveBeenCalled();
  });
});

describe("ProjectTabsClient — who sees the money", () => {
  it("office staff see the tasks and documents but no ledger and no financial summary", () => {
    render(<ProjectTabsClient {...props({ viewerRole: "office" })} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("סיכום כספי")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "הוצאה" })).not.toBeInTheDocument();
    expect(screen.getByText("משימות")).toBeInTheDocument();
    expect(screen.getByText("מסמכים")).toBeInTheDocument();
  });

  it("the cards passed in from the page are placed in the head row and the side column", () => {
    render(
      <ProjectTabsClient
        {...props({
          customerCard: <div>כרטיס לקוח</div>,
          detailsCard: <div>כרטיס הובלה</div>,
          statusCard: <div>כרטיס סטטוס</div>,
          remindersSection: <div>תזכורות</div>,
          activitySection: <div>היסטוריית פעילות</div>,
        })}
      />
    );
    for (const text of ["כרטיס לקוח", "כרטיס הובלה", "תזכורות", "היסטוריית פעילות"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    // With a details card the status card is placed twice: under the head row
    // on a phone, in the side column on a computer.
    expect(screen.getAllByText("כרטיס סטטוס")).toHaveLength(2);
  });
});

describe("ProjectTabsClient — tasks section", () => {
  it("with tasks: open, done/total and %, newest due first, and a change refreshes the page", () => {
    render(
      <ProjectTabsClient
        {...props({
          projectTasks: [
            { id: "t1", title: "להזמין חומרים", status: "done", due_date: "2026-09-01" },
            { id: "t2", title: "לתאם חשמלאי", status: "open", due_date: "2026-10-20" },
            { id: "t3", title: "בוטלה", status: "cancelled", due_date: "2026-09-15" },
          ],
        })}
      />
    );
    const header = screen.getByText("משימות").closest("button")!;
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(clean(header.textContent)).toBe("משימות1/3·33%");
    // The app's task glyph (the menu's, the tabs'), grey like every section
    // icon (owner, 2026-10-11) — it was a navy checklist.
    const icon = header.querySelector("svg")!;
    expect(icon).toHaveClass("lucide-list-todo", "text-muted-foreground");
    expect(icon).not.toHaveClass("lucide-list-checks");
    const list = screen.getByRole("list", { name: "משימות הפרויקט" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "לתאם חשמלאי",
      "בוטלה",
      "להזמין חומרים",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "משימה השתנתה" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("with no task rows it falls back to the server's counts; with none at all it's folded and says so", () => {
    const { unmount } = render(
      <ProjectTabsClient
        {...props({ tasks: { project_id: "proj-1", total_tasks: 4, completed_tasks: "1", open_tasks: 3 } })}
      />
    );
    expect(clean(screen.getByText("משימות").closest("button")!.textContent)).toBe("משימות1/4·25%");
    unmount();

    render(<ProjectTabsClient {...props()} />);
    const header = screen.getByText("משימות").closest("button")!;
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByText("אין משימות")).toBeInTheDocument();
    // The chevron opens it.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });
});

describe("ProjectTabsClient — documents section", () => {
  const DOCS: Props["projectDocuments"] = [
    {
      document_id: "d1",
      storage_key: "k1",
      file_name: "contract.pdf",
      title: "חוזה עבודה",
      document_type: "חוזה",
      entity_type: "project",
      entity_id: "proj-1",
      uploaded_at: "2026-09-02T10:00:00Z",
      uploaded_by_name: null,
      url: "https://files.example.test/contract.pdf",
    },
    {
      document_id: "d2",
      storage_key: "k2",
      file_name: "photo.jpg",
      title: null,
      document_type: null,
      entity_type: "project",
      entity_id: "proj-1",
      uploaded_at: null,
      uploaded_by_name: null,
      url: null,
    },
  ];

  it("lists the project's files, opened, with their count", () => {
    render(<ProjectTabsClient {...props({ projectDocuments: DOCS })} />);
    const header = screen.getByText("מסמכים").closest("button")!;
    expect(header).toHaveAttribute("aria-expanded", "true");
    // The count as every section's count — the grey pill — and the icon grey
    // (owner, 2026-10-11; it was plain "2 קבצים" and a navy icon).
    expect(within(header).getByText("2")).toHaveClass("rounded-full", "bg-muted", "text-muted-foreground");
    expect(header.textContent).not.toMatch(/קבצים/);
    expect(header.querySelector("svg")).toHaveClass("text-muted-foreground");
    expect(header.querySelector("svg")).not.toHaveClass("text-primary");
    // View and download on hover; no pencil or bin on the tile — they wait in
    // its quiet ⋮ (owner, 2026-10-12).
    const contract = screen.getByText("חוזה עבודה").closest("div.overflow-hidden") as HTMLElement;
    expect(within(contract).getByRole("link", { name: "צפייה" })).toHaveAttribute(
      "href",
      "https://files.example.test/contract.pdf"
    );
    expect(within(contract).getByRole("link", { name: "הורדה" })).toHaveAttribute("download", "contract.pdf");
    expect(within(contract).queryByRole("button", { name: "מחיקת קובץ" })).toBeNull();
    expect(within(contract).queryByRole("button", { name: "עריכת קטגוריה" })).toBeNull();
    // A file with no title goes by its file name; one with no link has nothing to open.
    const photo = screen.getByText("photo.jpg").closest("div.overflow-hidden") as HTMLElement;
    expect(within(photo).queryByRole("link")).toBeNull();
    expect(screen.getByText("חוזה")).toBeInTheDocument();

    // A category filed before the controlled list stays pickable for new uploads.
    fireEvent.click(screen.getByRole("button", { name: "העלאת קובץ או תמונה" }));
    const legacy = screen.getByRole("group", { name: "קטגוריות קיימות בפרויקט" });
    expect(within(legacy).getAllByRole("option").map((option) => option.getAttribute("value"))).toEqual(["חוזה"]);
  });

  it("empty: folded, a 0 count, and the app's empty box; a load error is stated", () => {
    render(<ProjectTabsClient {...props({ projectDocumentsError: "denied" })} />);
    const header = screen.getByText("מסמכים").closest("button")!;
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByText("0")).toHaveClass("rounded-full", "bg-muted");
    // The shared EmptyState's dashed box, not a plain line (owner, 2026-10-11).
    expect(screen.getByText("אין מסמכים להצגה.").closest(".border-dashed")).not.toBeNull();
    expect(screen.getByText("שגיאה בטעינת מסמכים: denied")).toBeInTheDocument();
  });

  it("while the documents are on their way: a placeholder, no count", () => {
    render(<ProjectTabsClient {...props({ documentsPending: true })} />);
    const header = screen.getByText("מסמכים").closest("button")!;
    expect(header.textContent).not.toMatch(/קבצים/);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  /** A file tile's quiet ⋮, then one of its items. */
  function pickFromFileMenu(fileName: string, item: string) {
    const tile = screen.getByText(fileName).closest("div.overflow-hidden") as HTMLElement;
    fireEvent.click(within(tile).getByRole("button", { name: "פעולות" }));
    fireEvent.click(within(within(tile).getByRole("menu")).getByText(item));
  }

  it("deleting a file asks first, by name, and deletes it through the API on commit", async () => {
    render(<ProjectTabsClient {...props({ projectDocuments: DOCS })} />);
    pickFromFileMenu("חוזה עבודה", "מחיקת קובץ");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("מחיקת מסמך")).toBeInTheDocument();
    expect(within(dialog).getByText("חוזה עבודה")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));

    const args = h.scheduleDeferredDelete.mock.calls[0]![0] as {
      scope: string;
      id: string;
      onCommit: () => Promise<{ ok: boolean }>;
    };
    expect(args).toMatchObject({ scope: "project-document", id: "d1", message: "המסמך נמחק" });
    await act(async () => {
      await expect(args.onCommit()).resolves.toEqual({ ok: true });
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/documents/delete");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ document_id: "d1" });
    expect(refresh).toHaveBeenCalled();
  });

  it("a refused file delete hands back the server's error", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    render(<ProjectTabsClient {...props({ projectDocuments: DOCS })} />);
    pickFromFileMenu("photo.jpg", "מחיקת קובץ");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("photo.jpg")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    const args = h.scheduleDeferredDelete.mock.calls[0]![0] as { onCommit: () => Promise<{ ok: boolean }> };
    expect((await args.onCommit()).ok).toBe(false);
  });

  it("changing a file's category: the current one is kept as an option, and the change goes through the undo window", async () => {
    render(<ProjectTabsClient {...props({ projectDocuments: DOCS })} />);
    pickFromFileMenu("חוזה עבודה", "עריכת קטגוריה");
    const dialog = await screen.findByRole("dialog");
    // A noun, as every title and button (owner, 2026-10-11: one wording).
    expect(within(dialog).getByText("עריכת קטגוריה")).toBeInTheDocument();
    const select = within(dialog).getByRole("combobox");
    // "חוזה" isn't on the controlled list — it stays pickable, marked as current.
    expect(select).toHaveValue("חוזה");
    expect(within(dialog).getByRole("option", { name: /\(נוכחי\)/ })).toBeInTheDocument();

    // An empty tag is refused.
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    expect(h.toast.error).toHaveBeenCalledWith("יש להזין תג");
    expect(h.scheduleDeferredEdit).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: "קבלה" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירה" }));
    const args = h.scheduleDeferredEdit.mock.calls[0]![0] as {
      onCommit: () => Promise<{ ok: boolean }>;
    };
    expect(args).toMatchObject({ scope: "project-document", id: "d1", patch: { document_type: "קבלה" } });
    await act(async () => {
      await args.onCommit();
    });
    expect(h.updateDocumentTag).toHaveBeenCalledWith("d1", "קבלה");
    expect(refresh).toHaveBeenCalled();
  });

  it("uploading: needs a file, sends each with the category, then waits for the list to show them", async () => {
    h.offlineUpload.mockResolvedValue({ ok: true, queued: false, data: { document: { id: "d-new" } } });
    const { rerender } = render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "העלאת קובץ או תמונה" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("בחר לפחות קובץ אחד")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "העלאה" })).toBeDisabled();

    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "קבלה" } });
    const file = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(within(dialog).getByText("1 קבצים")).toBeInTheDocument();
    expect(within(dialog).getByText("invoice.pdf", { selector: "div.text-xs" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "העלאה" }));
    });
    expect(h.offlineUpload).toHaveBeenCalledWith("/api/projects/documents/upload", {
      fields: { project_id: "proj-1", category: "קבלה" },
      file,
      label: "invoice.pdf",
    });
    expect(h.toast.loading).toHaveBeenCalledWith("העלאה הושלמה — מעדכן רשימה...", { id: "toast-1" });
    expect(refresh).toHaveBeenCalled();

    // The refreshed page brings the new file — the toast says it's in the list.
    rerender(
      <ProjectTabsClient
        {...props({
          projectDocuments: [
            {
              document_id: "d-new",
              storage_key: null,
              file_name: "invoice.pdf",
              title: null,
              document_type: "קבלה",
              entity_type: "project",
              entity_id: "proj-1",
              uploaded_at: "2026-10-11T09:00:00Z",
              uploaded_by_name: null,
              url: null,
            },
          ],
        })}
      />
    );
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("הקבצים נוספו לרשימה", { id: "toast-1" }));
  });

  it("an upload saved for later (offline) closes the toast without waiting on the list", async () => {
    h.offlineUpload.mockResolvedValue({ ok: true, queued: true });
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "העלאת קובץ או תמונה" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
        target: { files: [new File(["x"], "later.pdf", { type: "application/pdf" })] },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "העלאה" }));
    });
    expect(h.toast.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("a failed upload says so", async () => {
    h.offlineUpload.mockResolvedValue({ ok: false, queued: false, error: "too big" });
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "העלאת קובץ או תמונה" }));
    const dialog = await screen.findByRole("dialog");
    await act(async () => {
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
        target: { files: [new File(["x"], "big.pdf", { type: "application/pdf" })] },
      });
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "העלאה" }));
    });
    expect(h.toast.error).toHaveBeenCalledWith("שגיאה בהעלאת קובץ", { id: "toast-1", description: "too big" });
  });

  it("a missing required document's upload button opens the uploader on that category", async () => {
    h.fetchChecklistForEntity.mockResolvedValue([
      { code: "קבלה", label: "קבלה", present: false, documentId: null, validUntil: null },
    ]);
    render(<ProjectTabsClient {...props()} />);
    fireEvent.click(await screen.findByRole("button", { name: "העלאה" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox")).toHaveValue("קבלה");
  });
});
