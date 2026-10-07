import type { MouseEvent } from "react";

// Open a task in its form right where you are — the dashboard's task rows —
// instead of moving to the tasks board to open it there (owner, 2026-10-07: a
// tap went through two pages, 0.4 s). The + menu (components/layout/
// QuickCreateMenu, on every screen) holds the form and answers this; when
// nothing answers, the link just navigates as before.

export const OPEN_TASK_EVENT = "bizh:open-task";

/** Marks a link that opens its task in place — the loading bar leaves it alone (no page move). */
export const OPENS_HERE_ATTRIBUTE = "data-opens-here";

let openers = 0;

/** The + menu says it's there to open tasks (until the returned function is called). */
export function registerTaskOpener(): () => void {
  openers += 1;
  return () => {
    openers -= 1;
  };
}

/** Is something on screen that opens a task in place? */
export function taskOpenerReady(): boolean {
  return openers > 0;
}

/** The task behind a `/tasks/<id>` link, or null for any other link. */
export function taskIdFromHref(href: string): string | null {
  const match = /^\/tasks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#].*)?$/i.exec(href);
  return match ? match[1] : null;
}

/** Ask the + menu to open task `id` in place; true if it did (it cancels the event when it takes it). */
export function openTaskHere(id: string): boolean {
  if (typeof window === "undefined") return false;
  const event = new CustomEvent(OPEN_TASK_EVENT, { detail: { taskId: id }, cancelable: true });
  return !window.dispatchEvent(event);
}

/** A task link's onClick: a plain click opens the task here; anything else (new tab…) navigates. */
export function openTaskOnClick(id: string) {
  return (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (openTaskHere(id)) event.preventDefault();
  };
}
