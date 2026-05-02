"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import type { CashFlowSourceKind, ProjectOption } from "@/lib/cashflow";

type Props = {
  actionPath: string;
  from: string;
  to: string;
  customerId: string;
  customerName: string;
  customerPage: string;
  domain: string;
  sourceId: string;
  sourceKind: CashFlowSourceKind | null;
  sourceOptions: ProjectOption[];
  type: string;
  projects: ProjectOption[];
};

function getSourceLabel(sourceKind: CashFlowSourceKind | null) {
  if (sourceKind === "project") return "פרויקט";
  if (sourceKind === "property") return "נכס";
  if (sourceKind === "order") return "הזמנה";
  return "פריט";
}

function getAllSourceLabel(sourceKind: CashFlowSourceKind | null) {
  if (sourceKind === "project") return "כל הפרויקטים";
  if (sourceKind === "property") return "כל הנכסים";
  if (sourceKind === "order") return "כל ההזמנות";
  return "הכול";
}

export default function CashFlowFilters({
  actionPath,
  from,
  to,
  customerId,
  customerName,
  customerPage,
  domain,
  sourceId,
  sourceKind,
  sourceOptions,
  type,
  projects,
}: Props) {
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);
  const [domainValue, setDomainValue] = useState(domain);
  const [sourceIdValue, setSourceIdValue] = useState(sourceId);
  const [typeValue, setTypeValue] = useState(type);

  useEffect(() => {
    setFromValue(from);
  }, [from]);

  useEffect(() => {
    setToValue(to);
  }, [to]);

  useEffect(() => {
    setDomainValue(domain);
  }, [domain]);

  useEffect(() => {
    setSourceIdValue(sourceId);
  }, [sourceId]);

  useEffect(() => {
    setTypeValue(type);
  }, [type]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-right">סינון</CardTitle>
        <CardDescription className="text-right">
          סינון תנועות לפי תאריכים, תחום עסקי, מקור ספציפי וסוג תנועה.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={actionPath} method="get" className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : null}
          {customerName ? <input type="hidden" name="customer_name" value={customerName} /> : null}
          {customerPage ? <input type="hidden" name="customer_page" value={customerPage} /> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-1 lg:flex-wrap">
            <label className="grid gap-1.5 text-sm text-right">
              <span className="font-medium">מתאריך</span>
              <DateInput
                name="from"
                value={fromValue}
                onChange={(event) => setFromValue(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-right">
              <span className="font-medium">עד תאריך</span>
              <DateInput
                name="to"
                value={toValue}
                onChange={(event) => setToValue(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="grid gap-1.5 text-sm text-right lg:min-w-52">
              <span className="font-medium">תחום</span>
              <select
                name="domain"
                value={domainValue}
                onChange={(event) => setDomainValue(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">כל התחומים</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            {sourceKind ? (
              <label className="grid gap-1.5 text-sm text-right lg:min-w-56">
                <span className="font-medium">{getSourceLabel(sourceKind)}</span>
                <select
                  name="sourceId"
                  value={sourceIdValue}
                  onChange={(event) => setSourceIdValue(event.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{getAllSourceLabel(sourceKind)}</option>
                  {sourceOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="grid gap-1.5 text-sm text-right lg:min-w-44">
              <span className="font-medium">סוג תנועה</span>
              <select
                name="type"
                value={typeValue}
                onChange={(event) => setTypeValue(event.target.value)}
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
              <Link
                onClick={() => {
                  setFromValue("");
                  setToValue("");
                  setDomainValue("");
                  setSourceIdValue("");
                  setTypeValue("all");
                }}
                href={
                  customerId
                    ? `${actionPath}?customer_id=${encodeURIComponent(customerId)}${
                        customerName ? `&customer_name=${encodeURIComponent(customerName)}` : ""
                      }${customerPage ? `&customer_page=${encodeURIComponent(customerPage)}` : ""}`
                    : actionPath
                }
              >
                איפוס
              </Link>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
