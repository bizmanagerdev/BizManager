// Copies PowerSync's web worker files (the on-device SQLite engine, its .wasm
// files and the sync worker) into public/powersync/<version>/, where the app
// loads them from (lib/powersync/config.ts, POWERSYNC_ASSETS_BASE).
//
// Why copy at all: the SDK starts its workers with
// `new SharedWorker(new URL(...))`, which Next 16.1's Turbopack copies raw
// instead of bundling (bare `import 'comlink'` — can't load in a browser).
// PowerSync's own guide prescribes copying its prebuilt `dist/worker` folder.
//
// Why a folder per version: the service worker serves static files cache-first
// and a SharedWorker is keyed by its URL — under a fixed path, a device would
// keep running an old worker against new app code after an upgrade. A new
// version gets a new URL; older folders are removed.
//
// Runs on postinstall (so Vercel has the files before `next build`), and again
// before dev/build in case public/ was cleaned. Source maps are skipped.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sdkDir = path.join(root, "node_modules", "@powersync", "web");
if (!existsSync(sdkDir)) {
  console.log("[powersync assets] @powersync/web not installed — skipped");
  process.exit(0);
}

const { version } = JSON.parse(readFileSync(path.join(sdkDir, "package.json"), "utf8"));
const source = path.join(sdkDir, "dist", "worker");
const outRoot = path.join(root, "public", "powersync");
const target = path.join(outRoot, version);

mkdirSync(outRoot, { recursive: true });
for (const entry of readdirSync(outRoot)) {
  if (entry !== version) rmSync(path.join(outRoot, entry), { recursive: true, force: true });
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (file) => !file.endsWith(".map") });
console.log(`[powersync assets] ${version} → public/powersync/${version}`);
