// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  TaskCommentsPanel,
  TaskDatesSection,
  TaskDescriptionSection,
  TaskHistorySection,
  TaskLabelsSection,
  TaskLocationSection,
  TaskPendingFilesSection,
  TaskRemindersStagingSection,
  type CommentItem,
  type HistoryItem,
} from "@/components/tasks/TaskUpsertDialog.ui";

// Scoped to the sections that are self-contained (no next/navigation, no
// Radix Popper, no ProjectPicker/TagPicker/DomainSelect/SearchableSelect
// deps) — TaskDomainSection and TaskPeopleSection pull in enough extra
// machinery to be a separate follow-up.
describe("TaskDescriptionSection", () => {
  it("renders the current description and emits edits", () => {
    const onChange = vi.fn();
    render(<TaskDescriptionSection description="תיאור נוכחי" onChange={onChange} locale="he" />);
    const textarea = screen.getByDisplayValue("תיאור נוכחי");
    fireEvent.change(textarea, { target: { value: "תיאור חדש" } });
    expect(onChange).toHaveBeenCalledWith("תיאור חדש");
  });
});

describe("TaskDatesSection", () => {
  it("wires the date and time inputs to their own onChange callbacks", () => {
    const onDueDateChange = vi.fn();
    const onDueTimeChange = vi.fn();
    render(
      <TaskDatesSection
        dueDate="2026-09-17"
        onDueDateChange={onDueDateChange}
        dueTime="14:30"
        onDueTimeChange={onDueTimeChange}
        locale="he"
      />
    );
    expect(screen.getByDisplayValue("17/09/26")).toBeInTheDocument();
    const timeInput = screen.getByDisplayValue("14:30");
    fireEvent.change(timeInput, { target: { value: "15:00" } });
    expect(onDueTimeChange).toHaveBeenCalledWith("15:00");
  });
});

describe("TaskLabelsSection", () => {
  it("renders every priority/status option and reports a change", () => {
    const onPriorityChange = vi.fn();
    const onStatusChange = vi.fn();
    render(
      <TaskLabelsSection
        priority="medium"
        onPriorityChange={onPriorityChange}
        status="todo"
        onStatusChange={onStatusChange}
        locale="he"
      />
    );
    const [prioritySelect, statusSelect] = screen.getAllByRole("combobox");
    expect(prioritySelect).toHaveValue("medium");
    expect(statusSelect).toHaveValue("todo");

    fireEvent.change(prioritySelect, { target: { value: "urgent" } });
    expect(onPriorityChange).toHaveBeenCalledWith("urgent");
  });
});

describe("TaskLocationSection", () => {
  it("switching the city select to the 'other' sentinel clears the city and shows a free-text field", () => {
    const setCity = vi.fn();
    const setCityOther = vi.fn();
    const { rerender } = render(
      <TaskLocationSection
        city="תל אביב"
        setCity={setCity}
        cityOther={false}
        setCityOther={setCityOther}
        address=""
        onAddressChange={() => {}}
        locale="he"
      />
    );
    const citySelect = screen.getByDisplayValue("תל אביב");
    fireEvent.change(citySelect, { target: { value: "אחר" } });
    expect(setCityOther).toHaveBeenCalledWith(true);
    expect(setCity).toHaveBeenCalledWith("");

    // Once cityOther is true, a free-text city field appears.
    rerender(
      <TaskLocationSection
        city=""
        setCity={setCity}
        cityOther
        setCityOther={setCityOther}
        address=""
        onAddressChange={() => {}}
        locale="he"
      />
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(2); // free-text city + address
  });
});

describe("TaskRemindersStagingSection", () => {
  it("disables staging a reminder until a date/time is chosen", () => {
    render(
      <TaskRemindersStagingSection
        pendingReminders={[]}
        reminderAt=""
        setReminderAt={() => {}}
        reminderNote=""
        setReminderNote={() => {}}
        onStage={() => {}}
        onRemove={() => {}}
        locale="he"
      />
    );
    expect(screen.getByRole("button", { name: "הוספת תזכורת" })).toBeDisabled();
  });

  it("lists staged reminders and removes one on request", () => {
    const onRemove = vi.fn();
    render(
      <TaskRemindersStagingSection
        pendingReminders={[{ remind_at: "2026-09-17T09:00", content: "להתקשר ללקוח" }]}
        reminderAt="2026-09-18T09:00"
        setReminderAt={() => {}}
        reminderNote=""
        setReminderNote={() => {}}
        onStage={() => {}}
        onRemove={onRemove}
        locale="he"
      />
    );
    expect(screen.getByText("להתקשר ללקוח")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הוספת תזכורת" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "הסרת תזכורת" }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe("TaskPendingFilesSection", () => {
  it("shows an empty-state note with no files staged", () => {
    render(<TaskPendingFilesSection files={[]} onAdd={() => {}} onRemove={() => {}} locale="he" />);
    expect(screen.getByText(/אפשר לצרף קבצים/)).toBeInTheDocument();
  });

  it("lists staged files and removes one on request", () => {
    const onRemove = vi.fn();
    const file = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    render(<TaskPendingFilesSection files={[file]} onAdd={() => {}} onRemove={onRemove} locale="he" />);
    expect(screen.getByText("photo.jpg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /הסרת/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe("TaskCommentsPanel", () => {
  const baseProps = {
    legacyNotes: [],
    newComment: "",
    setNewComment: vi.fn(),
    addingComment: false,
    onAddComment: vi.fn(),
    colorIndexById: new Map<string, number>(),
    chosenColorById: new Map<string, string>(),
    locale: "he" as const,
  };

  it("shows the Hebrew translation for a Hebrew-locale reader, and the original body otherwise", () => {
    const comments: CommentItem[] = [
      {
        id: "c1",
        author_id: "u1",
        author_name: "עובד",
        body: "Original Arabic text",
        body_he: "תרגום לעברית",
        created_at: "2026-09-17T09:00:00",
      },
    ];
    // locale="he" (an office reader): the Hebrew translation of an Arabic
    // worker's comment, not the original — this is baseProps' default.
    const { rerender } = render(<TaskCommentsPanel {...baseProps} comments={comments} />);
    expect(screen.getByText("תרגום לעברית")).toBeInTheDocument();

    // locale="ar" (the worker who wrote it): their own original text.
    rerender(<TaskCommentsPanel {...baseProps} comments={comments} locale="ar" />);
    expect(screen.getByText("Original Arabic text")).toBeInTheDocument();
  });

  it("disables the add-comment button until there's real text", () => {
    render(<TaskCommentsPanel {...baseProps} comments={[]} />);
    expect(screen.getByRole("button", { name: "הוספת תגובה" })).toBeDisabled();
  });
});

describe("TaskHistorySection", () => {
  it("renders each history entry's actor, action and details", () => {
    const history: HistoryItem[] = [
      {
        id: "h1",
        actor_name: "רותי",
        created_at: "2026-09-17T09:00:00",
        action_label: "שינה סטטוס",
        details: "מ'לביצוע' ל'בוצע'",
      },
    ];
    render(<TaskHistorySection history={history} locale="he" />);
    expect(screen.getByText("רותי")).toBeInTheDocument();
    expect(screen.getByText(/שינה סטטוס/)).toBeInTheDocument();
    expect(screen.getByText(/מ'לביצוע' ל'בוצע'/)).toBeInTheDocument();
  });
});
