// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

// The dashboard opens on a picture of its whole screen as it last stood on
// this device — put up over everything by an inline script in the app's
// frame, before any code runs and before the page's loading screen — and the
// live screen takes over the moment it looks the same.

const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { DashboardPictureFrame, DashboardPictureKeeper } from "@/components/dashboard/DashboardPicture";
import { formatToday, greetingForHour } from "@/lib/dashboard/greeting";
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

function screenElement(markup: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = markup;
  return holder.firstElementChild as HTMLElement;
}

/** A screen as the app draws it: the top bar's greeting, the board with today's date. */
function liveScreen(greeting = "בוקר טוב", date = formatToday(new Date(), "he"), extra = "") {
  return screenElement(
    `<div data-app-screen><header><span data-dashboard-greeting=""><span data-greeting-text="">${greeting}</span><span> 👋</span></span></header>` +
      `<main><div data-dashboard-board><h3>${date}</h3><p>הלוח</p>${extra}</div></main></div>`
  );
}

/** Runs the frame's inline script the way the browser does: after its box. */
function runScript(userId: string) {
  const box = document.createElement("div");
  box.id = PICTURE_BOX_ID;
  document.body.append(box);
  new Function(pictureScript(userId, "he"))();
  return box;
}

function reset() {
  localStorage.clear();
  document.body.innerHTML = "";
  html.removeAttribute("data-dashboard-picture");
  window.history.pushState({}, "", "/dashboard");
  window.scrollTo = () => {};
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  nav.pathname = "/dashboard";
}

describe("the dashboard's picture", () => {
  beforeEach(reset);

  it("is plain HTML: nothing that runs, no ids that would clash with the live page", () => {
    const markup = pictureHtml(
      screenElement(
        '<div data-app-screen><div id="page-header-toolbar"></div><img src="a.png" onerror="alert(1)"><script>x()</script><b>שלום</b></div>'
      )
    );
    expect(markup).not.toContain("script");
    expect(markup).not.toContain("onerror");
    expect(markup).not.toContain("page-header-toolbar");
    expect(markup).not.toContain("data-app-screen");
    expect(markup).toContain("<b>שלום</b>");
  });

  it("the script puts this person's picture over the whole screen — the greeting and date brought up to now", () => {
    savePicture("u1", liveScreen("ערב טוב", "יום שלישי, 6 באוקטובר 2026"), "he");
    const stored = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    // As if kept last night: that evening's greeting and yesterday's date.
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, g: "ערב טוב", d: "יום שלישי, 6 באוקטובר 2026" }));

    const box = runScript("u1");
    expect(pictureShowing()).toBe(true);
    expect(box.innerHTML).toContain("הלוח");
    expect(box.textContent).toContain(greetingForHour(new Date().getHours(), "he"));
    expect(box.textContent).toContain(formatToday(new Date(), "he"));
    expect(box.textContent).not.toContain("6 באוקטובר");
  });

  it("only this person's, under a week old, at the same window size, on the dashboard", () => {
    savePicture("u1", liveScreen(), "he");
    expect(runScript("u2").innerHTML).toBe("");
    window.history.pushState({}, "", "/tasks");
    expect(runScript("u1").innerHTML).toBe("");
    window.history.pushState({}, "", "/dashboard");
    const stored = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, vw: window.innerWidth + 100 }));
    expect(runScript("u1").innerHTML).toBe("");
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, vh: window.innerHeight + 50 }));
    expect(runScript("u1").innerHTML).toBe("");
    localStorage.setItem(PICTURE_KEY, JSON.stringify({ ...stored, t: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    expect(runScript("u1").innerHTML).toBe("");
    expect(pictureShowing()).toBe(false);
  });

  it("kept only from the top of the page (that's how a page opens)", () => {
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
    savePicture("u1", liveScreen(), "he");
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
  });

  it("goes at logout, and when someone else signs in", () => {
    savePicture("u1", liveScreen(), "he");
    clearPicture("u1");
    expect(localStorage.getItem(PICTURE_KEY)).not.toBeNull();
    clearPicture("u2");
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
    savePicture("u1", liveScreen(), "he");
    clearPicture();
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
  });
});

