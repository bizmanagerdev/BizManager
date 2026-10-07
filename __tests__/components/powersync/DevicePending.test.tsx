// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// A device whose copy hasn't finished downloading (a new device, after a
// logout, or a network that blocks the sync service) says so with a cookie;
// the server then sends the device pages' server version at once. The host
// keeps the cookie in step with the copy: set while it's incomplete, gone the
// moment the first download completes.

const device = vi.hoisted(() => ({ status: null as { hasSynced: boolean } | null }));
vi.mock("@/lib/powersync/store", () => ({
  useLocalSyncStatus: () => device.status,
  registerLocalDataWipe: () => {},
  setLocalViewer: () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/powersync/database", () => ({
  openLocalDatabase: async () => ({}),
  closeLocalDatabase: async () => {},
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }),
}));
vi.mock("@/lib/sentry-lazy", () => ({ withSentry: () => {} }));
vi.mock("@/components/powersync/LocalPagesWarmup", () => ({ default: () => null }));
vi.mock("@/lib/powersync/device-frames", () => ({ clearDeviceFrames: async () => {}, keepDeviceFramesFor: () => {} }));
const jar = vi.hoisted(() => ({ names: new Set<string>() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (name: string) => jar.names.has(name) }) }));

import LocalDataHost from "@/components/powersync/LocalDataHost";
import { deviceCopyPending, setDeviceCopyPending } from "@/lib/powersync/device-pending";
import { devicePageOn } from "@/lib/powersync/device-check";

const clearCookie = () => (document.cookie = "bizh-device-pending=; path=/; max-age=0");

describe("the device's note that its copy is incomplete", () => {
  beforeEach(() => {
    clearCookie();
    device.status = null;
    jar.names.clear();
  });

  it("is set and removed", () => {
    expect(deviceCopyPending()).toBe(false);
    setDeviceCopyPending(true);
    expect(deviceCopyPending()).toBe(true);
    setDeviceCopyPending(false);
    expect(deviceCopyPending()).toBe(false);
  });

  it("follows the copy: set while its first download isn't done, gone once it is — untouched before it opens", () => {
    document.cookie = "bizh-device-pending=1; path=/";
    const { rerender } = render(<LocalDataHost />);
    expect(deviceCopyPending()).toBe(true); // not open yet: nothing known, nothing changed

    clearCookie();
    device.status = { hasSynced: false };
    rerender(<LocalDataHost />);
    expect(deviceCopyPending()).toBe(true);

    device.status = { hasSynced: true };
    rerender(<LocalDataHost />);
    expect(deviceCopyPending()).toBe(false);
  });

  it("the server: device pages for admins and office — the server version while their device's copy is incomplete", async () => {
    const admin = { id: "a1", role: "admin" };
    expect(await devicePageOn("tasks", admin)).toBe(true);
    expect(await devicePageOn("tasks", { id: "w1", role: "worker" })).toBe(false);
    jar.names.add("bizh-device-pending");
    expect(await devicePageOn("tasks", admin)).toBe(false);
    expect(await devicePageOn("dashboard", admin)).toBe(false);
  });
});
