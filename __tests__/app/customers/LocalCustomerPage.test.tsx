// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

// A customer's page drawn from the device copy (LocalCustomerPage, 2026-10-20):
// what the device works out shows at once; what only the server reads (the call
// log, promises, Morning documents, a linked worker's pay) fills in when it
// arrives; a customer the copy doesn't hold yet gets the server version.

const h = vi.hoisted(() => ({
  card: { current: null as unknown },
}));

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/components/layout/page-title-context", () => ({ useSetPageTitle: () => {} }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn(), CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: vi.fn() }));
vi.mock("@/lib/documents/checklist", () => ({ fetchChecklistForEntity: vi.fn(async () => []) }));
vi.mock("@/lib/documents/updateDocumentTag", () => ({ updateDocumentTag: vi.fn() }));
vi.mock("@/hooks/useAssignableUsers", () => ({ useAssignableUsers: () => ({ users: [], currentUserId: "u1", loading: false }) }));
vi.mock("@/components/collections/AssigneeSelect", () => ({ AssigneeSelect: () => null }));
vi.mock("@/components/collections/CommunicationLogItem", () => ({
  default: ({ log }: { log: { content: string | null } }) => <div>{log.content}</div>,
}));
vi.mock("@/components/morning/MorningDocumentsPanel", () => ({ default: () => null }));
vi.mock("@/components/morning/MorningQuoteDialog", () => ({ default: () => null }));
vi.mock("@/components/customers/EditCustomerDialog", () => ({ EditCustomerDialog: () => null }));
vi.mock("@/components/tasks/TaskUpsertDialog", () => ({ TaskUpsertDialog: () => null }));
vi.mock("@/components/powersync/useLocalCard", () => ({
  useLocalCard: () => h.card.current,
  // The server answering: its server version (with no connection it waits — useLocalCard-offline.test).
  showServerVersion: (router: { replace: (href: string) => void }, _page: string, href: string) => router.replace(href),
}));
vi.mock("@/components/powersync/useDevicePageTiming", () => ({ useDevicePageTiming: () => {} }));

import { replace } from "@/__tests__/mocks/next-navigation";
import LocalCustomerPage from "@/app/(app)/customers/[id]/LocalCustomerPage";
import type { CustomerPageCore, CustomerServerParts } from "@/app/(app)/customers/[id]/customerPageCore";
import { makeTop, order, settled, NO_DOCUMENTS, NO_HISTORY, NO_PAYMENTS } from "@/__tests__/app/customers/customerPageFixtures";

function deviceCore(): CustomerPageCore {
  // A customer who still owes: the collection section opens with the page.
  const { balance: _b, morningDocuments: _m, collection: _c, promises: _p, ...rest } = makeTop({
    orders: [order("o1", { remaining: 300, collected: 700 })],
  });
  return { ...rest, receivables: [], loans: { owedToUs: 0, owedByUs: 0 }, manages: true };
}

function cardFor(core: CustomerPageCore | null) {
  return { data: { filters: { id: "c1" }, core, payments: NO_PAYMENTS }, source: "device", filtersKey: "" };
}

const viewer = { userId: "u1", role: "admin", locale: "he" as const };

afterEach(() => {
  h.card.current = null;
  replace.mockClear();
  vi.useRealTimers();
});

describe("a customer's page from the device", () => {
  it("before the device has answered: the page's loading shape", () => {
    render(
      <LocalCustomerPage
        id="c1"
        viewer={viewer}
        serverReads={{ server: new Promise(() => {}), documents: settled(NO_DOCUMENTS), history: settled(NO_HISTORY) }}
      />
    );
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("חברת אלון")).toBeNull();
  });

  it("shows the device's part at once, and the server's call log when it arrives", async () => {
    h.card.current = cardFor(deviceCore());
    let arrive: (parts: CustomerServerParts) => void = () => {};
    const server = new Promise<CustomerServerParts>((resolve) => (arrive = resolve));
    render(
      <LocalCustomerPage id="c1" viewer={viewer} serverReads={{ server, documents: settled(NO_DOCUMENTS), history: settled(NO_HISTORY) }} />
    );
    expect(screen.getAllByText("חברת אלון").length).toBeGreaterThan(0);
    expect(screen.queryByText("דיבר עם יוסי, ישלם ביום ראשון")).toBeNull();

    await act(async () => {
      arrive({
        morningDocuments: [],
        activity: {
          logs: [
            {
              id: "log1", customer_id: "c1", user_id: "u1", channel: "phone", direction: "outbound",
              content: "דיבר עם יוסי, ישלם ביום ראשון", category: "collection", order_id: null, project_id: null,
              property_id: null, payment_id: null, created_by: "u1", created_at: "2026-10-19T08:00:00Z", created_by_name: "דנה",
            },
          ],
          reminders: [],
        },
        promises: [],
        payrollOwed: null,
      });
      await server;
    });
    expect(screen.getByText("דיבר עם יוסי, ישלם ביום ראשון")).toBeTruthy();
  });

  it("a customer the device's copy doesn't hold yet: the server version, after a moment", () => {
    vi.useFakeTimers();
    h.card.current = cardFor(null);
    render(
      <LocalCustomerPage
        id="c1"
        viewer={viewer}
        serverReads={{ server: new Promise(() => {}), documents: settled(NO_DOCUMENTS), history: settled(NO_HISTORY) }}
      />
    );
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2600));
    expect(replace).toHaveBeenCalledWith("/customers/c1?data=server");
  });
});