describe("the hand-over and the keeping", () => {
  beforeEach(() => {
    reset();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => vi.useRealTimers());

  /** As the script leaves the page: the picture up over the live screen. */
  function showPicture() {
    const box = document.createElement("div");
    box.id = PICTURE_BOX_ID;
    box.innerHTML = "<p>התמונה</p>";
    document.body.append(box);
    html.setAttribute("data-dashboard-picture", "");
    return box;
  }

  function Screen({ loading, greeting = true }: { loading: boolean; greeting?: boolean }) {
    return (
      <div data-app-screen>
        <header>{greeting ? <span data-dashboard-greeting=""><span data-greeting-text="">בוקר טוב</span></span> : "דשבורד"}</header>
        <DashboardPictureKeeper userId="u1" locale="he" />
        <div data-dashboard-board>{loading ? <div data-skeleton="" /> : <p>היום: 3 משימות</p>}</div>
      </div>
    );
  }

  it("the live screen takes over once its board is complete AND the greeting is in the top bar; then it's kept", async () => {
    const box = showPicture();
    const { rerender } = render(<Screen loading greeting={false} />);
    expect(pictureShowing()).toBe(true); // still loading: the picture stays

    rerender(<Screen loading={false} greeting={false} />);
    await act(async () => {});
    expect(pictureShowing()).toBe(true); // the board's there, but the bar still says "דשבורד"

    rerender(<Screen loading={false} />);
    await act(async () => {});
    expect(pictureShowing()).toBe(false);
    expect(box.innerHTML).toBe("");
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();

    await act(async () => vi.advanceTimersByTime(1600));
    const kept = JSON.parse(localStorage.getItem(PICTURE_KEY)!);
    expect(kept.h).toContain("היום: 3 משימות");
    expect(kept.h).toContain("<header>");
    expect(kept.g).toBe("בוקר טוב");
  });

  it("never keeps a screen that's still loading; a tap hands over at once", async () => {
    showPicture();
    render(<Screen loading />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
    document.dispatchEvent(new Event("pointerdown"));
    expect(pictureShowing()).toBe(false);
  });

  it("5 seconds without the live screen ready: it shows anyway", async () => {
    showPicture();
    render(<Screen loading />);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(pictureShowing()).toBe(false);
  });

  it("kept when the app goes to the background", async () => {
    render(<Screen loading={false} />);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
    expect(JSON.parse(localStorage.getItem(PICTURE_KEY)!).u).toBe("u1");
  });

  it("the app moved off the dashboard before it was drawn: the frame takes the picture down", () => {
    const box = showPicture();
    nav.pathname = "/tasks";
    render(<DashboardPictureFrame userId="u1" locale="he" />);
    expect(pictureShowing()).toBe(false);
    expect(box.innerHTML).toBe("");
  });
});

describe("React and the picture the script put in", () => {
  it("hydrating the frame leaves the picture alone — no mismatch, nothing redrawn", async () => {
    reset();
    savePicture("u1", liveScreen(), "he");
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const tree = <DashboardPictureFrame userId="u1" locale="he" />;

    // The server's HTML; the script runs as the browser reads it.
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const box = document.getElementById(PICTURE_BOX_ID)!;
    new Function(container.querySelector("script")!.textContent ?? "")();
    expect(box.innerHTML).toContain("הלוח");

    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, tree, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(document.getElementById(PICTURE_BOX_ID)).toBe(box);
    expect(box.innerHTML).toContain("הלוח");
    expect(pictureShowing()).toBe(true);
  });
});

describe("the off switch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("NEXT_PUBLIC_DASHBOARD_PICTURE=off: no picture shown, none kept, and the one already kept is forgotten", async () => {
    reset();
    savePicture("u1", liveScreen(), "he");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_PICTURE", "off");
    vi.resetModules();
    const off = await import("@/components/dashboard/DashboardPicture");
    const { container } = render(
      <div data-app-screen>
        <off.DashboardPictureFrame userId="u1" locale="he" />
        <off.DashboardPictureKeeper userId="u1" locale="he" />
        <div data-dashboard-board />
      </div>
    );
    expect(container.querySelector("script")).toBeNull();
    expect(document.getElementById(PICTURE_BOX_ID)).toBeNull();
    expect(localStorage.getItem(PICTURE_KEY)).toBeNull();
  });
});
