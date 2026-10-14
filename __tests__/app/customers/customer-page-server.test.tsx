import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

// The customer page's server part (page.tsx): it starts the reads at once —
// before the "who's asking" check answers — shows when the customer and its
// money are in, hands the rest on as they come, and gives the history to
// admins only. A customer that isn't there is a 404.

const h = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireStaffPage: vi.fn(),
  startCustomerPageReads: vi.fn(),
  order: [] as string[],
}));
vi.mock("next/navigation", () => ({ notFound: h.notFound }));
vi.mock("@/lib/auth/roleAccess", () => ({ requireStaffPage: h.requireStaffPage }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ tag: "server-client" }) }));
vi.mock("@/lib/timezone", () => ({ israelDateKey: () => "2026-10-13" }));
vi.mock("@/app/(app)/customers/[id]/loadCustomerPage", () => ({ startCustomerPageReads: h.startCustomerPageReads }));
vi.mock("@/components/layout/AppShell", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/app/(app)/customers/[id]/CustomerPageView", () => ({ default: () => null }));

import CustomerDetailsPage from "@/app/(app)/customers/[id]/page";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";

function reads(top: unknown) {
  return {
    top: Promise.resolve(top),
    payments: Promise.resolve({ payments: [] }),
    documents: Promise.resolve({ documents: [] }),
    history: Promise.resolve({ items: [] }),
  };
}

/** The element the page renders inside its AppShell. */
function viewOf(page: ReactElement) {
  return (page.props as { children: ReactElement }).children;
}

beforeEach(() => {
  h.notFound.mockClear();
  h.order.length = 0;
  h.requireStaffPage.mockReset().mockImplementation(async () => {
    // The check answers after a round trip.
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.order.push("profile");
    return { profile: { id: "u1", role: "admin", full_name: "דנה", email: "d@x.co" } };
  });
  h.startCustomerPageReads.mockReset().mockImplementation(() => {
    h.order.push("reads");
    return reads({ customer: { id: "c1" } });
  });
});

describe("the customer page on the server", () => {
  it("starts its reads before the role check has answered, and hands the view what came and what's coming", async () => {
    const page = (await CustomerDetailsPage({ params: Promise.resolve({ id: "c1" }) })) as ReactElement;
    expect(h.order).toEqual(["reads", "profile"]);
    const [client, id, viewer] = h.startCustomerPageReads.mock.calls[0]!;
    expect(client).toEqual({ tag: "server-client" });
    expect(id).toBe("c1");
    await expect(viewer.role).resolves.toBe("admin");
    await expect(viewer.viewerId).resolves.toBe("u1");

    const view = viewOf(page);
    expect(view.type).toBe(CustomerPageView);
    const props = view.props as Record<string, unknown>;
    expect(props.top).toEqual({ customer: { id: "c1" } });
    expect(props.history).toBeInstanceOf(Promise);
    expect(props.viewer).toEqual({ id: "u1", role: "admin" });
    expect(props.today).toBe("2026-10-13");
  });

  it("gives office staff no history", async () => {
    h.requireStaffPage.mockResolvedValue({ profile: { id: "u2", role: "office", full_name: null, email: "o@x.co" } });
    const page = (await CustomerDetailsPage({ params: Promise.resolve({ id: "c1" }) })) as ReactElement;
    expect((viewOf(page).props as { history: unknown }).history).toBeNull();
  });

  it("is a 404 for a customer that isn't there", async () => {
    h.startCustomerPageReads.mockReturnValue(reads(null));
    await expect(CustomerDetailsPage({ params: Promise.resolve({ id: "missing" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a caller who isn't staff is turned away before anything is shown — the reads' failures don't escape", async () => {
    const failing = { ...reads(null), top: Promise.reject(new Error("permission denied")) };
    h.startCustomerPageReads.mockReturnValue(failing);
    h.requireStaffPage.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    await expect(CustomerDetailsPage({ params: Promise.resolve({ id: "c1" }) })).rejects.toThrow("NEXT_REDIRECT");
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
