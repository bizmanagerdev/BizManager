import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

// Two looks: the default "pill" (rounded box with a filled active pill) and
// "underline" (flat tabs with a primary-colored underline on the active one —
// matches the פניות ומעקב גבייה / collections page tab bar). Pass variant on the
// TabsList; the triggers read it through context so callers set it in one place.
type TabsVariant = "pill" | "underline";
const TabsVariantContext = React.createContext<TabsVariant>("pill");

const LIST_CLASSES: Record<TabsVariant, string> = {
  pill: "inline-flex h-12 w-full items-center justify-start overflow-x-auto rounded-2xl border border-border/60 bg-background/70 p-1 text-muted-foreground shadow-sm",
  // overflow-y-hidden is required: overflow-x-auto alone computes overflow-y to
  // `auto`, and the triggers' -mb-px underline overlap makes a 1px vertical
  // overflow → a stray vertical scrollbar (▲▼ arrows, on the left in RTL).
  underline:
    "inline-flex h-auto w-full items-center justify-start gap-2 overflow-x-auto overflow-y-hidden border-b border-border/60 bg-transparent p-0 text-muted-foreground sm:gap-3",
};

const TRIGGER_CLASSES: Record<TabsVariant, string> = {
  pill: "inline-flex items-center justify-center whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground ring-offset-background transition-all hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/25 data-[state=active]:hover:bg-primary data-[state=active]:hover:text-primary-foreground data-[state=active]:hover:ring-2 data-[state=active]:hover:ring-secondary data-[state=active]:hover:ring-offset-2 data-[state=active]:hover:ring-offset-background",
  underline:
    "-mb-px inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-t-md border-b-[3px] border-transparent bg-transparent px-2 pb-2 pt-1 text-base font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:font-bold data-[state=active]:text-primary",
};

// A small rounded-pill count badge — e.g. "לקוחות [27]" instead of "לקוחות
// (27)". Matches app/(app)/sales/SalesTabsNav.tsx's own count pill (that file
// predates the shared underline variant and re-derives it by hand); this is
// the one place it now lives, so every TabsTrigger count looks the same.
// Colors invert per variant: "pill"'s active state already fills the whole
// button with bg-primary, so its badge uses a translucent primary-foreground
// tint there instead of literally bg-primary (which would just disappear).
const COUNT_BADGE_CLASSES: Record<TabsVariant, string> = {
  pill: "ms-1 inline-flex min-w-4 items-center justify-center rounded-full bg-background/60 px-1 text-[10px] font-semibold leading-4 text-muted-foreground group-data-[state=active]:bg-primary-foreground/20 group-data-[state=active]:text-primary-foreground",
  underline:
    "ms-1 inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold leading-4 text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground",
};

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, dir, variant = "pill", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      dir={dir ?? "rtl"}
      className={cn(LIST_CLASSES[variant], className)}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    /** Shown as a rounded-pill badge after the label instead of "(N)" text.
     *  Omit to show no badge at all — callers wanting a "hide at zero" rule
     *  (e.g. an upcoming-items count) just pass `count={n > 0 ? n : undefined}`. */
    count?: number;
  }
>(({ className, count, children, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      // "group" so the count badge can react to THIS trigger's own
      // data-state=active via group-data-[state=active]: (Radix sets that
      // attribute on the trigger itself, not on any ancestor we control).
      className={cn(TRIGGER_CLASSES[variant], "group", className)}
      {...props}
    >
      {children}
      {count !== undefined ? <span className={COUNT_BADGE_CLASSES[variant]}>{count}</span> : null}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;
