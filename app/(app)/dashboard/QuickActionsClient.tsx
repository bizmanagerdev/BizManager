"use client";

import { useEffect, useState } from "react";
import DashboardActions from "@/app/(app)/dashboard/DashboardActions";
import type { UserRole } from "@/lib/auth/requireProfile";
import { EMPTY_QUICK_ACTIONS, type QuickActionsData } from "@/app/(app)/dashboard/quick-actions-types";

/**
 * Renders the quick-action buttons INSTANTLY (with empty data) so they're present
 * and clickable at first paint — the buttons themselves never need the data, only
 * the dialogs do. The dropdown data is streamed in via `dataPromise` (kicked off
 * on the server, not awaited by the page) and fills the dialogs in place: no
 * remount, so a dialog the user already opened just populates a moment later.
 */
export default function QuickActionsClient({
  dataPromise,
  currentUserId,
  currentUserRole,
}: {
  dataPromise: Promise<QuickActionsData>;
  currentUserId?: string;
  currentUserRole?: UserRole;
}) {
  const [data, setData] = useState<QuickActionsData>(EMPTY_QUICK_ACTIONS);

  useEffect(() => {
    let active = true;
    // A promise passed from a Server Component arrives as a React "thenable"
    // whose .then() does NOT return a chainable promise — so wrap it in
    // Promise.resolve() to get a real native promise before chaining. (Using
    // React's use() here would suspend and defeat the instant-buttons goal.)
    Promise.resolve(dataPromise)
      .then((resolved) => {
        if (active && resolved) setData(resolved);
      })
      .catch(() => {
        /* loader never rejects, but stay defensive */
      });
    return () => {
      active = false;
    };
  }, [dataPromise]);

  return (
    <DashboardActions
      customers={data.customers}
      products={data.products}
      projects={data.projects}
      orders={data.orders}
      properties={data.properties}
      users={data.users}
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
      currentOpenSession={data.currentOpenSession}
      salaryAgreements={data.salaryAgreements}
      scheduleEntries={data.scheduleEntries}
    />
  );
}
