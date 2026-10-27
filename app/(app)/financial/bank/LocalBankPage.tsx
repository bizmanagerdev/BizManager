"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useLocalCard } from "@/components/powersync/useLocalCard";
import { useDevicePageTiming } from "@/components/powersync/useDevicePageTiming";
import type { LocalCardViewer } from "@/lib/powersync/dashboard-local";
import BankSkeleton from "./BankSkeleton";

// The same placeholder as loading.tsx while the client's code loads.
const BankClient = dynamic(() => import("./BankClient"), {
  loading: () => <BankSkeleton />,
});

// The accounts page drawn from the on-device copy (LOCAL_DATA_PAGES.bank):
// every account's balance and register, the loans and the quick line's lists,
// worked out with the server's own loader (loadBankPage) on the device — again
// by itself whenever a payment, expense, transfer or tick changes. The quick
// line, the ticks and the deletes are saved on the copy first and go to the
// server from there (lib/financial/device-bank-saves.ts); the edit windows
// still save on the server and come back through the copy. If the device's
// copy can't serve the page, it reloads as the server version (?data=server).

export default function LocalBankPage({ viewer }: { viewer: LocalCardViewer }) {
  const searchParams = useSearchParams();
  const serverHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("data", "server");
    return `/financial/bank?${params.toString()}`;
  }, [searchParams]);

  const page = useLocalCard({ kind: "bankPage", viewer, page: "bank", serverHref });
  useDevicePageTiming("bank", page, page?.data.accounts.length);

  if (!page) return <BankSkeleton />;
  const data = page.data;
  return (
    <BankClient
      accounts={data.accounts}
      loans={data.loans}
      initialAccountId={searchParams.get("account") ?? ""}
      projects={data.projects}
      recurringProperties={data.recurringProperties}
      merchantMemory={data.merchantMemory}
      dataIncomplete={data.dataIncomplete}
      fxRates={data.fxRates}
      deviceSaves
    />
  );
}
