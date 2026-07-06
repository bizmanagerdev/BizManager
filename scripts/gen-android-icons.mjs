// Generate Android launcher icons for the Capacitor shell from public/icon-512.png.
// Produces legacy square, round, and adaptive-icon foreground assets at every density.
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

const SRC = path.resolve("public/icon-512.png");
const RES = path.resolve("android/app/src/main/res");

// Legacy + round launcher sizes (full-bleed square in px).
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
// Adaptive foreground canvas sizes (108dp). The logo sits in the ~66% safe zone.
const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

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

  for (const [density, canvas] of Object.entries(FG)) {
    const dir = path.join(RES, `mipmap-${density}`);
    // Fit the logo into the inner 66% safe zone, centered on a transparent canvas.
    const inner = Math.round(canvas * 0.66);
    const logo = await sharp(src)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .toBuffer();
    const pad = Math.round((canvas - inner) / 2);
    const fg = await sharp({
      create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: logo, top: pad, left: pad }])
      .png()
      .toBuffer();
    await fs.writeFile(path.join(dir, "ic_launcher_foreground.png"), fg);
  }

  console.log("Icons generated for densities:", Object.keys(LEGACY).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
