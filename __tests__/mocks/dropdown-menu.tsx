// components/ui/dropdown-menu inline, opened by a click (Radix's portal and
// pointer events don't run in jsdom):
//   vi.mock("@/components/ui/dropdown-menu", () => import("@/__tests__/mocks/dropdown-menu"));
import * as React from "react";

type Children = { children?: React.ReactNode };

const Menu = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

export function DropdownMenu({ children }: Children) {
  const [open, setOpen] = React.useState(false);
  return <Menu.Provider value={{ open, setOpen }}>{children}</Menu.Provider>;
}

export function DropdownMenuTrigger({ children }: Children & { asChild?: boolean }) {
  const { open, setOpen } = React.useContext(Menu);
  return React.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: () => setOpen(!open) });
}

export function DropdownMenuContent({ children }: Children & { align?: string; className?: string }) {
  return React.useContext(Menu).open ? <div role="menu">{children}</div> : null;
}

export function DropdownMenuItem({ children, onSelect }: Children & { onSelect?: () => void; className?: string }) {
  const { setOpen } = React.useContext(Menu);
  return (
    <div
      role="menuitem"
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuSeparator() {
  return <hr />;
}
