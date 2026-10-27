// Lists every file of this build's code (.next/static) for the service worker,
// which downloads them all once per version — so every screen, form and
// dialog works with no connection, as an installed app's do (owner,
// 2026-10-27: "let's just do the whole app at once"). Written to
// .next/static/bizh-app-files/<build>.json, served with the build at
// /_next/static/bizh-app-files/<build>.json (public/sw.js, SAVE_APP_CODE).
//
// Left out: source maps, and PowerSync's engine files (.wasm/.mjs) that the
// bundler copies here — the app loads those from public/powersync/<version>/.
//
// Runs after `next build` (package.json "postbuild").
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The build id — the same as next.config.ts's BUILD_ID. */
export function buildId(env = process.env) {
  return env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? env.BUILD_ID ?? "v13";
}

const LEFT_OUT = /\.(?:map|wasm|mjs)$/;

/** Every code file under `staticDir`, as the address it's served at. */
export function appFiles(staticDir) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "bizh-app-files") continue;
      const full = path.join(dir, entry.name);
      const address = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(full, address);
      else if (!LEFT_OUT.test(entry.name)) files.push(address);
    }
  };
  walk(staticDir, "/_next/static");
  return files.sort();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (isMain) {
  const staticDir = path.join(process.cwd(), ".next", "static");
  if (!existsSync(staticDir)) {
    console.log("[app files] no .next/static — skipped");
    process.exit(0);
  }
  const build = buildId();
  const files = appFiles(staticDir);
  const outDir = path.join(staticDir, "bizh-app-files");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${build}.json`), JSON.stringify({ build, files }));
  console.log(`[app files] ${files.length} files listed for build ${build}`);
}
