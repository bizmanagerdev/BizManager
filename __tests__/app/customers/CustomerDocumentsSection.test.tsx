// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// מסמכים on the customer page. The documents come after the page; an upload
// is listed at once — one that waits for the connection too, marked as
// waiting — opened from the file on this device until the page is read again;
// the category edit and the delete are in the row's quiet ⋮ and update the
// list in place. "מסמכים נדרשים" is there whether or not anything is filed.

const h = vi.hoisted(() => ({
  offlineFetch: vi.fn(async (..._args: unknown[]) => ({ queued: false as const, ok: true as const, data: {} as unknown })),
  offlineUpload: vi.fn(),
  scheduleDeferredDelete: vi.fn(),
  scheduleDeferredEdit: vi.fn(),
  registerReversibleAction: vi.fn(),
  fetchChecklistForEntity: vi.fn(async () => [] as unknown[]),
  updateDocumentTag: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: h.offlineFetch, CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: h.offlineUpload }));
vi.mock("@/lib/undo-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/undo-engine")>()),
  scheduleDeferredDelete: h.scheduleDeferredDelete,
  scheduleDeferredEdit: h.scheduleDeferredEdit,
  registerReversibleAction: h.registerReversibleAction,
}));
vi.mock("@/lib/documents/checklist", () => ({ fetchChecklistForEntity: h.fetchChecklistForEntity }));
vi.mock("@/lib/documents/updateDocumentTag", () => ({ updateDocumentTag: h.updateDocumentTag }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  type Children = { children?: React.ReactNode };
  const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    DropdownMenu: ({ children }: Children) => {
      const [open, setOpen] = React.useState(false);
      return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
    },
    DropdownMenuTrigger: ({ children }: Children) => {
      const { open, setOpen } = React.useContext(Menu);
      return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(!open) });
    },
    DropdownMenuContent: ({ children }: Children) => (React.useContext(Menu).open ? <div role="menu">{children}</div> : null),
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children, onSelect }: Children & { onSelect?: () => void }) => {
      const { setOpen } = React.useContext(Menu);
      return (
        <div
          role="menuitem"
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

import { refresh } from "@/__tests__/mocks/next-navigation";
import CustomerDocumentsSection from "@/app/(app)/customers/[id]/CustomerDocumentsSection";
import { settled } from "@/__tests__/app/customers/customerPageFixtures";
import type { CustomerDocumentItem, CustomerDocumentsResult } from "@/app/(app)/customers/[id]/customerPageModel";

function doc(id: string, overrides: Partial<CustomerDocumentItem> = {}): CustomerDocumentItem {
  return {
    id,
    name: `מסמך ${id}`,
    fileName: `${id}.pdf`,
    type: "חוזה/הסכם",
    uploadedAt: "2026-10-01T08:00:00Z",
    url: `https://files.test/${id}.pdf`,
    sourceType: "customer",
    sourceId: "c1",
    ...overrides,
  };
}

function renderSection(result: CustomerDocumentsResult) {
  return render(
    <CustomerDocumentsSection
      customerId="c1"
      customerName="חברת אלון"
      documents={settled(result)}
      projectNames={new Map([["p1", "שיפוץ משרד"]])}
    />
  );
}

function count() {
  return screen.getByText("מסמכים").closest("button")!.querySelector(".rounded-full")!.textContent;
}

async function upload(fileName: string) {
  fireEvent.click(screen.getByRole("button", { name: "העלאת מסמך" }));
  const dialog = await screen.findByRole("dialog", { name: "העלאת מסמך" });
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["x"], fileName, { type: "application/pdf" })] } });
  await within(dialog).findByText(fileName);
  fireEvent.click(within(dialog).getByRole("button", { name: "העלאה" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "העלאת מסמך" })).toBeNull());
}

beforeEach(() => {
  h.offlineUpload.mockReset();
  h.offlineFetch.mockReset().mockResolvedValue({ queued: false, ok: true, data: {} });
  h.scheduleDeferredDelete.mockReset();
  h.scheduleDeferredEdit.mockReset();
  h.registerReversibleAction.mockReset();
  h.fetchChecklistForEntity.mockReset().mockResolvedValue([]);
  refresh.mockClear();
  URL.createObjectURL = vi.fn(() => "blob:local-file");
});

