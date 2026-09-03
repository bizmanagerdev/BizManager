"use client";

import { useEffect } from "react";
import { undoLast } from "@/lib/undo-engine";

/**
 * Global Ctrl+Z / Cmd+Z — undoes the most recent still-pending delete/edit/
 * create anywhere in the app. Mounted once in AppShell, same as
 * ConnectionToasts. Ignores keydowns while focus is in an input/textarea/
 * contenteditable so it never hijacks the browser's own text-field undo — see
 * ExpenseDialog's express-mode listener (components/expenses/ExpenseDialog.tsx)
 * for the precedent and the past bug it guards against: a stale global window
 * listener silently swallowing keystrokes app-wide.
 *
 * Checks `e.code` (the physical key, e.g. "KeyZ"), not `e.key` — this is a
 * Hebrew-primary app, and `e.key` reflects the character the active keyboard
 * LAYOUT produces (on a Hebrew layout, the physical Z key produces "ז", not
 * "z"), so a `e.key === "z"` check silently never fires under Hebrew input.
 * `e.code` is layout-independent and works the same regardless of language.
 */
export default function UndoHotkeyListener() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.code !== "KeyZ") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      if (undoLast()) e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
