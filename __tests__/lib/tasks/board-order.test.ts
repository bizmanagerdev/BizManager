// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { boardColumnOrderKey, readBoardColumnOrder, sortLikeBoard } from "@/lib/tasks/board-order";

// The dashboard lists tasks as the board shows them: the lists in the order
// the person arranged them, each top to bottom by its drag order.

const task = (id: string, status: string | null, sort_order: number | null) => ({ id, status, sort_order });

describe("sortLikeBoard", () => {
  it("lists come in the board's order; inside a list, the dragged order (unset last, then id)", () => {
    const tasks = [
      task("p1", "in_progress", 1),
      task("t3", "todo", null),
      task("t2", "todo", 20),
      task("t1", "todo", 10),
      task("b1", "blocked", 0),
      task("legacy", null, 5),
    ];
    expect(sortLikeBoard(tasks, ["todo", "in_progress", "done", "blocked"]).map((t) => t.id)).toEqual([
      "legacy", "t1", "t2", "t3", "p1", "b1",
    ]);
    expect(sortLikeBoard(tasks, ["blocked", "in_progress", "todo", "done"]).map((t) => t.id)).toEqual([
      "b1", "p1", "legacy", "t1", "t2", "t3",
    ]);
  });
});

describe("readBoardColumnOrder", () => {
  beforeEach(() => localStorage.clear());

  it("the board's default without a kept order, or for nobody", () => {
    expect(readBoardColumnOrder("u1")).toEqual(["todo", "in_progress", "done", "blocked"]);
    expect(readBoardColumnOrder(null)).toEqual(["todo", "in_progress", "done", "blocked"]);
  });

  it("the person's kept order, with any missing list after it and junk ignored", () => {
    localStorage.setItem(boardColumnOrderKey("u1"), JSON.stringify(["in_progress", "nope", "todo"]));
    expect(readBoardColumnOrder("u1")).toEqual(["in_progress", "todo", "done", "blocked"]);
    localStorage.setItem(boardColumnOrderKey("u2"), "{not json");
    expect(readBoardColumnOrder("u2")).toEqual(["todo", "in_progress", "done", "blocked"]);
  });
});
