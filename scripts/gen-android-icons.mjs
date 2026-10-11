// Generate Android launcher icons for the Capacitor shell from public/icon-512.png.
// Produces the legacy square and round PNGs (phones before Android 8) at every density.
// Android 8+ uses the adaptive icon instead: res/mipmap-anydpi-v26/ic_launcher.xml,
// built from vector drawables (drawable/ic_launcher_foreground.xml + the blue
// @color/ic_launcher_background), so no foreground PNGs are generated any more.
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

const SRC = path.resolve("public/icon-512.png");
const RES = path.resolve("android/app/src/main/res");

// Legacy + round launcher sizes (full-bleed square in px).
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function main() {
  const src = await fs.readFile(SRC);

  for (const [density, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, `mipmap-${density}`);

    // Square launcher icon.
    const square = await sharp(src).resize(size, size, { fit: "cover" }).png().toBuffer();
    await fs.writeFile(path.join(dir, "ic_launcher.png"), square);

    // Round launcher icon: same image masked by a circle.
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
    );
    const round = await sharp(square)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    await fs.writeFile(path.join(dir, "ic_launcher_round.png"), round);
  }

  console.log("Icons generated for densities:", Object.keys(LEGACY).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
