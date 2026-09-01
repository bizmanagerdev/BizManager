// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
// MarkCollectedButton (rendered deep inside DebtorsTable's row detail) uses
// useRouter — mocked once here via the shared __tests__/mocks/next-navigation
// so any test in this file can render components that pull it in.
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

import { fireEvent, render, screen } from "@testing-library/react";
import { TodayOverview, ViewTab } from "@/app/(app)/collections/CollectionsClient.ui";
import { PhoneIcon } from "@/components/ui/icons";
import type { Reminder } from "@/lib/communications";
import type { PaymentDueToday } from "@/lib/collections";

// Scoped to the two self-contained EXPORTED pieces with real logic and no
// heavy fixture requirements. `DebtorsTable`/`RemindersView`/`ActivityView`
// need full `CollectionCustomerGroup`/aging/source fixtures plus
// CustomerCollectionButton/BulkActions/CommunicationLogItem rendering — a
// bigger, fixture-heavy undertaking better scoped as its own follow-up.
describe("ViewTab", () => {
  it("renders the icon and label, and reflects active state via styling", () => {
    const onClick = vi.fn();
    render(
      <ViewTab active icon={PhoneIcon} onClick={onClick}>
        שיחות
      </ViewTab>
    );
    const tab = screen.getByRole("button", { name: "שיחות" });
    expect(tab.className).toContain("text-primary");
    fireEvent.click(tab);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("an inactive tab is styled muted instead", () => {
    render(
      <ViewTab active={false} icon={PhoneIcon} onClick={() => {}}>
        שיחות
      </ViewTab>
    );
    expect(screen.getByRole("button", { name: "שיחות" }).className).toContain("text-muted-foreground");
  });
});

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r1",
    remind_at: "2026-09-17T09:00:00",
    action_type: "call",
    content: null,
    customer_id: "c1",
    customer_name: "דוד כהן",
    customer_phone: "0501234567",
    task_id: null,
    task_subject: null,
    ...overrides,
  } as Reminder;
}

function dueToday(overrides: Partial<PaymentDueToday> = {}): PaymentDueToday {
  return {
    id: "p1",
    amount: 500,
    customer_id: "c1",
    customer_name: "דוד כהן",
    customer_phone: null,
    source_type: "order",
    source_id: "o1",
    payment_method: null,
    check_number: null,
    ...overrides,
  } as PaymentDueToday;
}

describe("TodayOverview", () => {
  it("renders nothing on a clear day (no due reminders, no due payments)", () => {
    const { container } = render(
      <TodayOverview reminders={[]} dueToday={[]} collectingId={null} onCollect={() => {}} onUpdateReminder={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only reminders due today or earlier, not future ones", () => {
    render(
      <TodayOverview
        reminders={[reminder({ id: "past", remind_at: "2020-01-01T09:00:00" }), reminder({ id: "future", remind_at: "2099-01-01T09:00:00" })]}
        dueToday={[]}
        collectingId={null}
        onCollect={() => {}}
        onUpdateReminder={() => {}}
      />
    );
    // Count in the section title confirms only the past one made it through the filter.
    expect(screen.getByText(/תזכורות להיום \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("דוד כהן")).toBeInTheDocument();
  });

  it("marking a reminder done calls onUpdateReminder with 'done'", () => {
    const onUpdateReminder = vi.fn();
    render(
      <TodayOverview
        reminders={[reminder({ id: "r1", remind_at: "2020-01-01T09:00:00" })]}
        dueToday={[]}
        collectingId={null}
        onCollect={() => {}}
        onUpdateReminder={onUpdateReminder}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "בוצע" }));
    expect(onUpdateReminder).toHaveBeenCalledWith("r1", "done");
  });

  it("shows today's due payments with their total, and collecting one calls onCollect", () => {
    const onCollect = vi.fn();
    render(
      <TodayOverview
        reminders={[]}
        dueToday={[dueToday({ id: "p1", amount: 300 }), dueToday({ id: "p2", amount: 200 })]}
        collectingId={null}
        onCollect={onCollect}
        onUpdateReminder={() => {}}
      />
    );
    expect(screen.getByText(/תשלומים לפירעון היום/)).toBeInTheDocument();
    // 300 + 200 total — he-IL currency formatting inserts RTL marks (U+200F)
    // and spacing around the digits, so match loosely rather than an exact
    // "₪500" string.
    expect(
      screen.getByText((_, el) => el?.textContent?.replace(/[\s‎‏]/g, "") === "500₪")
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "סמן כנגבה" })[0]);
    expect(onCollect).toHaveBeenCalledWith("p1");
  });

  it("shows a busy label for the payment currently being collected", () => {
    render(
      <TodayOverview
        reminders={[]}
        dueToday={[dueToday({ id: "p1" })]}
        collectingId="p1"
        onCollect={() => {}}
        onUpdateReminder={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "מסמן..." })).toBeDisabled();
  });
});
