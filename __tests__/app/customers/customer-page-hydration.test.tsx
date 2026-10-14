// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { Suspense, lazy, type ComponentProps, type ComponentType, type ReactElement } from "react";

// The customer page as the browser takes over the server's HTML: the first
// browser render must produce exactly what the server rendered. On the old
// page a document's ⋮ (Radix, "פעולות") got a different id in the browser
// than on the server ("radix-_R_aq…" vs "radix-_R_1bab…") — the tree differed
// between the two (2026-10-13). The page is one client tree now, drawn from
// the same data on both sides, with the day it was drawn on handed down.

vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/components/layout/page-title-context", () => ({ useSetPageTitle: () => {} }));
vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn(), CONNECTION_EVENTS: { synced: "biz:conn-synced" } }));
vi.mock("@/lib/offline-upload", () => ({ offlineUpload: vi.fn() }));
vi.mock("@/lib/documents/checklist", () => ({ fetchChecklistForEntity: vi.fn(async () => []) }));
vi.mock("@/lib/documents/updateDocumentTag", () => ({ updateDocumentTag: vi.fn() }));
vi.mock("@/hooks/useAssignableUsers", () => ({ useAssignableUsers: () => ({ users: [], currentUserId: "u1", loading: false }) }));
vi.mock("@/components/collections/AssigneeSelect", () => ({ AssigneeSelect: () => null }));
vi.mock("@/components/morning/MorningDocumentsPanel", () => ({ default: () => null }));
vi.mock("@/components/morning/MorningQuoteDialog", () => ({ default: () => null }));
vi.mock("@/components/customers/EditCustomerDialog", () => ({ EditCustomerDialog: () => null }));
vi.mock("@/components/tasks/TaskUpsertDialog", () => ({ TaskUpsertDialog: () => null }));

import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";
import { makeTop, order, paymentRow, settled, NO_HISTORY } from "@/__tests__/app/customers/customerPageFixtures";

let root: Root | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The server's HTML, hydrated by `client`; everything React reported on the way. */
async function hydrate(serverHtml: string, client: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);
  const reported: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args) => reported.push(args.map(String).join(" ")));
  root = hydrateRoot(container, client, { onRecoverableError: (error) => reported.push(String(error)) });
  // Hydration runs in the background; let it finish, lazy modules and all.
  await new Promise((resolve) => setTimeout(resolve, 200));
  return { container, reported };
}

type Props = ComponentProps<typeof CustomerPageView>;

function props(): Props {
  return {
    top: makeTop({
      orders: [order("o1"), order("o2", { remaining: 300, collected: 700 })],
      tasks: [
        {
          id: "t1",
          subject: "לחזור עם הצעה",
          status: "todo",
          priority: "high",
          // Overdue by the server's today (13/10) — and still by any later one.
          due_date: "2026-10-12",
          assigned_user_name: null,
          has_open_reminder: false,
          is_private: false,
        },
        {
          id: "t2",
          subject: "לאסוף צ׳ק",
          status: "todo",
          priority: null,
          // Due "today" on the server; a device whose day has already turned calls it late.
          due_date: "2026-10-13",
          assigned_user_name: null,
          has_open_reminder: false,
          is_private: false,
        },
      ],
      contacts: [
        { id: "k1", fullName: "רונית", role: "הנהלת חשבונות", phone: "052-1111111", email: null, whatsapp: null, isPrimary: true, active: true, notes: null },
      ],
    }),
    payments: settled({ payments: [paymentRow("p1")], lastPaymentAt: "2026-09-10", error: null }),
    documents: settled({
      documents: [
        { id: "d1", name: "חוזה", fileName: "contract.pdf", type: "חוזה/הסכם", uploadedAt: "2026-10-01T08:00:00Z", url: "https://files.test/c.pdf", sourceType: "customer", sourceId: "c1" },
        { id: "d2", name: "חשבונית", fileName: "inv.pdf", type: null, uploadedAt: "2026-09-01T08:00:00Z", url: "https://files.test/i.pdf", sourceType: "order", sourceId: "o1" },
      ],
      total: 2,
      error: null,
    }),
    history: settled(NO_HISTORY),
    viewer: { id: "u1", role: "admin" },
    today: "2026-10-13",
  };
}

describe("the customer page in the browser", () => {
  it("hydrates with the server's ids — the documents' ⋮ and the heading's — while its code is still arriving", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // The server draws it on the 13th, 23:59 in Israel.
    vi.setSystemTime(new Date("2026-10-13T20:59:00.000Z"));
    const page = (view: ReactElement) => (
      <Suspense fallback={null}>
        <div>{[<div key="banner">באנר</div>, <div key="page">{view}</div>]}</div>
      </Suspense>
    );
    const html = renderToString(page(<CustomerPageView {...props()} />));
    const serverIds = Array.from(html.matchAll(/id="(radix-[^"]+)"/g), (match) => match[1]);
    expect(serverIds.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("לחזור עם הצעה");

    // The browser takes over a minute later — past midnight, a new day.
    vi.setSystemTime(new Date("2026-10-13T21:01:00.000Z"));
    const LoadingView = lazy(
      () =>
        new Promise<{ default: ComponentType<Props> }>((resolve) => {
          queueMicrotask(() => resolve({ default: CustomerPageView }));
        })
    );
    const { container, reported } = await hydrate(html, page(<LoadingView {...props()} />));

    expect(reported).toEqual([]);
    const clientIds = Array.from(container.querySelectorAll('[id^="radix-"]'), (node) => node.id);
    expect(clientIds).toEqual(serverIds);
  });
});
