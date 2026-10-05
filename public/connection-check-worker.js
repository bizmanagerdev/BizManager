// TEMPORARY (2026-10-05) — for /connection-check: a background worker that
// answers back, the building block a database on the device runs in.
self.onmessage = (event) => {
  self.postMessage({ echo: event.data });
};
