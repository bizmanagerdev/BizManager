// "Is the server answering?" — asked by a saved page the app showed while the
// connection hung (components/layout/SavedCopyNotice) before it reloads
// itself, and by the offline page (public/sw.js). Nothing read, nothing
// written; never cached (the service worker leaves it to the network).
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
