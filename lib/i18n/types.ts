// Only the worker role is ever offered a language switch (office/admin stay
// Hebrew always) — see lib/auth/requireProfile.ts UserProfile.locale.
export type Locale = "he" | "ar";

export type Dictionary<Keys extends string> = Record<Locale, Record<Keys, string>>;
