// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

// A project's page shows as soon as the project itself is read; its documents
// and every row's files, Morning documents, change-log lines and history fill
// in when the server sends them — and a refresh after a save keeps them on
// screen until the new ones arrive.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/projects/[id]/ProjectTabsClient", () => ({
  default: function Tabs(props: {
    documentsPending: boolean;
    projectDocuments: unknown[];
    expenses: Array<{ expense: { attachments?: unknown[] } | null }>;
    activitySection: unknown;
  }) {
    const files = props.expenses[0]?.expense?.attachments?.length ?? 0;
    return (
      <div>
        <span>{props.documentsPending ? "documents on their way" : `documents: ${props.projectDocuments.length}`}</span>
        <span>expense files: {files}</span>
        <div>{props.activitySection as never}</div>
      </div>
    );
  },
}));
vi.mock("@/app/(app)/projects/[id]/ProjectDetailsActions", () => ({ default: () => null, REMINDERS_SECTION_ID: "r" }));
vi.mock("@/app/(app)/projects/[id]/ProjectRemindersSection", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/ProjectMobileHeader", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/ProjectPageHeading", () => ({ default: () => null, projectTypeLabel: () => "" }));
vi.mock("@/components/projects/ProjectStatusPicker", () => ({ ProjectStatusPicker: () => null }));
vi.mock("@/components/customers/CustomerContactCard", () => ({ CustomerContactCard: () => null }));
vi.mock("@/app/(app)/activity/EntityActivityTimeline", () => ({
  default: ({ items }: { items: unknown[] }) => <span>history: {items.length}</span>,
}));

import { ProjectPageStreamed } from "@/app/(app)/projects/[id]/ProjectPageView";
import type { ProjectPageCore } from "@/lib/projects/project-page";
import type { ProjectPageExtras } from "@/app/(app)/projects/[id]/loadProjectPageExtras";

const core = {
  filters: { id: "p1" },
  currentVatRate: 0.18,
  dashboardRow: { id: "p1", name: "הובלה", status: "active", project_type: "moving", customer_id: "c1", customer_name: "דני" },
  details: { id: "p1" },
  workerBalance: null,
  projectTasks: [],
  assignableUsers: [],
  customers: [],
  projectExpenses: [{ id: "pe1", expense_id: "e1" }],
  expenses: [{ id: "e1", expense_date: "2026-10-01" }],
  salaryAgreements: [],
  monthlySalaryItems: [],
  attendanceSessions: [],
  sessionDebtById: {},
  wageAccountIdsBySource: {},
  payments: [],
  paymentRecordedByNameByValue: {},
  expenseRecordedByNameByValue: {},
  recurringTemplateNames: {},
  recurringTemplateAuthors: {},
  customerRow: null,
  branchRow: null,
  accountNameById: {},
  owed: { total: 0 },
  errors: { overview: null, projectExpenses: null, expenses: null, sessions: null, payments: null },
} as unknown as ProjectPageCore;

const extras = (documents: number): ProjectPageExtras => ({
  projectDocuments: Array.from({ length: documents }, (_, i) => ({ document_id: `d${i}` }) as never),
  projectDocumentsError: null,
  attachments: { expense: { e1: [{ document_id: "f1" } as never] }, session: {}, payment: {} },
  expenseAudit: {},
  paymentAudit: {},
  morningDocuments: [],
  morningDocumentsError: null,
  activity: [{ id: "h1" } as never],
});

const viewer = { role: "admin", ledgerPrefs: {} as never };

describe("ProjectPageStreamed", () => {
  afterEach(cleanup);

  it("the project at once; the server's parts fill in; a refresh keeps them until the new ones arrive", async () => {
    let deliver: (value: ProjectPageExtras) => void = () => {};
    const first = new Promise<ProjectPageExtras>((resolve) => (deliver = resolve));
    const { rerender } = render(<ProjectPageStreamed id="p1" core={core} extras={first} viewer={viewer} />);

    expect(await screen.findByText("documents on their way")).toBeTruthy();
    expect(screen.getByText("expense files: 0")).toBeTruthy();

    await act(async () => deliver(extras(2)));
    expect(screen.getByText("documents: 2")).toBeTruthy();
    expect(screen.getByText("expense files: 1")).toBeTruthy();
    expect(screen.getByText("history: 1")).toBeTruthy();

    // A refresh: a new promise — what's on screen stays until it arrives.
    let again: (value: ProjectPageExtras) => void = () => {};
    const second = new Promise<ProjectPageExtras>((resolve) => (again = resolve));
    rerender(<ProjectPageStreamed id="p1" core={core} extras={second} viewer={viewer} />);
    expect(screen.getByText("documents: 2")).toBeTruthy();
    await act(async () => again(extras(3)));
    expect(screen.getByText("documents: 3")).toBeTruthy();

    // Another project in the same place: never the last one's documents.
    const other = new Promise<ProjectPageExtras>(() => {});
    rerender(<ProjectPageStreamed id="p2" core={{ ...core, filters: { id: "p2" } }} extras={other} viewer={viewer} />);
    expect(screen.getByText("documents on their way")).toBeTruthy();
  });
});
