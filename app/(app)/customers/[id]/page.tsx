import { notFound } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { requireStaffPage } from "@/lib/auth/roleAccess";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { israelDateKey } from "@/lib/timezone";
import { startCustomerPageReads } from "@/app/(app)/customers/[id]/loadCustomerPage";
import CustomerPageView from "@/app/(app)/customers/[id]/CustomerPageView";

// A customer's page. Its reads go out at once — alongside the "who's asking"
// check, and each as soon as what it needs is in (loadCustomerPage.ts). They
// run under the caller's own RLS whatever their role, and a caller who isn't
// staff is still redirected below before anything is rendered.
//
// The page shows as soon as the customer and its money are read; the payments,
// the documents and the history follow into their folded sections as they
// arrive (CustomerPageView, through Suspense).

export default async function CustomerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const profilePromise = requireStaffPage();
  const reads = startCustomerPageReads(supabase, id, {
    role: profilePromise.then(
      ({ profile }) => profile.role ?? "",
      () => ""
    ),
    viewerId: profilePromise.then(
      ({ profile }) => profile.id,
      () => ""
    ),
  });
  // Awaited after the check; until then a redirect from it mustn't leave the
  // reads as unhandled rejections.
  reads.top.catch(() => {});

  const { profile } = await profilePromise;
  const top = await reads.top;
  if (!top) notFound();

  return (
    <AppShell userName={profile.full_name ?? profile.email ?? undefined} viewerRole={profile.role}>
      <CustomerPageView
        top={top}
        payments={reads.payments}
        documents={reads.documents}
        history={profile.role === "admin" ? reads.history : null}
        viewer={{ id: profile.id, role: profile.role ?? "" }}
        today={israelDateKey()}
      />
    </AppShell>
  );
}
