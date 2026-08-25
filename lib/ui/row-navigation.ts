// Skip row-level navigation when the click/keydown originated on an interactive
// element inside the row (so per-row buttons/links still work as expected).
export function shouldIgnoreRowNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // [role="button"] only, not [role="link"] — the clickable ROW ITSELF commonly
  // carries role="link" (see e.g. SalesOrdersClient.tsx), and target.closest()
  // matches an element against itself too, so including "link" here would make
  // every click inside such a row match its own wrapper and cancel ALL navigation.
  if (target.closest('a, button, input, textarea, select, label, [role="button"]')) return true;
  // A dialog/menu/popover opened from inside a row is portaled elsewhere in the
  // DOM, but React still bubbles its events up through the component tree to the
  // row handler. Clicking any non-interactive area inside such an overlay (e.g.
  // the delivery-date section in the order-confirm dialog) must NOT navigate the
  // row — otherwise the dialog disappears mid-edit. Bail on any portaled surface.
  return Boolean(
    target.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menuitem"], [role="listbox"], [data-radix-popper-content-wrapper]'
    )
  );
}
