// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  FilterLoadingDots,
  SelectField,
  SummaryCard,
  sourceKindLabel,
  sourceTypeTitle,
  stageLabel,
  stageVariant,
  typeAmountClass,
  typeLabel,
  typeVariant,
} from "@/app/(app)/financial/FinancialPage.ui";

describe("label/variant helpers", () => {
  it("sourceKindLabel / sourceTypeTitle map a source kind to its Hebrew word", () => {
    expect(sourceKindLabel("project")).toBe("פרויקט");
    expect(sourceKindLabel("property")).toBe("נכס");
    expect(sourceKindLabel("order")).toBe("הזמנה");
    expect(sourceKindLabel(null)).toBe("מקור");
    expect(sourceTypeTitle("project")).toBe("פרויקט");
  });

  it("stageLabel / stageVariant map an entry stage to its label and badge variant", () => {
    expect(stageLabel("scheduled")).toBe("צפוי");
    expect(stageVariant("scheduled")).toBe("info-outline");
    expect(stageLabel("pending")).toBe("ממתין");
    expect(stageVariant("pending")).toBe("warning-outline");
    expect(stageLabel("posted")).toBe("בפועל");
    expect(stageVariant("posted")).toBe("success-outline");
  });

  it("typeLabel / typeVariant / typeAmountClass distinguish inflow from outflow", () => {
    expect(typeLabel("inflow")).toBe("כניסה");
    expect(typeVariant("inflow")).toBe("success-outline");
    expect(typeAmountClass("inflow")).toBe("text-success");
    expect(typeLabel("outflow")).toBe("יציאה");
    expect(typeVariant("outflow")).toBe("destructive-outline");
    expect(typeAmountClass("outflow")).toBe("text-destructive");
  });
});

describe("SummaryCard", () => {
  it("renders the title, value and description", () => {
    render(<SummaryCard title="הכנסות" value="₪10,000" description="החודש" />);
    expect(screen.getByText("הכנסות")).toBeInTheDocument();
    expect(screen.getByText("₪10,000")).toBeInTheDocument();
    expect(screen.getByText("החודש")).toBeInTheDocument();
  });

  it("tints the value by accent", () => {
    render(<SummaryCard title="רווח" value="₪500" description="" accent="success" />);
    expect(screen.getByText("₪500").className).toContain("text-success");
  });
});

describe("SelectField", () => {
  it("renders the label and forwards value/onChange to the underlying select", () => {
    const onChange = vi.fn();
    render(
      <SelectField label="תצוגה" value="month" onChange={onChange}>
        <option value="month">חודש</option>
        <option value="year">שנה</option>
      </SelectField>
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("month");
    fireEvent.change(select, { target: { value: "year" } });
    expect(onChange).toHaveBeenCalledWith("year");
  });
});

describe("FilterLoadingDots", () => {
  it("renders as an aria-live loading indicator", () => {
    render(<FilterLoadingDots />);
    expect(screen.getByLabelText("טוען נתונים פיננסיים")).toBeInTheDocument();
  });
});
