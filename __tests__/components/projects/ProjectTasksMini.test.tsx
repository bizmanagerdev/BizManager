// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The project page's task list speaks the tasks board's language (owner,
// 2026-10-11): a priority looks and reads the same here as on /tasks — urgent
// red, high orange, medium blue, low grey, in the feminine "דחופה / גבוהה /
// בינונית / נמוכה" — and its filter chips are the app's blue toggles.

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/tasks/device-task-saves", () => ({ saveTaskStatus: vi.fn() }));

import ProjectTasksMini from "@/app/(app)/projects/[id]/ProjectTasksMini";
import { getStatusColorClasses } from "@/lib/ui/status-color-classes";

afterEach(cleanup);

const TASKS = [
  { id: "t1", subject: "משימה א", status: "todo", priority: "urgent" },
  { id: "t2", subject: "משימה ב", status: "todo", priority: "high" },
  { id: "t3", subject: "משימה ג", status: "todo", priority: "medium" },
  { id: "t4", subject: "משימה ד", status: "done", priority: "low" },
];

function renderList() {
  render(<ProjectTasksMini projectId="p1" projectType="moving" tasks={TASKS} users={[]} onChange={() => {}} />);
}

function classesOf(color: Parameters<typeof getStatusColorClasses>[0]) {
  return getStatusColorClasses(color).split(" ");
}

describe("ProjectTasksMini", () => {
  it("each priority wears the board's colour and word", () => {
    renderList();
    expect(screen.getByText("דחופה")).toHaveClass(...classesOf("danger"));
    expect(screen.getByText("גבוהה")).toHaveClass(...classesOf("warning"));
    expect(screen.getByText("בינונית")).toHaveClass(...classesOf("info"));
    expect(screen.getByText("נמוכה")).toHaveClass(...classesOf("neutral"));
    // High is no longer the same red as urgent, nor the words masculine.
    expect(screen.getByText("גבוהה")).not.toHaveClass("bg-destructive-soft");
    for (const word of ["דחוף", "גבוה", "בינוני", "נמוך"]) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });

  it("the filter chips are blue toggles: the chosen one pressed and filled", () => {
    renderList();
    const all = screen.getByRole("button", { name: "הכל 4" });
    const open = screen.getByRole("button", { name: "פתוחות 3" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveClass("bg-secondary", "text-secondary-foreground");
    expect(open).toHaveAttribute("aria-pressed", "false");
    expect(open).not.toHaveClass("bg-secondary");

    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-pressed", "true");
    expect(open).toHaveClass("bg-secondary", "text-secondary-foreground");
    expect(all).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("משימה ד")).not.toBeInTheDocument();
  });
});
