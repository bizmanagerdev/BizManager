// Generate every RASTER app icon from the two brand SVGs. Run after changing
// either of them:
//   node scripts/gen-app-icons.mjs
// Then bump the ?v= query in app/layout.tsx + app/head.tsx so browsers refetch —
// a favicon is one of the most aggressively cached things on the web.
//
// TWO sources, because the tab and the home screen want different artwork:
//   app/icon.svg               transparent sky mark  -> favicon.ico  (tab strip)
//   public/brand/heller-tile.svg  sky on a navy tile -> the PNGs     (installed app)
// iOS composites a transparent apple-touch PNG onto BLACK and Android's maskable
// crop needs bleed, so the installed icons must be the opaque tile.
//
// The Android launcher icons come from icon-512.png via gen-android-icons.mjs —
// run that after this one.
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

const TAB_SRC = path.resolve("app/icon.svg");
const TILE_SRC = path.resolve("public/brand/heller-tile.svg");
const OUT = path.resolve("public");

const PNGS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "apple-touch-icon.png", size: 180 },
];

// ICO sizes. 48 is what Windows shows in shortcuts/taskbar, 32 the tab strip on a
// HiDPI screen, 16 on a 1x one.
const ICO = [16, 32, 48];

/**
 * Pack PNGs into an .ico. Every browser since IE Vista reads PNG-in-ICO, which
 * saves hand-rolling a BMP encoder (and lets the entries keep their alpha).
 * Layout: 6-byte ICONDIR, then one 16-byte ICONDIRENTRY per image, then the data.
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size — 0 for true colour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

// sharp rasterises SVG at 72dpi by default, which blurs the small sizes — render
// each one from the vector at its own scale instead of downsampling one bitmap.
const render = (src, size, viewBoxWidth) =>
  sharp(src, { density: Math.max(72, Math.ceil((size / viewBoxWidth) * 72 * 4)) })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

async function main() {
  const tab = await fs.readFile(TAB_SRC);
  const tile = await fs.readFile(TILE_SRC);

  for (const { file, size } of PNGS) {
    await fs.writeFile(path.join(OUT, file), await render(tile, size, 256));
    console.log(`wrote public/${file} (${size}px, tile)`);
  }

  const ico = buildIco(
    await Promise.all(ICO.map(async (size) => ({ size, data: await render(tab, size, 100) })))
  );
  await fs.writeFile(path.join(OUT, "favicon.ico"), ico);
  console.log(`wrote public/favicon.ico (${ICO.join("/")}px, transparent)`);
}

await main();
