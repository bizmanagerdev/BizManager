// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
