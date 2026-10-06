"use client";

import { useEffect, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import UpcomingPayments from "@/components/dashboard/UpcomingPayments";
import CollectionsCard from "@/components/dashboard/CollectionsCard";
import DomainChartCard from "@/components/dashboard/DomainChartCard";
import { Skeleton } from "@/components/ui/skeleton";
import { readRememberedCardRaw, rememberCard, type RememberedEntry } from "@/lib/ui/remembered-cards";
import { cn } from "@/lib/utils";

// The money cards' "last version seen" (lib/ui/remembered-cards.ts):
// <RememberCard> sits next to a card the server just sent and keeps its props;
// <RememberedCardFallback> is that card's loading placeholder — the kept
// version, greyed and inert (not clickable: its buttons would act on old
// figures) until the fresh card replaces it.

type RememberedProps = {
  payments: ComponentProps<typeof UpcomingPayments>;
  collections: ComponentProps<typeof CollectionsCard>;
  domainChart: ComponentProps<typeof DomainChartCard>;
};

export type RememberedKind = keyof RememberedProps;

/** Keeps the card's props for next time (null = the card had nothing: forget it). */
export function RememberCard<K extends RememberedKind>({
  rememberKey,
  kind,
  props,
}: {
  rememberKey: string;
  kind: K;
  props: RememberedProps[K] | null;
}) {
  useEffect(() => {
    rememberCard(rememberKey, kind, props);
  }, [rememberKey, kind, props]);
  return null;
}

const noSubscribe = () => () => {};

export function RememberedCardFallback({
  rememberKey,
  kind,
  className,
}: {
  rememberKey: string;
  kind: RememberedKind;
  /** The placeholder's sizing, matching the board's cells. */
  className?: string;
}) {
  // Server render (and hydration): the plain placeholder; the device's copy
  // shows right after.
  const raw = useSyncExternalStore(noSubscribe, () => readRememberedCardRaw(rememberKey, kind), () => null);
  const entry = useMemo(() => (raw ? (JSON.parse(raw) as RememberedEntry<unknown>) : null), [raw]);

  if (!entry) return <Skeleton className={cn("h-16 w-full rounded-[1.125rem] xl:h-full", className)} />;

  return (
    <div inert aria-busy="true" className="contents [&>*]:opacity-60">
      {kind === "payments" ? (
        <UpcomingPayments {...(entry.props as RememberedProps["payments"])} />
      ) : kind === "collections" ? (
        <CollectionsCard {...(entry.props as RememberedProps["collections"])} />
      ) : (
        <DomainChartCard {...(entry.props as RememberedProps["domainChart"])} />
      )}
    </div>
  );
}
