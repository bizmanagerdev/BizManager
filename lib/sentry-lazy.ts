// Sentry for code that also renders on the server — client components and libs
// shared with them: load the SDK on first use instead of with a top-level import.
//
// A top-level `import * as Sentry from "@sentry/nextjs"` in anything the SSR
// layer renders pulls the whole server SDK (~1 MB of Sentry + OpenTelemetry)
// into that route's server bundle, and Node evaluates it on every cold start —
// even though these call sites only fire in the browser, or on a rare failure.
// Measured on /dashboard (2026-10-04): that copy was ~40 ms of evaluation plus
// ~20 ms of compile per cold start, on top of the copy instrumentation.ts loads.
//
// Nothing about reporting changes:
// - In the browser, instrumentation-client.ts hands over the SDK it already
//   loaded (provideSentry) before hydration, so a report never depends on
//   loading a chunk. Turbopack does currently resolve import() to that same
//   already-loaded copy without a fetch, but that's a bundler optimization,
//   not a guarantee — and stale-build errors, the ones these reports exist to
//   catch, are exactly where a chunk load fails (see lib/ui/auto-recover.ts).
// - On the server, import() shares the client and the per-request scopes
//   through Sentry's global carrier, exactly as the eagerly imported copy did,
//   and the callback runs in the caller's async context, so request isolation
//   is kept (verified: an anonymous request's error carries no user).
//
// Fire-and-forget: a report never blocks, delays, or throws into the code that
// makes it. Calls run in the order they were made (they chain on one promise).
// Server-only modules that already load Sentry for other reasons (e.g.
// requireProfile) keep importing it directly — this is for the SSR layer.
type SentryModule = typeof import("@sentry/nextjs");

let sentry: Promise<SentryModule> | undefined;

export function provideSentry(sdk: SentryModule): void {
  sentry = Promise.resolve(sdk);
}

export function withSentry(report: (Sentry: SentryModule) => void): void {
  sentry ??= import("@sentry/nextjs");
  sentry.then(report).catch(() => {});
}
