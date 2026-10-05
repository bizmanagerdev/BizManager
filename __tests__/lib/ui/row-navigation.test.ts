// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { shouldIgnoreRowNavigation, clickableRowProps, rowNavigateProps } from "@/lib/ui/row-navigation";

function el(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.firstElementChild as HTMLElement;
}

describe("shouldIgnoreRowNavigation", () => {
  it("false for a non-HTMLElement target (e.g. null)", () => {
    expect(shouldIgnoreRowNavigation(null)).toBe(false);
  });

  it("false for a plain element inside the row — the row itself should navigate", () => {
    const span = el("<span>ביאן מרקט</span>");
    expect(shouldIgnoreRowNavigation(span)).toBe(false);
  });

  it("true for a click landing on (or inside) a real interactive element", () => {
    const button = el("<div><button>עריכה</button></div>").querySelector("button")!;
    expect(shouldIgnoreRowNavigation(button)).toBe(true);

    const link = el('<div><a href="/x">קישור</a></div>').querySelector("a")!;
    expect(shouldIgnoreRowNavigation(link)).toBe(true);

    const input = el("<div><input /></div>").querySelector("input")!;
    expect(shouldIgnoreRowNavigation(input)).toBe(true);
  });

  it("true for [role=\"button\"] but the row's OWN role=\"link\" wrapper doesn't self-cancel", () => {
    // A row commonly carries role="link" itself (clickableRowProps' default) —
    // closest() matches an element against itself, so if "link" were included
    // in the interactive-role selector, EVERY click inside the row would match
    // the row's own wrapper and cancel all navigation. Confirms it isn't.
    const row = el('<div role="link"><span>תוכן</span></div>');
    const inner = row.querySelector("span")!;
    expect(shouldIgnoreRowNavigation(inner)).toBe(false);

    const menuButton = el('<div><span role="button">תפריט</span></div>').querySelector("span")!;
    expect(shouldIgnoreRowNavigation(menuButton)).toBe(true);
  });

  it("true for a click inside a portaled dialog/menu/popover, even though it isn't a form control", () => {
    const dialogContent = el('<div role="dialog"><p>תוכן הדיאלוג</p></div>').querySelector("p")!;
    expect(shouldIgnoreRowNavigation(dialogContent)).toBe(true);

    const popper = el('<div data-radix-popper-content-wrapper=""><p>x</p></div>').querySelector("p")!;
    expect(shouldIgnoreRowNavigation(popper)).toBe(true);
  });
});

describe("shouldIgnoreRowNavigation — given the row (the handler's currentTarget)", () => {
  // Mounted in the document, so a "portaled" dialog can be a sibling of the row
  // rather than inside it — the way Radix renders one into <body>.
  function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  }
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a role=\"button\" row doesn't count as an interactive element inside itself", () => {
    // closest() matches the target and every ancestor, the row included — so
    // without the row to stop at, a role="button" row cancels its own clicks.
    const host = mount('<div role="button" id="row"><div><span id="name">דוד</span></div></div>');
    const row = host.querySelector("#row")!;
    expect(shouldIgnoreRowNavigation(host.querySelector("#name"), row)).toBe(false);
    // A keypress lands on the focused row itself.
    expect(shouldIgnoreRowNavigation(row, row)).toBe(false);
    // The trap, for the record: without the row, it matches itself.
    expect(shouldIgnoreRowNavigation(host.querySelector("#name"))).toBe(true);
  });

  it("still true for buttons, links and role=\"button\" elements inside a role=\"button\" row", () => {
    const host = mount(
      '<table><tbody><tr role="button" id="row"><td>' +
        '<button id="btn"><span id="btn-icon">x</span></button>' +
        '<a href="/x" id="link">קישור</a>' +
        '<span role="button" id="menu">תפריט</span>' +
        "<input id=\"input\" />" +
        "</td></tr></tbody></table>"
    );
    const row = host.querySelector("#row")!;
    for (const id of ["btn", "btn-icon", "link", "menu", "input"]) {
      expect(shouldIgnoreRowNavigation(host.querySelector(`#${id}`), row)).toBe(true);
    }
  });

  it("an interactive element AROUND the row doesn't cancel it — only what sits inside", () => {
    const host = mount('<div role="dialog"><label><div role="link" id="row"><span id="cell">x</span></div></label></div>');
    const row = host.querySelector("#row")!;
    expect(shouldIgnoreRowNavigation(host.querySelector("#cell"), row)).toBe(false);
  });

  it("true for a click inside a dialog/menu portaled out of the row, interactive or not", () => {
    const host = mount(
      '<div role="button" id="row"><span>שורה</span></div>' +
        '<div role="dialog"><p id="dialog-text">תאריך אספקה</p><button id="dialog-save">שמירה</button></div>' +
        '<div data-radix-popper-content-wrapper=""><div role="menu"><div role="menuitem" id="item">מחיקה</div></div></div>'
    );
    const row = host.querySelector("#row")!;
    expect(shouldIgnoreRowNavigation(host.querySelector("#dialog-text"), row)).toBe(true);
    expect(shouldIgnoreRowNavigation(host.querySelector("#dialog-save"), row)).toBe(true);
    expect(shouldIgnoreRowNavigation(host.querySelector("#item"), row)).toBe(true);
  });
});

