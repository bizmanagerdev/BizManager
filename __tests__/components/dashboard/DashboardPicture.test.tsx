// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";
import DashboardPicture from "@/components/dashboard/DashboardPicture";
import { PICTURE_KEY, clearPicture, pictureHtml, pictureScript, savePicture } from "@/lib/dashboard/picture";

// The dashboard opens on a picture of the board as it last stood on this
// device — put on screen by an inline script before any code runs — and the
// live board takes over the moment it's complete.

function boardElement(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.firstElementChild as HTMLElement;
}

/** Runs the inline script the way the browser does: right after its box. */
function runScript(userId: string) {
  const holder = document.createElement("div");
  const box = document.createElement("div");
  const script = document.createElement("script");
  holder.append(box, script);
  document.body.append(holder);
  const current = vi.spyOn(document, "currentScript", "get").mockReturnValue(script);
  new Function(pictureScript(userId))();
  current.mockRestore();
  return { holder, box };
}

describe("the dashboard's picture", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/dashboard");
  });

  it("is plain HTML: nothing that runs, no ids that would clash with the live page, no pulled-up margin", () => {
    const html = pictureHtml(
      boardElement(
        '<div data-dashboard-board class="-mt-2" style="margin-top:-8px"><section id="today"><img src="a.png" onerror="alert(1)"><script>x()</script><b>שלום</b></section></div>'
      )
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('id="today"');
    expect(html).not.toContain("data-dashboard-board");
    expect(html).toContain("margin-top: 0px");
    expect(html).toContain("<b>שלום</b>");
  });

  it("the script shows this person's picture, under a week old, on the dashboard only", () => {
    savePicture("u1", boardElement('<div data-dashboard-board><p>הלוח</p></div>'));
    let shown = runScript("u1");
    expect(shown.box.innerHTML).toContain("הלוח");
    expect(shown.holder.hasAttribute("data-picture-showing")).toBe(true);

    // Someone else's picture: nothing.
    shown = runScript("u2");
    expect(shown.box.innerHTML).toBe("");
    expect(shown.holder.hasAttribute("data-picture-showing")).toBe(false);

    // Another page (the script is the dashboard's, but just in case): nothing.
    window.history.pushState({}, "", "/tasks");
    expect(runScript("u1").box.innerHTML).toBe("");
    window.history.pushState({}, "", "/dashboard");

    // Too old: nothing.
    const stored = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, t: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(runScript("u1").box.innerHTML).toBe("");
  });

  it("goes at logout, and when someone else signs in", () => {
    savePicture("u1", boardElement("<div data-dashboard-board></div>"));
    clearPicture("u1");
    expect(localStorage.getItem(PICTURE_KEY)).not.toBeNull();
    clearPicture("u2");
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
    savePicture("u1", boardElement("<div data-dashboard-board></div>"));
    clearPicture();
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
  });
});

describe("DashboardPicture: the hand-over and the keeping", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  function Board({ loading }: { loading: boolean }) {
    return (
      // As the script leaves it: the picture showing over the hidden live board.
      <div data-testid="holder" data-picture-showing="">
        <DashboardPicture userId="u1" />
        <div data-dashboard-board>{loading ? <div data-skeleton="" /> : <p>היום: 3 משימות</p>}</div>
      </div>
    );
  }

  it("the live board takes over the moment it's complete, and is kept for next time once it settles", async () => {
    const { getByTestId, rerender } = render(<Board loading />);
    const holder = getByTestId("holder");
    expect(holder.hasAttribute("data-picture-showing")).toBe(true); // still loading: the picture stays

    rerender(<Board loading={false} />);
    await act(async () => {}); // the board's change is noticed
    expect(holder.hasAttribute("data-picture-showing")).toBe(false);
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();

    await act(async () => vi.advanceTimersByTime(1600));
    expect(JSON.parse(localStorage.getItem(PICTURE_KEY)!).h).toContain("היום: 3 משימות");
  });

  it("never keeps a board that's still loading; a tap or 5 seconds hand over anyway", async () => {
    const { getByTestId } = render(<Board loading />);
    const holder = getByTestId("holder");
    await act(async () => vi.advanceTimersByTime(2000));
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();

    holder.dispatchEvent(new Event("pointerdown"));
    expect(holder.hasAttribute("data-picture-showing")).toBe(false);
  });

  it("5 seconds without a complete board: the live one shows anyway", async () => {
    const { getByTestId } = render(<Board loading />);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(getByTestId("holder").hasAttribute("data-picture-showing")).toBe(false);
  });

  it("kept when the app goes to the background", async () => {
    render(<Board loading={false} />);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
    expect(JSON.parse(localStorage.getItem(PICTURE_KEY)!).u).toBe("u1");
  });
});

describe("React and the picture the script put in", () => {
  it("hydrating the page leaves the picture alone — no mismatch, nothing redrawn", async () => {
    vi.useRealTimers();
    localStorage.clear();
    window.history.pushState({}, "", "/dashboard");
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const tree = (
      <div data-testid="holder" suppressHydrationWarning>
        <DashboardPicture userId="u1" />
        <div data-dashboard-board>
          <div data-skeleton="" />
        </div>
      </div>
    );
    savePicture("u1", boardElement('<div data-dashboard-board><p>התמונה</p></div>'));

    // The server's HTML, then the script runs as the browser reads it.
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const holder = container.firstElementChild as HTMLElement;
    const [box, script] = [...holder.children] as HTMLElement[];
    const current = vi.spyOn(document, "currentScript", "get").mockReturnValue(script as HTMLScriptElement);
    new Function(script.textContent ?? "")();
    current.mockRestore();
    expect(box.innerHTML).toContain("התמונה");

    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    // Still loading underneath: the picture is still up, untouched by React.
    expect(holder.firstElementChild).toBe(box);
    expect(box.innerHTML).toContain("התמונה");
    expect(holder.hasAttribute("data-picture-showing")).toBe(true);
  });
});
