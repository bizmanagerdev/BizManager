// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  OPEN_TASK_EVENT,
  openTaskHere,
  registerTaskOpener,
  taskIdFromHref,
  taskOpenerReady,
} from "@/lib/tasks/open-task-here";

// A dashboard task row opens its task right there (the + menu holds the form)
// instead of moving to the tasks board — and still navigates when nothing on
// screen can open it.

const ID = "03d7b8f1-1126-4216-a531-a5f07181cd0c";

describe("opening a task in place", () => {
  it("knows a task link from any other", () => {
    expect(taskIdFromHref(`/tasks/${ID}`)).toBe(ID);
    expect(taskIdFromHref(`/tasks/${ID}?from=dashboard`)).toBe(ID);
    expect(taskIdFromHref("/tasks/recurring")).toBeNull();
    expect(taskIdFromHref("/tasks")).toBeNull();
    expect(taskIdFromHref(`/projects/${ID}`)).toBeNull();
  });

  it("nothing on screen to open it: not handled (the link navigates)", () => {
    expect(taskOpenerReady()).toBe(false);
    expect(openTaskHere(ID)).toBe(false);
  });

  it("the + menu takes it: handled, with the task's id", () => {
    const opened: string[] = [];
    const listener = (event: Event) => {
      opened.push((event as CustomEvent<{ taskId: string }>).detail.taskId);
      event.preventDefault();
    };
    window.addEventListener(OPEN_TASK_EVENT, listener);
    const unregister = registerTaskOpener();
    expect(taskOpenerReady()).toBe(true);
    expect(openTaskHere(ID)).toBe(true);
    expect(opened).toEqual([ID]);
    unregister();
    window.removeEventListener(OPEN_TASK_EVENT, listener);
    expect(taskOpenerReady()).toBe(false);
  });
});
