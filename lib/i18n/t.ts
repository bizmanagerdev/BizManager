import type { Dictionary, Locale } from "./types";

// Plain object lookup — works identically in server and client components, no
// provider/context needed. Locale is threaded down as a prop from each worker
// page's `profile.locale` (from requireProfile()).
export function t<Keys extends string>(dict: Dictionary<Keys>, locale: Locale, key: Keys): string {
  return dict[locale][key];
}
