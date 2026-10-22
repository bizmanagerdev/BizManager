import { TOP_BAR_ACTIONS_ID, TOP_BAR_HEADING_ID } from "@/components/layout/TopBarHeading";

// The top bar's two slots a detail page's heading and its buttons go into
// (components/layout/TopBarHeading.tsx) — for a test that draws the page
// without the app's TopBar. Returns the cleanup.
export function mountTopBarSlots(): () => void {
  const hosts = [TOP_BAR_HEADING_ID, TOP_BAR_ACTIONS_ID].map((id) => {
    const el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
    return el;
  });
  return () => hosts.forEach((el) => el.remove());
}
