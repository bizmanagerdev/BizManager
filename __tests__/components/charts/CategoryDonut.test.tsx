// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CategoryDonut from "@/components/charts/CategoryDonut";

// The property page's expenses donut (owner, 2026-10-21: the floating tooltip
// covered the total in the middle). Pointing at a category — its slice, its
// row, or the row by keyboard — shows that one in the middle, value first;
// leaving it, the total again.

const ILS = (n: number) => new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 }).format(n);
const data = [
  { label: "רכישה", value: 715856 },
  { label: "נכסים משכנתא", value: 16817 },
];

describe("the expenses donut's middle", () => {
  it("the total, then the category pointed at, then the total again", () => {
    render(<CategoryDonut data={data} />);
    expect(screen.getByText("סה״כ")).toBeInTheDocument();
    const row = screen.getByText("נכסים משכנתא").closest("li") as HTMLElement;
    fireEvent.mouseEnter(row);
    expect(screen.queryByText("סה״כ")).not.toBeInTheDocument();
    // The row and the middle.
    const amounts = [...document.querySelectorAll("span")].filter((el) => el.textContent === ILS(16817));
    expect(amounts).toHaveLength(2);
    // Its share, under its name (and in its row).
    expect(screen.getAllByText("2%")).toHaveLength(2);
    fireEvent.mouseLeave(row);
    expect(screen.getByText("סה״כ")).toBeInTheDocument();
  });

  it("the same by keyboard", () => {
    render(<CategoryDonut data={data} />);
    const row = screen.getByText("רכישה").closest("li") as HTMLElement;
    fireEvent.focus(row);
    expect(screen.queryByText("סה״כ")).not.toBeInTheDocument();
    fireEvent.blur(row);
    expect(screen.getByText("סה״כ")).toBeInTheDocument();
  });
});

describe("a category chosen (the property page filters its table to it, owner 2026-10-22)", () => {
  it("a click on its row chooses it — with the categories it stands for — and again lets it go", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<CategoryDonut data={data} onSelect={onSelect} />);
    const row = screen.getByRole("button", { name: /נכסים משכנתא/ });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: "נכסים משכנתא", members: ["נכסים משכנתא"] }));
    // Chosen: it stays in the middle, and its row says so.
    rerender(<CategoryDonut data={data} onSelect={onSelect} selected="נכסים משכנתא" />);
    expect(screen.queryByText("סה״כ")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /נכסים משכנתא/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByRole("button", { name: /נכסים משכנתא/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("אחר stands for every category in it", () => {
    const onSelect = vi.fn();
    const many = ["א", "ב", "ג", "ד", "ה", "ו", "ז"].map((label, i) => ({ label, value: 700 - i * 100 }));
    render(<CategoryDonut data={many} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /אחר/ }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: "אחר", members: ["ו", "ז"] }));
  });

  it("without onSelect the rows only read out — nothing to press", () => {
    render(<CategoryDonut data={data} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
