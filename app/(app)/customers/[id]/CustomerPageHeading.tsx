import type { ReactNode } from "react";
import { TopBarHeading } from "@/components/layout/TopBarHeading";

// The desktop head of a customer page — where you are (לקוחות › name) and the
// handful of things you can do to the customer — in the top bar (owner,
// 2026-10-22; TopBarHeading), as the order page's (OrderPageHeading.tsx). Its
// own component so the page and its loading screen (CustomerPageSkeleton) put
// the same thing there. On the phone the name is in the bar's title and the
// actions in its ⋮ — registered from the actions rendered here.

export default function CustomerPageHeading({ name, actions }: { name: ReactNode; actions?: ReactNode }) {
  return <TopBarHeading section="לקוחות" href="/customers" title={<span className="min-w-0 truncate">{name}</span>} actions={actions} />;
}
