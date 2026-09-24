import { describe, it, expect, vi } from "vitest";
import { createThumbnailCache } from "@/lib/documents/pdfThumbnail";

/** Lets every pending microtask run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A renderer whose completion the test controls. */
function deferred() {
  const calls: Array<{ key: string; resolve: (value: string) => void }> = [];
  const render = vi.fn(
    (url: string) =>
      new Promise<string>((resolve) => {
        calls.push({ key: url, resolve });
      })
  );
  return { render, calls };
}

describe("createThumbnailCache", () => {
  it("renders a document once and serves the rest from memory", async () => {
    const { render, calls } = deferred();
    const cache = createThumbnailCache(render, 2);

    const first = cache.request("doc-1", "url-a", 176);
    const second = cache.request("doc-1", "url-a", 176);
    // The gate is awaited even when a slot is free, so the render starts one
    // microtask after the request.
    await tick();
    expect(render).toHaveBeenCalledTimes(1);

    calls[0]!.resolve("data:1");
    expect(await first).toBe("data:1");
    expect(await second).toBe("data:1");

    // Scrolling back to it must not fetch and decode the file again.
    expect(await cache.request("doc-1", "url-a", 176)).toBe("data:1");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("keys on the document, not the url", async () => {
    // A signed url is re-minted every page load. Keying on it would mean the
    // cache never hits and every scroll re-downloads the file.
    const { render, calls } = deferred();
    const cache = createThumbnailCache(render, 2);
    const first = cache.request("doc-1", "signed-url-monday", 176);
    await tick();
    calls[0]!.resolve("data:1");
    await first;
    expect(await cache.request("doc-1", "signed-url-tuesday", 176)).toBe("data:1");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("never runs more renders at once than it was allowed", async () => {
    // Without the gate, a screen of PDFs downloads and decodes every file
    // simultaneously the moment the page loads.
    const { render, calls } = deferred();
    const cache = createThumbnailCache(render, 2);

    void cache.request("a", "url-a", 176);
    void cache.request("b", "url-b", 176);
    void cache.request("c", "url-c", 176);
    await tick();
    expect(render).toHaveBeenCalledTimes(2);

    calls[0]!.resolve("data:a");
    await tick();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it("frees its slot when a render fails, and lets a later attempt through", async () => {
    const render = vi
      .fn<(url: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("bad pdf"))
      .mockResolvedValueOnce("data:ok");
    const cache = createThumbnailCache(render, 1);

    await expect(cache.request("a", "url-a", 176)).rejects.toThrow("bad pdf");
    expect(cache.inFlightCount()).toBe(0);
    // A failure is not cached: the next attempt is allowed to try again.
    expect(await cache.request("a", "url-a", 176)).toBe("data:ok");
  });
});
