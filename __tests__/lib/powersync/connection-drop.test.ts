import { describe, expect, it } from "vitest";
import { isConnectionDrop } from "@/lib/powersync/connection-drop";

// The messages are the week's real Sentry issues (2026-10-05 → 10-11).
describe("isConnectionDrop", () => {
  it.each([
    ["Sync error", ""],
    ["Failed to connect WebSocket", ""],
    ["No data received on WebSocket in 30000ms, closing connection.", ""],
    ["Sync error", "Closed. Original cause [Error: WebsocketDuplexConnection: Socket closed unexpectedly.]."],
    ["Sync error", "Closed. Original cause [Error: [PSYNC_S2103] JWT has expired]."],
    ["Sync error", "Connection closed."],
    ["Sync error", "TypeError: Failed to fetch"],
    // The week of 2026-10-21 → 27: most of the error-level events.
    ["Sync download error", "TypeError: network error"],
    ["Sync download error", "Remote peer closed with request in flight"],
    ["Sync error", "No keep-alive acks for 90000 millis"],
    ["Sync download error", "TypeError: Load failed"],
  ])("%s %s → a dropped connection", (message, description) => {
    expect(isConnectionDrop(message, description)).toBe(true);
  });

  it.each([
    ["Upload error", 'new row violates row-level security policy for table "payments"'],
    ["Sync error", "canceling statement due to statement timeout"],
    ["Sync error", "[PSYNC_S2105] Sync rules are not valid"],
    ["Upload error", ""],
    // The service refusing this device's copy, even wrapped in a WebSocket's error
    // (נתן's phone, 2026-10-26: it sat among the dropped-connection warnings).
    ["Sync error", "Closed. Original cause [Error: WebsocketDuplexConnection: [PSYNC_S2305] Too many parameter query results]."],
    ["Sync error", "[PSYNC_S2404] MongoDB server error evaluating parameter queries"],
  ])("%s %s → still an error", (message, description) => {
    expect(isConnectionDrop(message, description)).toBe(false);
  });
});
