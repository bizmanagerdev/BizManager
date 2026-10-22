// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// A property's expense (owner, 2026-10-22): its categories only — no "אחר" —
// one saved before with another (a card's name) kept as a choice until it's
// changed; and one paid by card needs no account — the card's monthly bank
// charge is the money leaving, so an account would lose it twice.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const { offlineFetch } = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (_url: string, body: Record<string, unknown>) => ({ ok: true, data: { expense: { id: body.id } } })),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: vi.fn() }));
vi.mock("@/components/tags/TagPicker", () => ({ TagPicker: () => null, fetchExistingTagIds: async () => [] }));
const ACCOUNTS = [
  { id: "acc-bank", name: "מזרחי בית", kind: "bank", isActive: true },
  { id: "acc-cash", name: "מזומן", kind: "cash", isActive: true },
];
vi.mock("@/components/financial/AccountSelect", async () => {
  const React = await import("react");
  function AccountSelect({
    value,
    onChange,
    onLoaded,
  }: {
    value: string;
    onChange: (v: string) => void;
    onLoaded?: (a: unknown[]) => void;
  }) {
    React.useEffect(() => onLoaded?.(ACCOUNTS), []); // eslint-disable-line react-hooks/exhaustive-deps
    return (
      <select aria-label="חשבון" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {ACCOUNTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );
  }
  return { loadAccounts: async () => ACCOUNTS, default: AccountSelect };
});
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
);

import { ExpenseDialog } from "@/components/expenses/ExpenseDialog";
import { EXPENSE_PROPERTY_CATEGORIES } from "@/lib/expenses";

afterEach(() => {
  cleanup();
  offlineFetch.mockClear();
});

const CARD_EXPENSE = {
  id: "exp-1",
  amount: 1035,
  category: "ויזה כאל זהב 9557",
  description: "ACE",
  expense_date: "2026-09-10",
  business_domain: "property_management",
  payment_status: "paid",
  payment_method: "credit_card",
  account_id: null,
  property_id: "prop-rival",
};

async function open() {
  await act(async () => {
    render(
      <ExpenseDialog open onOpenChange={vi.fn()} editingExpense={CARD_EXPENSE} lockedPropertyId="prop-rival" onSaved={vi.fn()} />,
    );
  });
}

const categorySelect = () =>
  screen
    .getAllByRole("combobox")
    .find((el) => [...(el as HTMLSelectElement).options].some((o) => o.value === "משכנתא")) as HTMLSelectElement;

describe("a property's expense", () => {
  it("offers a property's categories only — no אחר — and keeps the card's name it came with, marked", async () => {
    await open();
    const options = [...categorySelect().options].map((o) => o.value).filter(Boolean);
    expect(options).toEqual([...EXPENSE_PROPERTY_CATEGORIES, "ויזה כאל זהב 9557"]);
    expect(options).toContain("תיקונים");
    expect(options).toContain("רכישת הנכס");
    expect(options).not.toContain("אחר");
    expect(screen.getByText("הקטגוריה הזו לא מהרשימה של נכס — כדאי לבחור אחת מהרשימה.")).toBeInTheDocument();
  });

  it("paid by card: its category changed and saved with no account — none is asked for", async () => {
    await open();
    expect(screen.getByText(/שולם בכרטיס אשראי — אין צורך בחשבון/)).toBeInTheDocument();
    fireEvent.change(categorySelect(), { target: { value: "תיקונים" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /שמירה|עדכון/ }));
    });
    expect(offlineFetch).toHaveBeenCalledWith(
      "/api/expenses/update",
      expect.objectContaining({ id: "exp-1", category: "תיקונים", account_id: null, payment_method: "credit_card" }),
      "עדכון הוצאה",
    );
  });
});
