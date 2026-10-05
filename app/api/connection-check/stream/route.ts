import { requireProfile } from "@/lib/auth/requireProfile";

// TEMPORARY (2026-10-05) — for /connection-check. Sends one short line a second
// for a few seconds over a single response, the way a sync engine keeps a
// connection open. The page times when each line arrives: spread out means the
// network (and the phone's filter) passes a live stream through; all at once
// at the end means something on the way holds it back. ?lines=0 answers at
// once — a plain request to our own site, for comparison.

export const dynamic = "force-dynamic";

const MAX_LINES = 10;
const LINE_INTERVAL_MS = 1000;

export async function GET(request: Request) {
  await requireProfile();
  const requested = Number(new URL(request.url).searchParams.get("lines") ?? "8");
  const lines = Number.isFinite(requested) ? Math.max(0, Math.min(MAX_LINES, Math.floor(requested))) : 8;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`start ${Date.now()}\n`));
      for (let i = 1; i <= lines; i++) {
        await new Promise((resolve) => setTimeout(resolve, LINE_INTERVAL_MS));
        controller.enqueue(encoder.encode(`line ${i} ${Date.now()}\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Ask every proxy on the way not to hold the response back or rewrite it.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
