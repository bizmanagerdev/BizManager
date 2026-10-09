"use client";

import { usePathname } from "next/navigation";
import AttendanceSkeleton, { AttendanceStripSkeleton } from "@/app/(app)/payroll/attendance/AttendanceSkeleton";
import WorkerPageSkeleton from "@/app/(app)/payroll/workers/[id]/WorkerPageSkeleton";
import PayrollSkeleton from "./PayrollSkeleton";

// The payroll page's loading screen is also what the router shows on the way
// from outside /payroll to the pages under it (its boundary is the outer one),
// so it looks at the address: the attendance queue — its strip and band and
// report cards; a worker's page — that page's frame; the salary center itself
// — its toolbar, summary, tabs and employees. The strip only on the queue:
// the other two leave it closed.

const WORKER_PAGE = /^\/payroll\/workers\/[^/]+$/;

export default function PayrollLoadingBody() {
  const pathname = usePathname() ?? "/payroll";
  if (pathname === "/payroll/attendance") {
    return (
      <>
        <AttendanceStripSkeleton />
        <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
          <AttendanceSkeleton />
        </div>
      </>
    );
  }
  return (
    <div className="space-y-4 text-right" dir="rtl" data-route-loading="true">
      {WORKER_PAGE.test(pathname) ? <WorkerPageSkeleton /> : <PayrollSkeleton />}
    </div>
  );
}
