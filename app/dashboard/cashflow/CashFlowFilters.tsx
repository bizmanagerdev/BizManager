import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ProjectOption } from "@/lib/cashflow";

type Props = {
  actionPath: string;
  from: string;
  to: string;
  customerId: string;
  projectId: string;
  type: string;
  projects: ProjectOption[];
};

export default function CashFlowFilters({
  actionPath,
  from,
  to,
  customerId,
  projectId,
  type,
  projects,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">סינון</CardTitle>
        <CardDescription className="text-right">
          סינון תנועות לפי תאריכים, פרויקט וסוג תנועה.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={actionPath} method="get" className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-1">
            <label className="grid gap-1.5 text-sm text-right">
              <span className="font-medium">מתאריך</span>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-right">
              <span className="font-medium">עד תאריך</span>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-right lg:min-w-52">
              <span className="font-medium">פרויקט</span>
              <select
                name="projectId"
                defaultValue={projectId}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">כל הפרויקטים</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm text-right lg:min-w-44">
              <span className="font-medium">סוג תנועה</span>
              <select
                name="type"
                defaultValue={type}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="all">הכול</option>
                <option value="inflow">הכנסות בלבד</option>
                <option value="outflow">הוצאות בלבד</option>
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 lg:flex-none">
              החל סינון
            </Button>
            <Button asChild type="button" variant="outline" className="flex-1 lg:flex-none">
              <Link href={customerId ? `${actionPath}?customer_id=${encodeURIComponent(customerId)}` : actionPath}>
                איפוס
              </Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
