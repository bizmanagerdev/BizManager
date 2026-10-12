// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("sonner", () => ({ toast: h.toast }));

// The ⋮ inline, opened by a pointer down as Radix's is (Radix's portal and
// focus handling crawl in jsdom, and the menu isn't what's under test) — the
// same stand-in as the lists' tests.
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode; className?: string };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
    open: false,
    setOpen: () => {},
  });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children, disabled }: Children & { disabled?: boolean }) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onPointerDown?: () => void; disabled?: boolean }>, {
        disabled,
        onPointerDown: () => setOpen(!open),
      });
    },
    DropdownMenuContent: ({ children }: Children) =>
      React.useContext(Menu).open ? <div role="menu">{children}</div> : null,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, className, onSelect }: Children & { onSelect?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
          className={className}
          onClick={() => {
            onSelect?.();
            setOpen(false);
          }}
        >
          {children}
        </div>
      );
    },
  };
});

import {
  DocumentLink,
  DocumentQuickActions,
  DocumentRow,
  DocumentTile,
  fileExtension,
  isImageFileName,
} from "@/components/ui/document-tile";

// The owner's rule (2026-10-12): "wherever there is a doc I want a download
// option and a view option on hover, the edit and delete somewhere else, much
// less prominent." These lock that shape down for every file in the app.

const PDF_URL =
  "https://proj.supabase.co/storage/v1/object/sign/business-documents/projects/p1/abc.pdf?token=t0k";

