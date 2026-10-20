// "Is the server answering?" — asked by a saved page the app showed while the
// connection hung (components/layout/SavedCopyNotice) before it reloads
// itself, and by the offline page (public/sw.js). Nothing read, nothing
// written; never cached (the service worker leaves it to the network).
//
// It also says which build the server runs now (X-Bizh-Build): an app left
// open on an older one moves onto it the next time it's left (owner,
// 2026-10-20 — see lib/pwa/app-version.ts).
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store", "X-Bizh-Build": process.env.NEXT_PUBLIC_BUILD_ID ?? "" },
  });
}
