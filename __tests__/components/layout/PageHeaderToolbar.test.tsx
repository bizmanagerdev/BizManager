// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { PageHeaderToolbar, PAGE_HEADER_TOOLBAR_ID } from "@/components/layout/PageHeaderToolbar";

describe("PageHeaderToolbar", () => {
  it("puts the marker in the server HTML, so the slot can hold its space before the portal fills it", () => {
    const html = renderToString(
      <PageHeaderToolbar>
        <input placeholder="חיפוש" />
      </PageHeaderToolbar>
    );
    expect(html).toContain("data-page-header-toolbar");
    // The controls themselves can't be portaled on the server.
    expect(html).not.toContain("חיפוש");
  });

  it("on the client, portals the controls into the shell's slot and keeps the marker", () => {
    const slot = document.createElement("div");
    slot.id = PAGE_HEADER_TOOLBAR_ID;
    document.body.appendChild(slot);

    const { container } = render(
      <PageHeaderToolbar>
        <input placeholder="חיפוש" />
      </PageHeaderToolbar>
    );

    expect(slot).toContainElement(screen.getByPlaceholderText("חיפוש"));
    expect(container.querySelector("[data-page-header-toolbar]")).not.toBeNull();
    slot.remove();
  });
});