/** Radix opens its menu on a primary-button pointer down. */
function openMenu(container: HTMLElement = document.body) {
  fireEvent.pointerDown(within(container).getByRole("button", { name: "פעולות" }), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

afterEach(() => {
  vi.clearAllMocks();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("DocumentTile — view and download", () => {
  it("shows צפייה and הורדה over the preview: view opens the file in a new tab, download saves it under its own name", () => {
    render(<DocumentTile name="חוזה עבודה" fileName="contract.pdf" url={PDF_URL} date="02/09/26" />);
    const view = screen.getByRole("link", { name: "צפייה" });
    expect(view).toHaveAttribute("href", PDF_URL);
    expect(view).toHaveAttribute("target", "_blank");

    const download = screen.getByRole("link", { name: "הורדה" });
    expect(download).toHaveAttribute("download", "contract.pdf");
    // Storage is told to answer with the file as an attachment, named.
    expect(download).toHaveAttribute("href", `${PDF_URL}&download=contract.pdf`);
    // A same-tab link: the browser saves it, the page stays.
    expect(download).not.toHaveAttribute("target");
  });

  it("the pair sits in a scrim that appears on hover and on keyboard focus, and is never drawn on a phone", () => {
    render(<DocumentTile name="contract.pdf" url={PDF_URL} />);
    const scrim = screen.getByRole("link", { name: "צפייה" }).closest("div")!;
    expect(scrim.className).toContain("opacity-0");
    expect(scrim.className).toContain("group-hover/doc:opacity-100");
    expect(scrim.className).toContain("group-focus-within/preview:opacity-100");
    expect(scrim.className).toContain("[@media(hover:none)]:hidden");
    // Keyboard: the two actions are in the tab order; the whole-preview link
    // (the phone's tap target) is not.
    expect(screen.getByRole("link", { name: "צפייה: contract.pdf" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("link", { name: "צפייה" })).not.toHaveAttribute("tabindex");
  });

  it("names wrap, never cut; a photo shows itself, a file its type", () => {
    const { rerender } = render(
      <DocumentTile name="שם ארוך מאוד של מסמך שצריך לרדת שורה" fileName="report.pdf" url={PDF_URL} />
    );
    const name = screen.getByText("שם ארוך מאוד של מסמך שצריך לרדת שורה");
    expect(name.className).toContain("break-words");
    expect(name.className).not.toContain("truncate");
    expect(screen.getByText("pdf")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();

    rerender(<DocumentTile name="photo.jpg" url="https://proj.supabase.co/storage/v1/object/sign/b/photo.jpg?token=t" />);
    expect(screen.getByRole("img", { name: "photo.jpg" })).toBeInTheDocument();
    expect(screen.queryByText("jpg")).toBeNull();
  });

  it("an in-app viewer replaces the new tab", () => {
    const onView = vi.fn();
    render(<DocumentTile name="contract.pdf" url={PDF_URL} onView={onView} />);
    fireEvent.click(screen.getByRole("button", { name: "צפייה" }));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "צפייה" })).toBeNull();
  });

  it("a file with no link still shows, without view or download", () => {
    render(<DocumentTile name="photo.jpg" url={null} />);
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "צפייה" })).toBeNull();
    // Nothing to edit, delete or download: no ⋮ either.
    expect(screen.queryByRole("button", { name: "פעולות" })).toBeNull();
  });
});

describe("DocumentTile — edit and delete in the quiet ⋮", () => {
  it("no pencil or bin on the tile: a grey, unfilled ⋮ holds עריכה and מחיקה", () => {
    render(<DocumentTile name="contract.pdf" url={PDF_URL} onEdit={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "מחיקה" })).toBeNull();
    const more = screen.getByRole("button", { name: "פעולות" });
    expect(more.className).toContain("text-muted-foreground");
    const classes = more.className.split(/\s+/);
    expect(classes).not.toContain("bg-secondary");
    expect(classes).not.toContain("bg-destructive");
    expect(classes).not.toContain("border-destructive");

    const menu = openMenu();
    expect(within(menu).getByRole("menuitem", { name: "עריכה" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "מחיקה" })).toBeInTheDocument();
    // הורדה is in it too — for a phone, where there is no hover; a mouse has it already.
    expect(within(menu).getByRole("menuitem", { name: "הורדה" }).className).toContain("[@media(hover:hover)]:hidden");
  });

  it("עריכה calls the place's own edit, under its own noun", () => {
    const onEdit = vi.fn();
    render(<DocumentTile name="contract.pdf" url={PDF_URL} onEdit={onEdit} editLabel="עריכת קטגוריה" />);
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "עריכת קטגוריה" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  function renderAsking(onDelete: () => void) {
    render(
      <DocumentTile
        name="contract.pdf"
        url={PDF_URL}
        onDelete={onDelete}
        confirmDelete={{ title: "מחיקת מסמך", description: "contract.pdf" }}
      />
    );
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "מחיקה" }));
    return screen.getByRole("dialog");
  }

  it("מחיקה asks first through ConfirmDialog; ביטול keeps the file", () => {
    const onDelete = vi.fn();
    const dialog = renderAsking(onDelete);
    expect(within(dialog).getByText("מחיקת מסמך")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול" }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("the dialog's מחיקה deletes", () => {
    const onDelete = vi.fn();
    const dialog = renderAsking(onDelete);
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקה" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a place with its own confirm gets the tap as is", () => {
    const onDelete = vi.fn();
    render(<DocumentTile name="contract.pdf" url={PDF_URL} onDelete={onDelete} deleteLabel="מחיקת קובץ" />);
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "מחיקת קובץ" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no permission to edit or delete: the ⋮ is there only for a phone's הורדה", () => {
    render(<DocumentTile name="contract.pdf" url={PDF_URL} />);
    const more = screen.getByRole("button", { name: "פעולות" });
    expect(more.className).toContain("[@media(hover:hover)]:hidden");
    const menu = openMenu();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["הורדה"]);
  });

  it("work on its way turns the ⋮ into a spinner and keeps it shut", () => {
    render(<DocumentTile name="contract.pdf" url={PDF_URL} onDelete={() => {}} busy />);
    expect(screen.getByRole("button", { name: "פעולות" })).toBeDisabled();
  });
});

describe("downloading", () => {
  it("the ⋮'s הורדה saves through a download link named for the file", () => {
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    render(<DocumentTile name="חוזה עבודה" fileName="חוזה.pdf" url={PDF_URL} />);
    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "הורדה" }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]!.download).toBe("חוזה.pdf");
    expect(clicked[0]!.href).toBe(`${PDF_URL}&download=${encodeURIComponent("חוזה.pdf")}`);
    click.mockRestore();
  });

  it("inside the Android app the link is taken over: the file is fetched and handed to the app's save", async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      isPluginAvailable: (name: string) => name === "BizHNative",
    };
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:http://localhost/1");
    URL.revokeObjectURL = vi.fn();
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    render(<DocumentTile name="contract.pdf" url={PDF_URL} />);
    const link = screen.getByRole("link", { name: "הורדה" });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(PDF_URL);
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0]!.href).toBe("blob:http://localhost/1");
    expect(clicked[0]!.download).toBe("contract.pdf");

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("a failed download says so", async () => {
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, blob: async () => new Blob() }));
    render(<DocumentTile name="contract.pdf" url={PDF_URL} />);
    fireEvent.click(screen.getByRole("link", { name: "הורדה" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("ההורדה נכשלה."));
    vi.unstubAllGlobals();
  });
});

