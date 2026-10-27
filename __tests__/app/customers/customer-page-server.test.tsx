import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// The customer page's server part (page.tsx). A device with its copy gets the
// device version (LocalCustomerPage, on for admins and office from
// 2026-10-23): only what the server alone reads goes out, and the page's full
// reads don't. Everyone else gets the server version — its reads go out after
// the "who's asking" check, or at once for ?data=server (the device version's
// way back) — shown when the customer and its money are in, the rest handed
// on as it comes, the history to admins only. A customer that isn't there is a 404.

const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireStaffPage: vi.fn(),
  startCustomerPageReads: vi.fn(),
  startCustomerServerReads: vi.fn(),
  deviceOn: { current: false },
  savingFrame: { current: false },
  order: [] as string[],
}));
vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/lib/auth/roleAccess", () => ({ requireStaffPage: h.requireStaffPage }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ tag: "server-client" }) }));
vi.mock("@/lib/timezone", () => ({ israelDateKey: () => "2026-10-13" }));
vi.mock("@/lib/powersync/device-check", () => ({
  devicePageOn: async () => h.deviceOn.current,
  deviceCheckDue: async () => false,
  savingFrameInBackground: async () => h.savingFrame.current,
}));
vi.mock("@/app/(app)/customers/[id]/loadCustomerPage", () => ({
  startCustomerPageReads: h.startCustomerPageReads,
  startCustomerServerReads: h.startCustomerServerReads,
}));
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/app/(app)/customers/[id]/CustomerPageView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/LocalCustomerPage", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/CustomerPageServerCheck", () => ({ default: () => null }));
vi.mock("@/components/powersync/DeviceFrameMark", () => ({ default: () => null }));

import CustomerDetailsPage from "@/app/(app)/customers/[id]/page";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";
import LocalCustomerPage from "@/app/(app)/customers/[id]/LocalCustomerPage";

function reads(top: unknown) {
  return {
    top: Promise.resolve(top),
    payments: Promise.resolve({ payments: [] }),
    documents: Promise.resolve({ documents: [] }),
    history: Promise.resolve({ items: [] }),
  };
}

/** The elements the page renders inside its AppShell. */
function viewOf(page: ReactElement, type: unknown): ReactElement {
  const children = (page.props as { children: ReactElement | ReactElement[] }).children;
  const found = (Array.isArray(children) ? children : [children]).find((child) => child?.type === type);
  if (!found) throw new Error("not rendered");
  return found;
}

const open = (id: string, data?: string) =>
  CustomerDetailsPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(data ? { data } : {}) });

beforeEach(() => {
  h.notFound.mockClear();
  h.order.length = 0;
  h.deviceOn.current = false;
  h.savingFrame.current = false;
  h.requireStaffPage.mockReset().mockImplementation(async () => {
    // The check answers after a round trip.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.order.push("profile");
    return { profile: { id: "u1", role: "admin", locale: "he", full_name: "דנה", email: "d@x.co" } };
  });
  h.startCustomerPageReads.mockReset().mockImplementation(() => {
    h.order.push("reads");
    return reads({ customer: { id: "c1" } });
  });
  h.startCustomerServerReads.mockReset().mockImplementation(() => ({
    server: Promise.resolve({ morningDocuments: [], activity: { logs: [], reminders: [] }, promises: [], payrollOwed: null }),
    documents: Promise.resolve({ documents: [] }),
    history: Promise.resolve({ items: [] }),
  }));
});

describe("the customer page on the server", () => {
  it("a device with its copy: the device version, with only what the server alone reads on its way", async () => {
    h.deviceOn.current = true;
    const page = (await open("c1")) as ReactElement;
    expect(h.startCustomerPageReads).not.toHaveBeenCalled();
    const [client, id] = h.startCustomerServerReads.mock.calls[0]!;
    expect(client).toEqual({ tag: "server-client" });
    expect(id).toBe("c1");
    const props = viewOf(page, LocalCustomerPage).props as {
      id: string;
      viewer: unknown;
      serverReads: { server: unknown; documents: unknown; history: unknown };
    };
    expect(props.id).toBe("c1");
    expect(props.viewer).toEqual({ userId: "u1", role: "admin", locale: "he" });
    expect(props.serverReads.server).toBeInstanceOf(Promise);
    expect(props.serverReads.history).toBeInstanceOf(Promise);
  });

  it("saved by the service worker in the background: no history, even for an admin (the costliest read, owner 2026-10-25)", async () => {
    h.deviceOn.current = true;
    h.savingFrame.current = true;
    const page = (await open("c1")) as ReactElement;
    expect(h.startCustomerServerReads.mock.calls[0]![4]).toEqual({ withHistory: false });
    const props = viewOf(page, LocalCustomerPage).props as { serverReads: { history: unknown; server: unknown } };
    expect(props.serverReads.history).toBeNull();
    expect(props.serverReads.server).toBeInstanceOf(Promise);
  });

  it("opened by the person (not a background save): an admin's history is read", async () => {
    h.deviceOn.current = true;
    await open("c1");
    expect(h.startCustomerServerReads.mock.calls[0]![4]).toEqual({ withHistory: true });
  });

  it("the device version gives office staff no history either", async () => {
    h.deviceOn.current = true;
    h.requireStaffPage.mockResolvedValue({ profile: { id: "u2", role: "office", locale: "he", full_name: null, email: "o@x.co" } });
    const page = (await open("c1")) as ReactElement;
    expect((viewOf(page, LocalCustomerPage).props as { serverReads: { history: unknown } }).serverReads.history).toBeNull();
  });

  it("no copy on this device: the server version — its reads after the role check, the view handed what came and what's coming", async () => {
    const page = (await open("c1")) as ReactElement;
    expect(h.order).toEqual(["profile", "reads"]);
    const [client, id, viewer] = h.startCustomerPageReads.mock.calls[0]!;
    expect(client).toEqual({ tag: "server-client" });
    expect(id).toBe("c1");
    await expect(viewer.role).resolves.toBe("admin");
    await expect(viewer.viewerId).resolves.toBe("u1");

    const props = viewOf(page, CustomerPageView).props as Record<string, unknown>;
    expect(props.top).toEqual({ customer: { id: "c1" } });
    expect(props.history).toBeInstanceOf(Promise);
    expect(props.viewer).toEqual({ id: "u1", role: "admin" });
    expect(props.today).toBe("2026-10-13");
  });

  it("?data=server — the way back from the device version: the server version, its reads at once", async () => {
    h.deviceOn.current = true;
    const page = (await open("c1", "server")) as ReactElement;
    expect(h.order).toEqual(["reads", "profile"]);
    expect(viewOf(page, CustomerPageView)).toBeTruthy();
  });

  it("gives office staff no history", async () => {
    h.requireStaffPage.mockResolvedValue({ profile: { id: "u2", role: "office", locale: "he", full_name: null, email: "o@x.co" } });
    const page = (await open("c1")) as ReactElement;
    expect((viewOf(page, CustomerPageView).props as { history: unknown }).history).toBeNull();
  });

  it("is a 404 for a customer that isn't there", async () => {
    h.startCustomerPageReads.mockReturnValue(reads(null));
    await expect(open("missing")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a caller who isn't staff is turned away before anything is shown — the reads' failures don't escape", async () => {
    const failing = { ...reads(null), top: Promise.reject(new Error("permission denied")) };
    h.startCustomerPageReads.mockReturnValue(failing);
    h.requireStaffPage.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    // ?data=server: the reads go out before the check, and must not leak when it refuses.
    await expect(open("c1", "server")).rejects.toThrow("NEXT_REDIRECT");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
