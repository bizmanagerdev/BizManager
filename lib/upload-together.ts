// Upload several files for one record at the same time instead of one after
// another. Each upload is its own round trip (~1 s of server time plus the
// phone's upload), and they don't depend on each other — one at a time, three
// receipt photos kept a worker waiting ~3 s+ before the dialog could close.
//
// At most `limit` run at once, so a phone on a weak connection isn't asked to
// push every file simultaneously. Results come back in the files' order.
// Every file is attempted; if any upload threw, the first error is rethrown
// once all have settled — the same error the old loop surfaced, except the
// other files still went up instead of being skipped.
//
// Safe offline: offlineUpload() queues each file as its own IndexedDB record
// (random id), so parallel enqueues can't overwrite each other.
//
// Usually a list of Files; any item works (e.g. { paymentId, file } pairs when
// the files belong to several records saved at once).
export async function uploadTogether<I, T>(
  files: readonly I[],
  upload: (file: I) => Promise<T>,
  limit = 3
): Promise<T[]> {
  const results: PromiseSettledResult<T>[] = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await upload(files[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}