describe("clickableRowProps", () => {
  it("defaults to role=\"link\", tabIndex=0", () => {
    const props = clickableRowProps(() => {});
    expect(props.role).toBe("link");
    expect(props.tabIndex).toBe(0);
  });

  it("onClick activates when the click target is plain row content", () => {
    const onActivate = vi.fn();
    const props = clickableRowProps(onActivate);
    const span = el("<span>x</span>");
    props.onClick({ target: span } as unknown as React.MouseEvent);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("onClick does NOT activate when the click landed on an inner interactive element", () => {
    const onActivate = vi.fn();
    const props = clickableRowProps(onActivate);
    const button = el("<div><button>x</button></div>").querySelector("button")!;
    props.onClick({ target: button } as unknown as React.MouseEvent);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("onKeyDown activates on Enter or Space, not on other keys", () => {
    const onActivate = vi.fn();
    const props = clickableRowProps(onActivate);
    const span = el("<span>x</span>");
    const preventDefault = vi.fn();

    props.onKeyDown({ target: span, key: "Enter", preventDefault } as unknown as React.KeyboardEvent);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);

    props.onKeyDown({ target: span, key: " ", preventDefault } as unknown as React.KeyboardEvent);
    expect(onActivate).toHaveBeenCalledTimes(2);

    props.onKeyDown({ target: span, key: "Tab", preventDefault } as unknown as React.KeyboardEvent);
    expect(onActivate).toHaveBeenCalledTimes(2); // unchanged
  });

  it("respects an explicit role override", () => {
    expect(clickableRowProps(() => {}, { role: "button" }).role).toBe("button");
  });

  it("a role=\"button\" row activates on click and on Enter — not on its inner button", () => {
    const onActivate = vi.fn();
    const props = clickableRowProps(onActivate, { role: "button" });
    const row = el(`<table><tbody><tr role="${props.role}"><td><span>דוד</span><button>עריכה</button></td></tr></tbody></table>`)
      .querySelector("tr")!;
    const span = row.querySelector("span")!;
    const button = row.querySelector("button")!;
    const preventDefault = vi.fn();

    props.onClick({ target: span, currentTarget: row } as unknown as React.MouseEvent);
    expect(onActivate).toHaveBeenCalledTimes(1);

    props.onKeyDown({ target: row, currentTarget: row, key: "Enter", preventDefault } as unknown as React.KeyboardEvent);
    expect(onActivate).toHaveBeenCalledTimes(2);

    props.onClick({ target: button, currentTarget: row } as unknown as React.MouseEvent);
    props.onKeyDown({ target: button, currentTarget: row, key: "Enter", preventDefault } as unknown as React.KeyboardEvent);
    expect(onActivate).toHaveBeenCalledTimes(2); // unchanged
  });
});

describe("rowNavigateProps", () => {
  it("pushes the given href via the router when the row activates", () => {
    const push = vi.fn();
    const props = rowNavigateProps({ push }, "/customers/cust-1");
    const span = el("<span>x</span>");
    props.onClick({ target: span } as unknown as React.MouseEvent);
    expect(push).toHaveBeenCalledWith("/customers/cust-1");
  });

  it("kicks off the nav-progress bar (window event) alongside the push", () => {
    const push = vi.fn();
    const listener = vi.fn();
    window.addEventListener("app:navigation-start", listener);
    try {
      const props = rowNavigateProps({ push }, "/x");
      props.onClick({ target: el("<span>x</span>") } as unknown as React.MouseEvent);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("app:navigation-start", listener);
    }
  });

  it("does not navigate when the click was on an inner interactive element", () => {
    const push = vi.fn();
    const props = rowNavigateProps({ push }, "/x");
    const button = el("<div><button>x</button></div>").querySelector("button")!;
    props.onClick({ target: button } as unknown as React.MouseEvent);
    expect(push).not.toHaveBeenCalled();
  });

  it("a role=\"button\" row navigates (the salary centre's worker rows) — but not from a dialog it opened", () => {
    const push = vi.fn();
    const props = rowNavigateProps({ push }, "/payroll/workers/w1", { role: "button" });
    const row = el('<div role="button"><div class="font-semibold">דוד</div></div>');
    const dialog = el('<div role="dialog"><p>x</p></div>').querySelector("p")!;

    props.onClick({ target: row.querySelector("div"), currentTarget: row } as unknown as React.MouseEvent);
    expect(push).toHaveBeenCalledWith("/payroll/workers/w1");

    props.onClick({ target: dialog, currentTarget: row } as unknown as React.MouseEvent);
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe("rowNavigateProps — prefetch on intent", () => {
  const pointer = (pointerType: string) => ({ pointerType }) as unknown as React.PointerEvent;

  it("adds no prefetch handlers unless asked to", () => {
    const props = rowNavigateProps({ push: vi.fn(), prefetch: vi.fn() }, "/projects/p1");
    expect("onPointerEnter" in props).toBe(false);
  });

  it("fetches the whole page (data included) once the mouse has rested on the row", () => {
    vi.useFakeTimers();
    try {
      const prefetch = vi.fn();
      const props = rowNavigateProps({ push: vi.fn(), prefetch }, "/projects/p1", { prefetch: true }) as unknown as {
        onPointerEnter: (e: React.PointerEvent) => void;
      };
      props.onPointerEnter(pointer("mouse"));
      expect(prefetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(prefetch).toHaveBeenCalledWith("/projects/p1", { kind: "full" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when the mouse only sweeps across the row", () => {
    vi.useFakeTimers();
    try {
      const prefetch = vi.fn();
      const props = rowNavigateProps({ push: vi.fn(), prefetch }, "/projects/p1", { prefetch: true }) as unknown as {
        onPointerEnter: (e: React.PointerEvent) => void;
        onPointerLeave: () => void;
      };
      props.onPointerEnter(pointer("mouse"));
      vi.advanceTimersByTime(50);
      props.onPointerLeave();
      vi.advanceTimersByTime(500);
      expect(prefetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches nothing on touch — not on a finger going down, which also starts every scroll", () => {
    vi.useFakeTimers();
    try {
      const prefetch = vi.fn();
      const props = rowNavigateProps({ push: vi.fn(), prefetch }, "/projects/p1", { prefetch: true }) as unknown as {
        onPointerEnter: (e: React.PointerEvent) => void;
      };
      props.onPointerEnter(pointer("touch"));
      vi.advanceTimersByTime(500);
      expect(prefetch).not.toHaveBeenCalled();
      expect("onPointerDown" in props).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches when the keyboard moves onto the row, not when a tap or click focuses it", () => {
    const prefetch = vi.fn();
    const props = rowNavigateProps({ push: vi.fn(), prefetch }, "/projects/p1", { prefetch: true }) as unknown as {
      onFocus: (e: React.FocusEvent) => void;
    };
    const focus = (keyboard: boolean) =>
      ({ currentTarget: { matches: (selector: string) => keyboard && selector === ":focus-visible" } }) as unknown as React.FocusEvent;
    props.onFocus(focus(false));
    expect(prefetch).not.toHaveBeenCalled();
    props.onFocus(focus(true));
    expect(prefetch).toHaveBeenCalledWith("/projects/p1", { kind: "full" });
  });

  it("still navigates on click", () => {
    const push = vi.fn();
    const props = rowNavigateProps({ push, prefetch: vi.fn() }, "/projects/p1", { prefetch: true });
    props.onClick({ target: el("<span>x</span>") } as unknown as React.MouseEvent);
    expect(push).toHaveBeenCalledWith("/projects/p1");
  });

  it("runs onNavigate just before navigating — and not for a click on a button inside the row", () => {
    const calls: string[] = [];
    const push = vi.fn(() => calls.push("push"));
    const props = rowNavigateProps({ push }, "/projects/p1", { onNavigate: () => calls.push("onNavigate") });
    props.onClick({ target: el("<div><button>x</button></div>").querySelector("button") } as unknown as React.MouseEvent);
    expect(calls).toEqual([]);
    props.onClick({ target: el("<span>x</span>") } as unknown as React.MouseEvent);
    expect(calls).toEqual(["onNavigate", "push"]);
  });
});
