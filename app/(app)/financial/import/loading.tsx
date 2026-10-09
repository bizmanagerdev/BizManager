import AppShell from "@/components/layout/AppShell";
import { isOpenAIConfigured } from "@/lib/openai/config";
import ImportSkeleton from "./ImportSkeleton";

// Streamed instantly while the pick-lists load, so TTFB = time-to-shell. The
// upload step's own shape (it used to get the cash-flow page's): the heading
// and links, the upload card.
export default function ImportLoading() {
  return (
    <AppShell>
      <ImportSkeleton smartExtractEnabled={isOpenAIConfigured()} routeLoading />
    </AppShell>
  );
}
