import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appFiles, buildId } from "../../scripts/write-app-files.mjs";

// After each build, the list of every file of its code, for the service
// worker to download once per version (owner, 2026-10-27: "let's just do the
// whole app at once"). Source maps and PowerSync's engine copies are left out.

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function staticDir(files: string[]) {
  dir = mkdtempSync(path.join(tmpdir(), "app-files-"));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), "x");
  }
  return dir;
}

describe("the build's list of code files", () => {
  it("every code file, as the address it's served at — no source maps, engine copies or the lists themselves", () => {
    const root = staticDir([
      "chunks/a1.js",
      "chunks/a1.js.map",
      "chunks/app/layout.js",
      "css/c1.css",
      "media/font.woff2",
      "media/engine.wasm",
      "media/worker.mjs",
      "abc123/_buildManifest.js",
      "bizh-app-files/old.json",
    ]);
    expect(appFiles(root)).toEqual([
      "/_next/static/abc123/_buildManifest.js",
      "/_next/static/chunks/a1.js",
      "/_next/static/chunks/app/layout.js",
      "/_next/static/css/c1.css",
      "/_next/static/media/font.woff2",
    ]);
  });

  it("named by the build — the same id the app and its service worker carry (next.config.ts)", () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(buildId(env({ VERCEL_GIT_COMMIT_SHA: "80d44d44875156591763" }))).toBe("80d44d44");
    expect(buildId(env({ BUILD_ID: "local" }))).toBe("local");
    expect(buildId(env({}))).toBe("v13");
  });
});
