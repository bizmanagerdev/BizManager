// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The amount field in ₪, US$ or C$ (owner, 2026-10-23: "a ₪ / $ / C$ choice
// beside the amount … the rate filled in and editable"), chosen by clicking the
// sign in the field (owner, 2026-10-24: "I can't have a separate drop down").

vi.mock("@/components/ui/dropdown-menu", () => import("@/__tests__/mocks/dropdown-menu"));

const lookupFxRate = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({}) }));
vi.mock("@/lib/fx/rate-lookup", () => ({ lookupFxRate: (...args: unknown[]) => lookupFxRate(...args) }));

import { CurrencyAmountInput, typedAmountOf, useMoneyCurrency, type RowCurrency } from "@/components/fx/MoneyCurrency";
import type { CurrencyCode } from "@/lib/fx/currencies";

// What the form would send, as of the last render.
const sent = { body: {} as Record<string, unknown> };

function Harness({
  initial,
  known = true,
  accountCurrency = null,
  preferred = null,
}: {
  initial?: RowCurrency | null;
  known?: boolean;
  accountCurrency?: CurrencyCode | null;
  preferred?: CurrencyCode | null;
}) {
  const [amount, setAmount] = useState(typedAmountOf(initial, 3107));
  const money = useMoneyCurrency({ open: true, initial, known, accountCurrency, preferred, date: "2026-10-24" });
  const body = money.body();
  useEffect(() => {
    sent.body = body;
  });
  return <CurrencyAmountInput money={money} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="סכום" />;
}

/** The sign in the field, as a button: "מטבע: שקל". */
function signButton() {
  return screen.queryByRole("button", { name: /^מטבע: / });
}

/** Click the sign, then the currency. */
function choose(symbol: string) {
  fireEvent.click(signButton()!);
  const item = screen.getAllByRole("menuitem").find((el) => el.querySelector("span")?.textContent === symbol);
  fireEvent.click(item!);
}

beforeEach(() => {
  lookupFxRate.mockReset();
  lookupFxRate.mockResolvedValue({ rate: 3.107, date: "2026-10-22" });
});

describe("CurrencyAmountInput", () => {
  it("shekels by default: ₪, no rate line, and the save says ILS", () => {
    render(<Harness />);
    // The sign in the field is the choice — no other control beside or under it.
    expect(signButton()).toHaveAccessibleName("מטבע: שקל");
    expect(signButton()).toHaveTextContent("₪");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText(/שער יציג/)).toBeNull();
    expect(sent.body).toEqual({ currency: "ILS" });
  });

  it("dollars: the day's rate (Saturday takes Thursday's), its shekels, and the save asks the server for the rate", async () => {
    render(<Harness />);
    choose("$");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(signButton()).toHaveAccessibleName("מטבע: דולר");
    fireEvent.change(screen.getByRole("textbox", { name: "סכום" }), { target: { value: "1000" } });
    await waitFor(() => expect(screen.getByText(/שער יציג/)).toHaveTextContent("שער יציג 3.107 (22/10)"));
    expect(lookupFxRate).toHaveBeenCalledWith({}, "USD", "2026-10-24");
    expect(screen.getByText("≈ ₪3,107")).toBeInTheDocument();
    expect(signButton()).toHaveTextContent("$");
    expect(sent.body).toEqual({ currency: "USD", fx_rate_manual: false });
  });

  it("a rate typed in place of the day's is what it counts, and is sent", async () => {
    render(<Harness />);
    choose("$");
    fireEvent.change(screen.getByRole("textbox", { name: "סכום" }), { target: { value: "1000" } });
    await screen.findByText(/שער יציג/);
    fireEvent.click(screen.getByRole("button", { name: "שינוי השער" }));
    fireEvent.change(screen.getByRole("textbox", { name: "שער" }), { target: { value: "3.05" } });
    expect(screen.getByText("≈ ₪3,050")).toBeInTheDocument();
    expect(sent.body).toEqual({ currency: "USD", fx_rate: 3.05, fx_rate_manual: true });
    fireEvent.click(screen.getByRole("button", { name: /לשער היציג/ }));
    expect(sent.body).toEqual({ currency: "USD", fx_rate_manual: false });
  });

  it("an account kept in dollars fixes the currency, and says so", async () => {
    render(<Harness accountCurrency="USD" />);
    // The sign alone, not a button: it can't be changed.
    expect(signButton()).toBeNull();
    expect(screen.getByTitle("החשבון מתנהל בדולר")).toHaveTextContent("$");
    expect(screen.getByText("החשבון מתנהל בדולר.")).toBeInTheDocument();
  });

  it("no rate for the day: asks for one", async () => {
    lookupFxRate.mockResolvedValue(null);
    render(<Harness />);
    choose("C$");
    expect(await screen.findByText("אין שער יציג לתאריך הזה — יש להקליד את השער")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "שער" })).toBeInTheDocument();
  });

  it("editing a row in dollars: its dollars in the field, its typed rate kept", () => {
    render(<Harness initial={{ currency: "USD", foreign_amount: "1000", fx_rate: "3.05", fx_rate_manual: true }} />);
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("1,000");
    expect(screen.getByRole("textbox", { name: "שער" })).toHaveValue("3.05");
    expect(sent.body).toEqual({ currency: "USD", fx_rate: 3.05, fx_rate_manual: true });
  });

  it("a new row on a Canada building's page starts in C$; one being edited keeps its own", () => {
    render(<Harness preferred="CAD" />);
    expect(signButton()).toHaveAccessibleName("מטבע: דולר קנדי");
    expect(sent.body).toEqual({ currency: "CAD", fx_rate_manual: false });
  });

  it("…an edit of a row in shekels stays in shekels, and an account kept in dollars still wins", () => {
    const { unmount } = render(<Harness preferred="CAD" initial={{ currency: "ILS", foreign_amount: null, fx_rate: null, fx_rate_manual: false }} />);
    expect(signButton()).toHaveAccessibleName("מטבע: שקל");
    unmount();
    render(<Harness preferred="CAD" accountCurrency="USD" />);
    expect(screen.getByTitle("החשבון מתנהל בדולר")).toHaveTextContent("$");
  });

  it("an edit whose page didn't carry the currency: no choice, and the save says nothing about it", () => {
    render(<Harness known={false} />);
    expect(signButton()).toBeNull();
    expect(sent.body).toEqual({});
  });
});