describe("CustomerDocumentsSection", () => {
  it("names where each document is filed and how many there are, with the rest a link away", () => {
    renderSection({
      documents: [doc("d1"), doc("d2", { sourceType: "order", sourceId: "o1234567890" }), doc("d3", { sourceType: "project", sourceId: "p1", type: null })],
      total: 14,
      error: null,
    });
    expect(count()).toBe("14");
    expect(screen.getByText("#o1234567")).toBeInTheDocument();
    expect(screen.getByText("שיפוץ משרד")).toBeInTheDocument();
    expect(screen.getAllByText("חוזה/הסכם")).toHaveLength(2);
    expect(screen.getAllByText("הועלה 01/10/26 11:00")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "לכל המסמכים (14)" })).toHaveAttribute(
      "href",
      "/documents?customer_id=c1&customer_name=%D7%97%D7%91%D7%A8%D7%AA%20%D7%90%D7%9C%D7%95%D7%9F"
    );
  });

  it("'מסמכים נדרשים' is there with nothing filed yet, and its upload opens on that category", async () => {
    h.fetchChecklistForEntity.mockResolvedValue([{ code: "תעודה/רישיון", label: "רישיון עסק", present: false, documentId: null, validUntil: null }]);
    renderSection({ documents: [], total: 0, error: null });
    expect(await screen.findByText("מסמכים נדרשים")).toBeInTheDocument();
    expect(screen.getByText("אין מסמכים ללקוח זה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "העלאה" }));
    const dialog = await screen.findByRole("dialog", { name: "העלאת מסמך" });
    expect(within(dialog).getByRole("combobox")).toHaveValue("תעודה/רישיון");
  });

  it("an upload is listed at once, opened from the file on this device; its undo takes it away", async () => {
    h.offlineUpload.mockResolvedValueOnce({
      queued: false,
      ok: true,
      data: { document: { id: "d-new", file_name: "scan.pdf", document_type: "מסמך כללי", uploaded_at: "2026-10-13T09:00:00Z" } },
    });
    renderSection({ documents: [doc("d1")], total: 1, error: null });
    await upload("scan.pdf");
    const row = (await screen.findByText("scan.pdf", { selector: "span" })).closest("a") as HTMLElement;
    expect(row).toHaveAttribute("href", "blob:local-file");
    expect(count()).toBe("2");
    expect(refresh).not.toHaveBeenCalled();

    const undo = h.registerReversibleAction.mock.calls[0]![0] as { onUndo: () => Promise<{ ok: boolean }> };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await act(async () => {
      await undo.onUndo();
    });
    expect(screen.queryByText("scan.pdf", { selector: "span" })).toBeNull();
    expect(count()).toBe("1");
  });

  it("an upload with no connection is listed at once, marked as waiting", async () => {
    h.offlineUpload.mockResolvedValueOnce({ queued: true, reason: "offline" });
    renderSection({ documents: [], total: 0, error: null });
    await upload("offline.pdf");
    const name = await screen.findByText("offline.pdf", { selector: "span" });
    expect(within(name.closest("div.group\\/doc") as HTMLElement).getByText("ממתין לשליחה")).toBeInTheDocument();
    expect(h.registerReversibleAction).not.toHaveBeenCalled();
  });

  it("the ⋮ deletes (asking first) and edits the category, in place", async () => {
    renderSection({ documents: [doc("d1"), doc("d2")], total: 2, error: null });
    const [firstMenu] = screen.getAllByRole("button", { name: "פעולות" });
    fireEvent.click(firstMenu!);
    fireEvent.click(screen.getByText("מחיקת מסמך"));
    const confirm = await screen.findByRole("dialog", { name: "מחיקת מסמך" });
    fireEvent.click(within(confirm).getByRole("button", { name: "מחיקה" }));
    const deletion = h.scheduleDeferredDelete.mock.calls[0]![0] as { scope: string; id: string; onCommit: () => Promise<{ ok: boolean }> };
    expect(deletion).toMatchObject({ scope: "customer-document", id: "d1" });
    await expect(deletion.onCommit()).resolves.toEqual({ ok: true });
    expect(h.offlineFetch).toHaveBeenCalledWith("/api/documents/delete", { document_id: "d1" }, "מחיקת מסמך");

    fireEvent.click(screen.getAllByRole("button", { name: "פעולות" })[1]!);
    fireEvent.click(screen.getByText("עריכת קטגוריה"));
    const edit = await screen.findByRole("dialog", { name: "עריכת קטגוריה" });
    fireEvent.change(within(edit).getByRole("combobox"), { target: { value: "ביטוח" } });
    fireEvent.click(within(edit).getByRole("button", { name: "שמירה" }));
    const change = h.scheduleDeferredEdit.mock.calls[0]![0] as { id: string; patch: unknown; onCommit: () => Promise<{ ok: boolean }> };
    expect(change).toMatchObject({ id: "d2", patch: { type: "ביטוח" } });
    await change.onCommit();
    expect(h.updateDocumentTag).toHaveBeenCalledWith("d2", "ביטוח");
  });

  it("states a documents read that failed", async () => {
    renderSection({ documents: [], total: 0, error: "טעינת המסמכים נכשלה." });
    await waitFor(() => expect(screen.getByText("טעינת המסמכים נכשלה.")).toBeInTheDocument());
  });
});
