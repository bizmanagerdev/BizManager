// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// A save the server kept failing waits in the list ("פעולות שממתינות לשליחה")
// until it has gone up: it can be sent now, or removed — removing asks first,
// since it then never reaches the server.

const h = vi.hoisted(() => ({
  db: { name: "device copy" },
  removeParkedSave: vi.fn(async () => {}),
  reportParked: vi.fn(),
  requestParkedRetry: vi.fn(),
}));

vi.mock("@/lib/offline-queue", () => ({
  CONNECTION_EVENTS: { changed: "bizh:connection-changed" },
  getQueue: () => [],
  getFailed: () => [],
  processQueue: async () => {},
  removeFailed: () => {},
  retryFailedEntry: () => {},
}));
vi.mock("@/lib/offline-upload", () => ({
  getUploadQueue: async () => [],
  getUploadFailed: async () => [],
  processUploadQueue: async () => {},
  removeFailedUpload: async () => {},
  retryFailedUpload: async () => {},
}));
vi.mock("@/lib/powersync/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/powersync/store")>()),
  useLocalDatabase: () => h.db,
}));
vi.mock("@/lib/powersync/device-saves-waiting", () => ({ readDeviceSavesWaiting: async () => [] }));
vi.mock("@/lib/powersync/parked-saves", () => ({
  useParkedSaves: () => [
    {
      id: "p1",
      table: "expenses",
      rowId: "e1",
      request: { kind: "expense-create", url: "/api/expenses/create", body: {} },
      key: "ps:expenses:e1:PUT:4",
      restore: null,
      label: "הוצאה חדשה",
      parkedAt: "2026-10-28T09:00:00.000Z",
      tries: 2,
      lastError: "HTTP 503",
    },
  ],
  removeParkedSave: h.removeParkedSave,
  reportParked: h.reportParked,
  requestParkedRetry: h.requestParkedRetry,
}));

import PendingSyncPanel from "@/components/layout/PendingSyncPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a parked save in the waiting list", () => {
  it("is listed as waiting for the server, and can be sent again now", async () => {
    render(<PendingSyncPanel open onOpenChange={() => {}} />);
    expect(await screen.findByText("הוצאה חדשה")).toBeTruthy();
    expect(screen.getByText(/השרת לא ענה · נשמר .* · יישלח שוב לבד/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "נסה שוב" }));
    expect(h.requestParkedRetry).toHaveBeenCalledTimes(1);
  });

  it("removing it asks first, then takes it off the list and tells Sentry", async () => {
    render(<PendingSyncPanel open onOpenChange={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "הסרה מהתור" }));
    expect(h.removeParkedSave).not.toHaveBeenCalled();
    expect(screen.getByText("להסיר את השמירה מהרשימה?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "הסרה" }));
    await waitFor(() => expect(h.removeParkedSave).toHaveBeenCalledWith(h.db, "p1"));
    await waitFor(() =>
      expect(h.reportParked).toHaveBeenCalledWith("removed", expect.objectContaining({ id: "p1" }), { tries: 2 })
    );
  });
});
