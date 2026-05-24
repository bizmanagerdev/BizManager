"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type DivProps = ComponentPropsWithoutRef<"div">;

const gridVariants = {
  dashboardMetrics: "grid grid-cols-2 gap-3 xl:grid-cols-4",
  dashboardMain: "grid gap-4 xl:grid-cols-[1.15fr_0.85fr]",
  quickActions: "grid gap-2 grid-cols-2 sm:grid-cols-5 sm:gap-1.5 lg:grid-cols-10",
  customersToolbar: "grid gap-3 lg:grid-cols-8",
  customersFilters: "grid gap-3 lg:grid-cols-4",
  customerCard: "grid gap-2 p-2.5 md:grid-cols-[1fr_auto] md:items-center",
  customerStats: "grid gap-4 md:grid-cols-2 xl:grid-cols-4",
  customerPanels: "grid gap-4 lg:grid-cols-2",
  projectsToolbarControls: "grid grid-cols-1 gap-3 sm:grid-cols-3 lg:w-auto",
  projectCardMeta: "grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3",
  formTwo: "grid gap-3 sm:grid-cols-2",
  formTwoLoose: "grid gap-4 sm:grid-cols-2",
  projectOverview: "grid gap-3 md:grid-cols-2 xl:grid-cols-3",
  projectSummary: "grid gap-2 text-sm sm:grid-cols-2",
  projectFormError: "text-xs text-destructive sm:col-span-2",
} as const;

const stackVariants = {
  page: "space-y-4",
  toolbar: "flex flex-col gap-3 lg:flex-row lg:items-end",
  sectionHeader: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
  controlRow: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
  calendarToolbar: "flex flex-col gap-2 sm:flex-row sm:items-center",
} as const;

const widthVariants = {
  fluid: "w-full",
  autoFromSmall: "w-full sm:w-auto",
} as const;

const dialogVariants = {
  newOrder: "max-h-[92svh] w-[calc(100vw-1rem)] max-w-5xl overflow-y-auto p-4 sm:p-6",
  formSm: "max-h-[90vh] overflow-y-auto sm:max-w-sm",
  formMd: "max-h-[90vh] overflow-y-auto sm:max-w-md",
  formLg: "max-h-[90vh] overflow-y-auto sm:max-w-lg",
  formXl: "max-h-[90svh] overflow-y-auto sm:max-w-xl",
  form2xl: "max-h-[90vh] overflow-y-auto sm:max-w-2xl",
  details4xl: "max-h-[90vh] overflow-y-auto sm:max-w-4xl",
} as const;

const cellVariants = {
  customersPrimary: "space-y-1 lg:col-span-4",
  customersSecondary: "lg:col-span-2",
  projectOverviewWide: "md:col-span-2 xl:col-span-3",
  full: "col-span-full",
} as const;

export function PageStack({ className, ...props }: DivProps) {
  return <div className={cn(stackVariants.page, className)} {...props} />;
}

export function AdaptiveStack({
  variant,
  className,
  ...props
}: DivProps & { variant: keyof typeof stackVariants }) {
  return <div className={cn(stackVariants[variant], className)} {...props} />;
}

export function AdaptiveGrid({
  variant,
  className,
  ...props
}: DivProps & { variant: keyof typeof gridVariants }) {
  return <div className={cn(gridVariants[variant], className)} {...props} />;
}

export function AdaptiveWidth({
  variant,
  className,
  children,
  ...props
}: DivProps & { variant: keyof typeof widthVariants; children: ReactNode }) {
  return (
    <div className={cn(widthVariants[variant], className)} {...props}>
      {children}
    </div>
  );
}

export function AdaptiveDialog({
  size,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogContent> & {
  size: keyof typeof dialogVariants;
}) {
  return <DialogContent className={cn(dialogVariants[size], className)} {...props} />;
}

export function AdaptiveCell({
  variant,
  className,
  ...props
}: DivProps & { variant: keyof typeof cellVariants }) {
  return <div className={cn(cellVariants[variant], className)} {...props} />;
}

export function ResponsiveTabsRail({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        "grid w-full grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm sm:inline-flex sm:h-11 sm:w-auto sm:items-center",
        className
      )}
      {...props}
    />
  );
}

export function ResponsiveMetricValue({ className, ...props }: DivProps) {
  return <div className={cn("mt-2 text-xl font-semibold md:text-2xl", className)} {...props} />;
}
