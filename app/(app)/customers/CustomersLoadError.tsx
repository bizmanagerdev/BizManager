"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeaderToolbarSpace } from "@/components/layout/PageHeaderToolbar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import CustomersTitle from "@/app/(app)/customers/CustomersTitle";

/**
 * The list couldn't be read. The phone strip the loading screen held open
 * stays open (an error used to fold it away and pull the page up under the
 * bar), the message is the app's Hebrew one, and "נסו שוב" reads it again.
 */
export default function CustomersLoadError({ message }: { message: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <CustomersTitle />
      <PageHeaderToolbarSpace />
      <EmptyState
        action={
          <Button
            type="button"
            variant="muted"
            size="sm"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            {pending ? "טוען…" : "נסו שוב"}
          </Button>
        }
      >
        שגיאה בטעינת לקוחות: {message}
      </EmptyState>
    </>
  );
}
