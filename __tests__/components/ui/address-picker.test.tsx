// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

// Radix positions the list with real layout; in jsdom that takes ~35 s a
// render. The list's behaviour is what's under test, so it's drawn in place.
vi.mock("@radix-ui/react-popover", async () => {
  const React = await import("react");
  type P = { children?: React.ReactNode };
  const Open = React.createContext(false);
  return {
    Root: ({ open, children }: P & { open?: boolean }) => <Open.Provider value={Boolean(open)}>{children}</Open.Provider>,
    Anchor: ({ children }: P) => <>{children}</>,
    Portal: ({ children }: P) => <>{children}</>,
    Content: ({ children }: P) => (React.useContext(Open) ? <div>{children}</div> : null),
  };
});

import { AddressPicker } from "@/components/ui/address-picker";
import type { StructuredAddress } from "@/lib/address/structured";

// The address field on every screen: typing asks Google (through
// /api/places/*), only a picked address is saved, a street asks for its
// number, a settlement is allowed but marked, and the field can be cleared.

const YECHEZKEL: StructuredAddress = {
  city: "בית שמש",
  street: "יחזקאל הנביא",
  houseNumber: "27",
  unit: "",
  lat: 31.7037704,
  lng: 34.9863334,
  placeId: "ChIJ-yechezkel",
  formatted: "יחזקאל הנביא 27, בית שמש",
};

type Route = (body: Record<string, unknown>) => unknown;
let autocomplete: Route;
let details: Route;
const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const answer = url.endsWith("/autocomplete") ? autocomplete(body) : details(body);
      return new Response(JSON.stringify(answer), { status: 200 });
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = null, onChange }: { initial?: StructuredAddress | null; onChange?: (a: StructuredAddress | null) => void }) {
  const [value, setValue] = useState<StructuredAddress | null>(initial);
  return (
    <AddressPicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const box = () => screen.getByRole("combobox", { name: "כתובת" });
function type(text: string) {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: text } });
}