describe("DocumentRow", () => {
  it("the row opens the file; view and download at its end on hover; edit/delete in the ⋮", () => {
    const onDelete = vi.fn();
    render(<DocumentRow name="חוזה" fileName="contract.pdf" url={PDF_URL} meta="02/09/26" onDelete={onDelete} />);
    const links = screen.getAllByRole("link");
    // The row itself, then צפייה and הורדה.
    expect(links[0]).toHaveAttribute("href", PDF_URL);
    expect(links[0]).toHaveTextContent("חוזה");
    expect(links[0]).toHaveTextContent("02/09/26");
    const pair = screen.getByRole("link", { name: "צפייה" }).parentElement!;
    expect(pair.className).toContain("opacity-0");
    expect(pair.className).toContain("group-hover/doc:opacity-100");
    expect(pair.className).toContain("focus-within:opacity-100");
    expect(screen.getByRole("link", { name: "הורדה" })).toHaveAttribute("download", "contract.pdf");
    expect(screen.queryByRole("button", { name: "מחיקה" })).toBeNull();

    fireEvent.click(within(openMenu()).getByRole("menuitem", { name: "מחיקה" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("a photo shows its thumbnail", () => {
    render(<DocumentRow name="תמונה" fileName="a.png" url="https://proj.supabase.co/storage/v1/object/sign/b/a.png?token=t" />);
    expect(screen.getByRole("img", { name: "תמונה" })).toBeInTheDocument();
  });

  it("takes the task screens' Arabic", () => {
    render(
      <DocumentRow
        name="ملف"
        url={PDF_URL}
        onDelete={() => {}}
        labels={{ view: "عرض", download: "تنزيل", more: "إجراءات", delete: "حذف" }}
      />
    );
    expect(screen.getByRole("link", { name: "عرض" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "تنزيل" })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "إجراءات" }), { button: 0, ctrlKey: false });
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "حذف" })).toBeInTheDocument();
  });
});

describe("DocumentLink — a file inside a line", () => {
  it("the link opens the file as it did; a הורדה glyph follows it, on hover and always on a phone", () => {
    render(
      <DocumentLink name="צילום הצ׳ק" url={PDF_URL} className="chip">
        קובץ
      </DocumentLink>
    );
    const open = screen.getByRole("link", { name: "קובץ" });
    expect(open).toHaveAttribute("href", PDF_URL);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveClass("chip");
    const download = screen.getByRole("link", { name: "הורדה" });
    // Named for the file, its type borrowed from the stored file.
    expect(download).toHaveAttribute("download", "צילום הצ׳ק.pdf");
    expect(download.className).toContain("opacity-0");
    expect(download.className).toContain("group-hover/doc:opacity-100");
    expect(download.className).toContain("[@media(hover:none)]:opacity-100");
  });
});

describe("DocumentQuickActions — for a place that keeps its own tile", () => {
  it("draws צפייה and הורדה; with nothing to open, nothing", () => {
    const onView = vi.fn();
    const { rerender } = render(<DocumentQuickActions name="a.pdf" url={PDF_URL} onView={onView} variant="inline" />);
    fireEvent.click(screen.getByRole("button", { name: "צפייה" }));
    expect(onView).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "הורדה" })).toHaveAttribute("download", "a.pdf");
    rerender(<DocumentQuickActions name="a.pdf" url={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("helpers", () => {
  it("reads a photo and a file type from the name", () => {
    expect(isImageFileName("IMG_1.JPEG")).toBe(true);
    expect(isImageFileName("scan.heic")).toBe(true);
    expect(isImageFileName("heller-mark.svg")).toBe(false);
    expect(fileExtension("heller-mark.svg")).toBe("svg");
    expect(fileExtension("no extension")).toBeNull();
  });
});
