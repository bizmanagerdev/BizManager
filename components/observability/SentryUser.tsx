"use client";

// Attaches the signed-in user to every Sentry event from the browser.
//
// Without this, client errors arrive anonymous: when one person reports "the app
// won't open" there's no way to find THEIR events among everyone else's, so you
// end up debugging blind. Rendered from the (app) layout, which already has the
// profile from requireProfile() — no extra fetch.
//
// Sentry keeps the user on a global scope that survives client-side navigation,
// so this only needs to run when the identity actually changes. It is not
// cleared on unmount: signing in as someone else re-renders the layout and
// overwrites it, and leaving the authenticated area is a full navigation.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

type Props = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string;
};

export default function SentryUser({ id, email, fullName, role }: Props) {
  useEffect(() => {
    Sentry.setUser({
      id,
      email: email ?? undefined,
      username: fullName ?? undefined,
    });
    // Separate tag so you can filter/group by role in the issue stream.
    Sentry.setTag("user.role", role);
  }, [id, email, fullName, role]);

  return null;
}
