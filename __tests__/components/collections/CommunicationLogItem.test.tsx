// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// A logged call's time, in the app's one format and in Israel time on any
// device. It used the browser's own toLocaleString — the device's zone, and
// the server's (UTC) when the customer page drew it there: the two disagreed.

vi.mock("@/lib/offline-queue", () => ({ offlineFetch: vi.fn() }));
vi.mock("next/navigation", () => import("@/__tests__/mocks/next-navigation"));

import CommunicationLogItem from "@/components/collections/CommunicationLogItem";

describe("CommunicationLogItem", () => {
  it("states when the call was, dd/mm/yy hh:mm in Israel time", () => {
    render(
      <CommunicationLogItem
        log={{
          id: "l1",
          customer_id: "c1",
          user_id: null,
          channel: "phone",
          direction: "incoming",
          content: "שאל על החשבונית",
          category: "general",
          order_id: null,
          project_id: null,
          property_id: null,
          payment_id: null,
          created_by: null,
          created_at: "2026-10-10T08:05:00Z",
          created_by_name: "דנה",
        }}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByText("10/10/26 11:05")).toBeInTheDocument();
    expect(screen.getByText("שאל על החשבונית")).toBeInTheDocument();
  });
});
