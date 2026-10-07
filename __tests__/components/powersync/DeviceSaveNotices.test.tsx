// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

// What device saves tell the person wherever they are: a refusal is a toast
// with its reason; a save that reached the server refreshes a page the server
// draws — never one drawn from the device copy (it shows the change already).

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import DeviceSaveNotices from "@/components/powersync/DeviceSaveNotices";
import { DEVICE_SAVE_REFUSED_EVENT, DEVICE_SAVE_SENT_EVENT } from "@/lib/powersync/local-writes";

describe("DeviceSaveNotices", () => {
  beforeEach(() => {
    router.refresh.mockReset();
    toasts.error.mockReset();
    document.body.innerHTML = "";
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
