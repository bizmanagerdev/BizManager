// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

// The dashboard opens on a picture of the board as it last stood on this
// device — put on screen by an inline script in the app's frame, before any
// code runs and before the page's loading screen — and the live board takes
// over the moment it's complete.

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { DashboardPictureFrame, DashboardPictureKeeper } from "@/components/dashboard/DashboardPicture";
import {
  PICTURE_BOX_ID,
  PICTURE_KEY,
  clearPicture,
  pictureHtml,
  pictureScript,
  pictureShowing,
  savePicture,
} from "@/lib/dashboard/picture";

const html = document.documentElement;

function boardElement(markup: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  const board = holder.firstElementChild as HTMLElement;
  // jsdom lays nothing out: give the board a place on the page.
  board.getBoundingClientRect = () => ({ left: 12, top: 80, width: 360, height: 600 }) as DOMRect;
  return board;
}

/** Runs the frame's inline script the way the browser does: after its box. */
function runScript(userId: string) {
  const box = document.createElement("div");
  box.id = PICTURE_BOX_ID;
  document.body.append(box);
  new Function(pictureScript(userId))();
  return box;
}

function reset() {
  localStorage.clear();
  document.body.innerHTML = "";
  html.removeAttribute("data-dashboard-picture");
  window.history.pushState({}, "", "/dashboard");
  nav.pathname = "/dashboard";
}

describe("the dashboard's picture", () => {
  beforeEach(reset);

  it("is plain HTML: nothing that runs, no ids that would clash with the live page, no margins", () => {
    const markup = pictureHtml(
      boardElement(
        '<div data-dashboard-board class="-mt-2" style="margin-top:-8px"><section id="today"><img src="a.png" onerror="alert(1)"><script>x()</script><b>שלום</b></section></div>'
      )
    );
    expect(markup).not.toContain("script");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain('id="today"');
    expect(markup).not.toContain("data-dashboard-board");
    expect(markup).toContain("margin: 0px");
    expect(markup).toContain("<b>שלום</b>");
  });

  it("the script puts this person's picture where the board was, under a week old, at the same window width, on the dashboard only", () => {
    savePicture("u1", boardElement("<div data-dashboard-board><p>הלוח</p></div>"));
    let box = runScript("u1");
    expect(box.innerHTML).toContain("הלוח");
    expect(box.style.left).toBe("12px");
    expect(box.style.top).toBe("80px");
    expect(box.style.width).toBe("360px");
    expect(pictureShowing()).toBe(true);

    reset();
    savePicture("u1", boardElement("<div data-dashboard-board><p>הלוח</p></div>"));
    // Someone else's picture: nothing.
    expect(runScript("u2").innerHTML).toBe("");
    // Another page: nothing.
    window.history.pushState({}, "", "/tasks");
    expect(runScript("u1").innerHTML).toBe("");
    window.history.pushState({}, "", "/dashboard");
    // Another window width (the board would be laid out differently): nothing.
    const stored = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, vw: window.innerWidth + 100 }));
    expect(runScript("u1").innerHTML).toBe("");
    // Too old: nothing.
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, t: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    box = runScript("u1");
    expect(box.innerHTML).toBe("");
    expect(pictureShowing()).toBe(false);
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

  it("a board that's off the page isn't kept (nowhere to put it)", () => {
    const board = boardElement("<div data-dashboard-board></div>");
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;
    savePicture("u1", board);
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
  });
});

describe("the hand-over and the keeping", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  /** As the script leaves the page: the picture up, the live board beneath. */
  function showPicture() {
    const box = document.createElement("div");
    box.id = PICTURE_BOX_ID;
    box.innerHTML = "<p>התמונה</p>";
    document.body.append(box);
    html.setAttribute("data-dashboard-picture", "");
    return box;
  }

  function Board({ loading }: { loading: boolean }) {
    return (
      <>
        <DashboardPictureKeeper userId="u1" />
        <div data-dashboard-board>{loading ? <div data-skeleton="" /> : <p>היום: 3 משימות</p>}</div>
      </>
    );
  }

  it("the live board takes over the moment it's complete, and is kept for next time once it settles", async () => {
    const box = showPicture();
    const { rerender, container } = render(<Board loading />);
    const board = container.querySelector<HTMLElement>("[data-dashboard-board]")!;
    board.getBoundingClientRect = () => ({ left: 0, top: 70, width: 400, height: 500 }) as DOMRect;
    expect(pictureShowing()).toBe(true); // still loading: the picture stays

    rerender(<Board loading={false} />);
    await act(async () => {}); // the board's change is noticed
    expect(pictureShowing()).toBe(false);
    expect(box.innerHTML).toBe("");
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();

    await act(async () => vi.advanceTimersByTime(1600));
    const kept = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    expect(kept.h).toContain("היום: 3 משימות");
    expect(kept.y).toBe(70);
  });

  it("never keeps a board that's still loading; a tap hands over at once", async () => {
    showPicture();
    render(<Board loading />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
    document.dispatchEvent(new Event("pointerdown"));
    expect(pictureShowing()).toBe(false);
  });

  it("5 seconds without a complete board: the live one shows anyway", async () => {
    showPicture();
    render(<Board loading />);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(pictureShowing()).toBe(false);
  });

  it("kept when the app goes to the background, and when the dashboard is left", async () => {
    const { container, unmount } = render(<Board loading={false} />);
    const board = container.querySelector<HTMLElement>("[data-dashboard-board]")!;
    board.getBoundingClientRect = () => ({ left: 0, top: 70, width: 400, height: 500 }) as DOMRect;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
    expect(JSON.parse(localStorage.getItem(PICTURE_KEY)!).u).toBe("u1");

    localStorage.clear();
    unmount();
    expect(JSON.parse(localStorage.getItem(PICTURE_KEY)!).u).toBe("u1");
  });

  it("the app moved off the dashboard before it was drawn: the frame takes the picture down", () => {
    const box = showPicture();
    nav.pathname = "/tasks";
    render(<DashboardPictureFrame userId="u1" />);
    expect(pictureShowing()).toBe(false);
    expect(box.innerHTML).toBe("");
  });
});

describe("React and the picture the script put in", () => {
  it("hydrating the frame leaves the picture alone — no mismatch, nothing redrawn", async () => {
    reset();
    savePicture("u1", boardElement("<div data-dashboard-board><p>התמונה</p></div>"));
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const tree = <DashboardPictureFrame userId="u1" />;

    // The server's HTML; the script runs as the browser reads it.
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const box = document.getElementById(PICTURE_BOX_ID)!;
    new Function(container.querySelector("script")!.textContent ?? "")();
    expect(box.innerHTML).toContain("התמונה");

    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(document.getElementById(PICTURE_BOX_ID)).toBe(box);
    expect(box.innerHTML).toContain("התמונה");
    expect(pictureShowing()).toBe(true);
  });
});
