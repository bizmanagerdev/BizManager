"use client";

import { usePathname } from "next/navigation";
import { MorningCustomersSkeleton, MorningSettingsSkeleton } from "./integrations/morning/MorningSkeletons";
import SettingsSkeleton from "./SettingsSkeleton";

// The settings page's loading screen (and the Morning page's) is also what the
// router shows on the way from outside to the pages under it — its boundary
// is the outer one — so it looks at the address: the Morning customers page,
// the Morning settings page, or the settings page with its open tab.

export default function SettingsLoadingBody() {
  const pathname = usePathname() ?? "/settings";
  return (
    <div className="space-y-4" data-route-loading="true">
      {pathname === "/settings/integrations/morning/customers" ? (
        <MorningCustomersSkeleton />
      ) : pathname === "/settings/integrations/morning" ? (
        <MorningSettingsSkeleton />
      ) : (
        <SettingsSkeleton />
      )}
    </div>
  );
}
