import type { Session, User } from "@supabase/supabase-js";

/**
 * The signed-in person, as the login token names them — or null.
 *
 * getSession() reads the session the browser keeps in its cookie: the login
 * token, which Supabase signs and nobody can edit, next to a plain copy of the
 * user, which anyone can edit in their own browser. The gates used to take the
 * id from that copy, so a copy edited to name someone else made the server
 * load that person's profile (audit 2026-10-27: an office user, who can read
 * every profile, could pose as an admin). Now the id is the token's, and a
 * copy naming anyone else is refused.
 *
 * The token's signature isn't checked here: that would be getClaims() or
 * getUser(), and the owner keeps the gates off both (2026-10-29; getUser's
 * call to the login server on every request broke every page in September).
 * It doesn't need to be: each gate's next step reads the profile with this
 * same token, the database checks its signature, and a forged one is refused
 * there.
 */
export function sessionUser(session: Session | null): User | null {
  const user = session?.user;
  if (!user || !session.access_token) return null;
  return tokenSubject(session.access_token) === user.id ? user : null;
}

/** The token's `sub` (the auth user's id), read without checking the signature. */
export function tokenSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const sub = claims && typeof claims === "object" ? (claims as { sub?: unknown }).sub : undefined;
    return typeof sub === "string" && sub !== "" ? sub : null;
  } catch {
    return null;
  }
}
