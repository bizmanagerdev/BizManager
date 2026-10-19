// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { clearSharedSearch, readSharedSearch, useSharedSearch } from "@/lib/ui/shared-search";

// One search box for a section's tabs (owner, 2026-10-19: "if I type in one
// tab it should last in the other tab … same for projects").

afterEach(() => {
  cleanup();
  clearSharedSearch("orders:");
  vi.useRealTimers();
});

function SearchBox({ id, initial = "" }: { id: string; initial?: string }) {
  const [value, setValue] = useSharedSearch("orders:", initial, "/sales");
  return <input aria-label={id} value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("useSharedSearch", () => {
  it("what's typed in one tab is there in the next one", () => {
    const first = render(<SearchBox id="open" />);
    fireEvent.change(screen.getByLabelText("open"), { target: { value: "1447" } });
    first.unmount();
    render(<SearchBox id="closed" />);
    expect((screen.getByLabelText("closed") as HTMLInputElement).value).toBe("1447");
  });

  it("two boxes on screen (desktop and the phone's top bar) stay in step", () => {
    render(
      <>
        <SearchBox id="desktop" />
        <SearchBox id="mobile" />
      </>
    );
    fireEvent.change(screen.getByLabelText("mobile"), { target: { value: "כהן" } });
    expect((screen.getByLabelText("desktop") as HTMLInputElement).value).toBe("כהן");
  });

  it("a search in the address starts the box when nothing was typed yet", () => {
    render(<SearchBox id="box" initial="משכנתא" />);
    expect((screen.getByLabelText("box") as HTMLInputElement).value).toBe("משכנתא");
  });

  it("is dropped once the section is left", () => {
    vi.useFakeTimers();
    const view = render(<SearchBox id="box" />);
    fireEvent.change(screen.getByLabelText("box"), { target: { value: "1447" } });
    window.history.pushState(null, "", "/dashboard");
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(readSharedSearch("orders:")).toBeUndefined();
  });

  it("is kept when the next page is in the same section", () => {
    vi.useFakeTimers();
    const view = render(<SearchBox id="box" />);
    fireEvent.change(screen.getByLabelText("box"), { target: { value: "1447" } });
    window.history.pushState(null, "", "/sales?tab=closed");
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(readSharedSearch("orders:")).toBe("1447");
  });
});
