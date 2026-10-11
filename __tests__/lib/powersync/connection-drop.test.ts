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
  ])("%s %s → a dropped connection", (message, description) => {
    expect(isConnectionDrop(message, description)).toBe(true);
  });

  it.each([
    ["Upload error", 'new row violates row-level security policy for table "payments"'],
    ["Sync error", "canceling statement due to statement timeout"],
    ["Sync error", "[PSYNC_S2105] Sync rules are not valid"],
    ["Upload error", ""],
  ])("%s %s → still an error", (message, description) => {
    expect(isConnectionDrop(message, description)).toBe(false);
  });
});