describe("AddressPicker", () => {
  it("suggests addresses as you type, and saves the one picked, with its parts and point", async () => {
    autocomplete = () => ({
      suggestions: [{ placeId: "ChIJ-yechezkel", main: "יחזקאל הנביא 27", secondary: "בית שמש, ישראל", kind: "address" }],
    });
    details = () => ({ address: YECHEZKEL });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type("יחזקאל הנביא 27");
    fireEvent.click(await screen.findByRole("option", { name: /יחזקאל הנביא 27/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(YECHEZKEL));
    // Suggestions and the pick share one session: Google bills them as one.
    expect(calls[0].body.sessionToken).toBe(calls[1].body.sessionToken);
    // Picked: the line, and the unit box beside it.
    expect(screen.getByText("יחזקאל הנביא 27, בית שמש")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("דירה / כניסה / קומה (לא חובה)"), { target: { value: "בחניה" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...YECHEZKEL, unit: "בחניה" });
  });

  it("Enter picks the top suggestion and doesn't move the form on", async () => {
    autocomplete = () => ({
      suggestions: [{ placeId: "ChIJ-yechezkel", main: "יחזקאל הנביא 27", secondary: "בית שמש", kind: "address" }],
    });
    details = () => ({ address: YECHEZKEL });
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    const onChange = vi.fn();
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Harness onChange={onChange} />
      </form>
    );
    type("יחזקאל");
    await screen.findByRole("option", { name: /יחזקאל הנביא 27/ });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(YECHEZKEL));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a street asks for its number, then finds that exact address", async () => {
    autocomplete = (body) =>
      String(body.input).includes("8")
        ? { suggestions: [{ placeId: "ChIJ-chazon-8", main: "חזון איש 8", secondary: "בני ברק", kind: "address" }] }
        : { suggestions: [{ placeId: "ChIJ-chazon", main: "חזון איש", secondary: "בני ברק", kind: "street" }] };
    details = (body) =>
      body.placeId === "ChIJ-chazon"
        ? { address: { ...YECHEZKEL, city: "בני ברק", street: "חזון איש", houseNumber: "", placeId: "ChIJ-chazon" } }
        : { address: { ...YECHEZKEL, city: "בני ברק", street: "חזון איש", houseNumber: "8", placeId: "ChIJ-chazon-8", lat: 32.08 } };
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type("חזון איש");
    fireEvent.click(await screen.findByRole("option", { name: /חזון איש/ }));
    const number = await screen.findByLabelText("מספר בית");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(number, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ street: "חזון איש", houseNumber: "8", lat: 32.08 })));
  });

  it("a number Google doesn't know keeps the typed number, without a wrong point", async () => {
    autocomplete = (body) =>
      String(body.input).includes("999")
        ? { suggestions: [] }
        : { suggestions: [{ placeId: "ChIJ-chazon", main: "חזון איש", secondary: "בני ברק", kind: "street" }] };
    details = () => ({ address: { ...YECHEZKEL, city: "בני ברק", street: "חזון איש", houseNumber: "", lat: 32.0 } });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type("חזון איש");
    fireEvent.click(await screen.findByRole("option", { name: /חזון איש/ }));
    fireEvent.change(await screen.findByLabelText("מספר בית"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ street: "חזון איש", houseNumber: "999", lat: null, lng: null }))
    );
    expect(await screen.findByText(/Google לא מכיר את מספר הבית הזה/)).toBeInTheDocument();
  });

  it("a settlement on its own is allowed, marked as not a full address", async () => {
    autocomplete = () => ({ suggestions: [{ placeId: "ChIJ-aluma", main: "אלומה", secondary: "ישראל", kind: "settlement" }] });
    details = () => ({ address: { ...YECHEZKEL, city: "אלומה", street: "", houseNumber: "", placeId: "ChIJ-aluma" } });
    render(<Harness />);
    type("אלומה");
    fireEvent.click(await screen.findByRole("option", { name: /אלומה/ }));
    expect(await screen.findByText("נבחר יישוב בלבד, בלי רחוב ומספר בית.")).toBeInTheDocument();
  });

  it("a saved address shows as picked; ✕ clears it to no address", () => {
    const onChange = vi.fn();
    render(<Harness initial={YECHEZKEL} onChange={onChange} />);
    expect(screen.getByText("יחזקאל הנביא 27, בית שמש")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניקוי הכתובת" }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(box()).toBeInTheDocument();
  });

  it("'שינוי' searches again, starting from the saved line; cancelling keeps it", () => {
    render(<Harness initial={YECHEZKEL} />);
    fireEvent.click(screen.getByRole("button", { name: "שינוי" }));
    expect(box()).toHaveValue("יחזקאל הנביא 27, בית שמש");
    fireEvent.click(screen.getByRole("button", { name: "ביטול, להשאיר את הכתובת הקודמת" }));
    expect(screen.getByText("יחזקאל הנביא 27, בית שמש")).toBeInTheDocument();
  });

  it("an address saved before the picker is shown, and 'חיפוש הכתובת הזו' searches for it street first", async () => {
    autocomplete = () => ({
      suggestions: [{ placeId: "ChIJ-yechezkel", main: "יחזקאל הנביא 27", secondary: "בית שמש", kind: "address" }],
    });
    render(<AddressPicker value={null} onChange={() => {}} legacyText="בית שמש | יחזקאל הנביא 27 בחניה" />);
    expect(screen.getByText("בית שמש, יחזקאל הנביא 27 בחניה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חיפוש הכתובת הזו" }));
    expect(box()).toHaveValue("יחזקאל הנביא 27 בחניה בית שמש");
    await screen.findByRole("option", { name: /יחזקאל הנביא 27/ });
    expect(calls[0].body.input).toBe("יחזקאל הנביא 27 בחניה בית שמש");
  });

  it("shows Google being down as a sentence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע." }), { status: 502 }))
    );
    render(<Harness />);
    type("יחזקאל");
    expect(await screen.findByText("חיפוש הכתובות לא זמין כרגע. נסו שוב בעוד רגע.")).toBeInTheDocument();
  });
});
