// Global setup for Vitest. Runs before EVERY test file, including the plain
// "node"-environment ones (lib/api/security) — so anything here that touches
// `window`/`document` must be guarded, or those suites break.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  // `test.globals` is off project-wide (existing suites import from "vitest"
  // explicitly), so @testing-library/react's auto-cleanup — which only fires
  // when it finds a global `afterEach` — never kicks in on its own. Without
  // this, each render() in a component test file piles onto the previous
  // one's DOM instead of replacing it, and queries start matching duplicates.
  afterEach(cleanup);

  // jsdom doesn't implement these; Radix (Popover/Dialog/DropdownMenu — used by
  // SearchableSelect, ConfirmDialog, etc.) reads them during open/close/position.
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // @ts-expect-error - test polyfill
    window.ResizeObserver = ResizeObserverStub;
  }

  if (!window.matchMedia) {
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }

  // jsdom has no PointerEvent constructor. Without this, fireEvent.pointerDown/
  // Move/Up (testing-library/dom) falls back to a plain `Event`, which silently
  // drops clientX/clientY/pointerType/button from the init dict instead of
  // setting them — breaking any component (e.g. SwipeActions) that reads real
  // pointer coordinates. Modeled on MouseEvent, same as @testing-library/
  // user-event's own internal fallback.
  if (!("PointerEvent" in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
        this.isPrimary = params.isPrimary ?? true;
      }
    }
    // @ts-expect-error - test polyfill
    window.PointerEvent = PointerEventPolyfill;
  }
}
