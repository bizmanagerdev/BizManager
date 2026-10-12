// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The project page's task list speaks the tasks board's language (owner,
// 2026-10-11): a priority looks and reads the same here as on /tasks — urgent
// red, high orange, medium blue, low grey, in the feminine "דחופה / גבוהה /
// בינונית / נמוכה" — and its filter chips are the app's blue toggles.

vi.mock("next/dynamic", () => ({ default: () => () => null }));
const saves = vi.hoisted(() => ({ saveTaskStatus: vi.fn() }));
vi.mock("@/lib/tasks/device-task-saves", () => saves);

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

  // "Done" looks the same everywhere (owner, 2026-10-11): the square tick the
  // dashboard and the board use, not the browser's own checkbox.
  it("each task's done is the square tick; a tap marks it done at once and saves it", async () => {
    saves.saveTaskStatus.mockResolvedValue({ ok: true, queued: false, onDevice: true });
    const { container } = render(
      <ProjectTasksMini projectId="p1" projectType="moving" tasks={TASKS} users={[]} onChange={() => {}} />
    );
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    const ticks = screen.getAllByRole("checkbox");
    expect(ticks).toHaveLength(4);
    const open = screen.getAllByRole("checkbox", { name: "סימון כהושלמה" })[0]!;
    expect(open).toHaveAttribute("aria-checked", "false");
    expect(open.querySelector("svg")).toHaveClass("lucide-square");
    const done = screen.getByRole("checkbox", { name: "סימון כלא הושלמה" });
    expect(done).toHaveAttribute("aria-checked", "true");
    expect(done.querySelector("svg")).toHaveClass("lucide-square-check-big", "text-success");

    fireEvent.click(open);
    expect(open).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(saves.saveTaskStatus).toHaveBeenCalledWith("t1", "done", "עדכון סטטוס משימה"));
  });

  it("a filter with nothing in it shows the app's empty box", () => {
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "הושלמו 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "סימון כלא הושלמה" }));
    expect(screen.getByText("אין משימות להצגה.").closest(".border-dashed")).not.toBeNull();
  });
});
