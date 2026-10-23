// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The amount field in ₪, US$ or C$ (owner, 2026-10-23: "a ₪ / $ / C$ choice
// beside the amount … the rate filled in and editable").

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
}: {
  initial?: RowCurrency | null;
  known?: boolean;
  accountCurrency?: CurrencyCode | null;
}) {
  const [amount, setAmount] = useState(typedAmountOf(initial, 3107));
  const money = useMoneyCurrency({ open: true, initial, known, accountCurrency, date: "2026-10-24" });
  const body = money.body();
  useEffect(() => {
    sent.body = body;
  });
  return <CurrencyAmountInput money={money} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="סכום" />;
}

beforeEach(() => {
  lookupFxRate.mockReset();
  lookupFxRate.mockResolvedValue({ rate: 3.107, date: "2026-10-22" });
});

describe("CurrencyAmountInput", () => {
  it("shekels by default: ₪, no rate line, and the save says ILS", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "מטבע" })).toHaveValue("ILS");
    // The marker inside the field (the select's option says it too).
    expect(screen.getAllByText("₪").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(screen.queryByText(/שער יציג/)).toBeNull();
    expect(sent.body).toEqual({ currency: "ILS" });
  });

  it("dollars: the day's rate (Saturday takes Thursday's), its shekels, and the save asks the server for the rate", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "מטבע" }), { target: { value: "USD" } });
    fireEvent.change(screen.getByRole("textbox", { name: "סכום" }), { target: { value: "1000" } });
    await waitFor(() => expect(screen.getByText(/שער יציג/)).toHaveTextContent("שער יציג 3.107 (22/10)"));
    expect(lookupFxRate).toHaveBeenCalledWith({}, "USD", "2026-10-24");
    expect(screen.getByText("≈ ₪3,107")).toBeInTheDocument();
    expect(screen.getAllByText("$").some((el) => el.tagName === "SPAN")).toBe(true);
    expect(sent.body).toEqual({ currency: "USD", fx_rate_manual: false });
  });

  it("a rate typed in place of the day's is what it counts, and is sent", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "מטבע" }), { target: { value: "USD" } });
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
    expect(screen.getByRole("combobox", { name: "מטבע" })).toHaveValue("USD");
    expect(screen.getByRole("combobox", { name: "מטבע" })).toBeDisabled();
    expect(screen.getByText("החשבון מתנהל בדולר.")).toBeInTheDocument();
  });

  it("no rate for the day: asks for one", async () => {
    lookupFxRate.mockResolvedValue(null);
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "מטבע" }), { target: { value: "CAD" } });
    expect(await screen.findByText("אין שער יציג לתאריך הזה — יש להקליד את השער")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "שער" })).toBeInTheDocument();
  });

  it("editing a row in dollars: its dollars in the field, its typed rate kept", () => {
    render(<Harness initial={{ currency: "USD", foreign_amount: "1000", fx_rate: "3.05", fx_rate_manual: true }} />);
    expect(screen.getByRole("textbox", { name: "סכום" })).toHaveValue("1,000");
    expect(screen.getByRole("textbox", { name: "שער" })).toHaveValue("3.05");
    expect(sent.body).toEqual({ currency: "USD", fx_rate: 3.05, fx_rate_manual: true });
  });

  it("an edit whose page didn't carry the currency: no choice, and the save says nothing about it", () => {
    render(<Harness known={false} />);
    expect(screen.queryByRole("combobox", { name: "מטבע" })).toBeNull();
    expect(sent.body).toEqual({});
  });
});
