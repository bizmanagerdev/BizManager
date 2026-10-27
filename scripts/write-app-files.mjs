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
// Runs inside `next build`, right after it compiles (next.config.ts,
// compiler.runAfterProductionCompile). It used to run after it (package.json
// "postbuild"), but since Next 16.4 Vercel takes the build's files when
// `next build` ends, so that list never reached the site (404 on 925e521b).
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

/** Writes the list to `<distDir>/static/bizh-app-files/<build>.json`. */
export function writeAppFiles(distDir, env = process.env) {
  const staticDir = path.join(distDir, "static");
  if (!existsSync(staticDir)) {
    console.log("[app files] no .next/static — skipped");
    return;
  }
  const build = buildId(env);
  const files = appFiles(staticDir);
  const outDir = path.join(staticDir, "bizh-app-files");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${build}.json`), JSON.stringify({ build, files }));
  console.log(`[app files] ${files.length} files listed for build ${build}`);
}
