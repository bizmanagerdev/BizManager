import { describe, expect, it } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { sessionUser, tokenSubject } from "@/lib/auth/sessionUser";

// The gates take the signed-in person's id from the login token, not from the
// cookie's plain copy of the user, which anyone can edit (audit 2026-10-27).

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
/** A token shaped like Supabase's (the signature is the database's to check, not ours). */
const fakeToken =(claims: Record<string, unknown>) =>
  `${base64url({ alg: "ES256", typ: "JWT", kid: "k1" })}.${base64url(claims)}.c2lnbmF0dXJl`;

const session = (userId: string, token: string) =>
  ({ access_token: token, user: { id: userId, email: "a@b.com" } }) as unknown as Session;

describe("tokenSubject", () => {
  it("reads the token's sub", () => {
    expect(tokenSubject(fakeToken({ sub: "auth-1", role: "authenticated" }))).toBe("auth-1");
  });

  it("reads it past Hebrew in the token (names in the user's metadata) and URL-safe characters", () => {
    const token = fakeToken({ sub: "auth-1", user_metadata: { full_name: "נתן סמוכה ?>?>" } });
    expect(token.split(".")[1]).toMatch(/[-_]/);
    expect(tokenSubject(token)).toBe("auth-1");
  });

  it("nothing for a token that isn't one", () => {
    expect(tokenSubject("")).toBeNull();
    expect(tokenSubject("not-a-token")).toBeNull();
    expect(tokenSubject("a.%%%.c")).toBeNull();
    expect(tokenSubject(`a.${base64url("just text")}.c`)).toBeNull();
    expect(tokenSubject(fakeToken({ role: "authenticated" }))).toBeNull();
    expect(tokenSubject(fakeToken({ sub: 42 }))).toBeNull();
  });
});

describe("sessionUser", () => {
  it("the cookie's user when the token names the same person", () => {
    expect(sessionUser(session("auth-1", fakeToken({ sub: "auth-1" })))?.id).toBe("auth-1");
  });

  it("nobody when the cookie's copy was edited to name someone else", () => {
    expect(sessionUser(session("admin-auth-id", fakeToken({ sub: "office-auth-id" })))).toBeNull();
  });

  it("nobody without a session, a user or a token", () => {
    expect(sessionUser(null)).toBeNull();
    expect(sessionUser({ access_token: fakeToken({ sub: "auth-1" }) } as unknown as Session)).toBeNull();
    expect(sessionUser(session("auth-1", ""))).toBeNull();
  });
});
