// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

// What device saves tell the person wherever they are: a refusal is a toast
// with its reason; a save that reached the server refreshes a page the server
// draws — never one drawn from the device copy (it shows the change already).

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toasts = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));
const copy = vi.hoisted(() => ({ db: { name: "device copy" }, retryParkedSaves: vi.fn(async () => {}) }));
vi.mock("@/lib/powersync/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/powersync/store")>()),
  useLocalDatabase: () => copy.db,
}));
vi.mock("@/lib/powersync/connector", () => ({ retryParkedSaves: copy.retryParkedSaves }));

import DeviceSaveNotices from "@/components/powersync/DeviceSaveNotices";
import { DEVICE_SAVE_REFUSED_EVENT, DEVICE_SAVE_SENT_EVENT } from "@/lib/powersync/local-writes";
import {
  DEVICE_SAVE_PARKED_EVENT,
  PARKED_SAVE_SENT_EVENT,
  PARKED_SAVES_RETRY_EVENT,
} from "@/lib/powersync/parked-saves";

describe("DeviceSaveNotices", () => {
  beforeEach(() => {
    router.refresh.mockReset();
    toasts.error.mockReset();
    toasts.warning.mockReset();
    toasts.success.mockReset();
    copy.retryParkedSaves.mockClear();
    document.body.innerHTML = "";
  });

  it("a save the server kept failing: a toast that it waits on the phone, and another when it has gone up", () => {
    render(<DeviceSaveNotices locale="he" />);
    window.dispatchEvent(
      new CustomEvent(DEVICE_SAVE_PARKED_EVENT, { detail: { kind: "expense-create", label: "הוצאה חדשה" } })
    );
    expect(toasts.warning).toHaveBeenCalledWith("השרת לא ענה — השמירה ממתינה בטלפון", {
      description: 'הוצאה חדשה. היא תישלח שוב לבד; אפשר לראות אותה ב"פרטים" בפס שלמעלה.',
      duration: 10_000,
    });
    window.dispatchEvent(new CustomEvent(PARKED_SAVE_SENT_EVENT, { detail: { kind: "expense-create", label: "הוצאה חדשה" } }));
    expect(toasts.success).toHaveBeenCalledWith("השמירה שהמתינה בטלפון הגיעה לשרת", { description: "הוצאה חדשה" });
  });

  it("parked saves are sent again when the connection comes back and when the waiting list asks", () => {
    render(<DeviceSaveNotices locale="he" />);
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new CustomEvent(PARKED_SAVES_RETRY_EVENT));
    expect(copy.retryParkedSaves).toHaveBeenCalledTimes(2);
    expect(copy.retryParkedSaves).toHaveBeenCalledWith(copy.db);
  });

  it("a refused save: a toast saying which and why", () => {
    render(<DeviceSaveNotices locale="he" />);
    window.dispatchEvent(new CustomEvent(DEVICE_SAVE_REFUSED_EVENT, { detail: { kind: "task-create", message: "אין הרשאה" } }));
    expect(toasts.error).toHaveBeenCalledWith("שגיאה ביצירת משימה", { description: "אין הרשאה" });
  });

  it("a save that reached the server: a page the server draws refreshes (once for a burst)", async () => {
    render(<DeviceSaveNotices locale="he" />);
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DEVICE_SAVE_SENT_EVENT, { detail: { kind: "task-status", id: "t1" } }));
      window.dispatchEvent(new CustomEvent(DEVICE_SAVE_SENT_EVENT, { detail: { kind: "task-status", id: "t2" } }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("…but not a page drawn from the device copy", async () => {
    const { container } = render(
      <>
        <span hidden data-device-page="tasks" />
        <DeviceSaveNotices locale="he" />
      </>
    );
    expect(container.querySelector("[data-device-page]")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new CustomEvent(DEVICE_SAVE_SENT_EVENT, { detail: { kind: "task-status", id: "t1" } }));
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
