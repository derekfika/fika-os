// Generates the per-van FIKA home-screen icons from the approved white logo.
// Run from apps/logistics: node scripts/generate-pwa-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const BRAND = { r: 0x4f, g: 0x34, b: 0xc7, alpha: 1 }; // --color-brand-primary
const LOGO = "public/brand-assets/logos/fika_logo_white_png.png";
const OUT = "public/pwa";

async function icon({ van, size, maskable = false }) {
  // Maskable icons keep the mark inside the central safe zone so platform masks never clip it.
  const logoWidth = Math.round(size * (maskable ? 0.42 : 0.52));
  const logo = await sharp(LOGO).resize({ width: logoWidth }).png().toBuffer();
  const logoMeta = await sharp(logo).metadata();
  const labelSize = Math.round(size * 0.1);
  const label = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="${Math.round(size * (maskable ? 0.78 : 0.84))}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${labelSize}" fill="#ffffff">VAN ${van}</text></svg>`,
  );
  const top = Math.round((size - logoMeta.height) / 2) - Math.round(size * 0.06);
  const left = Math.round((size - logoWidth) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: BRAND } })
    .composite([{ input: logo, top, left }, { input: label, top: 0, left: 0 }])
    .flatten({ background: BRAND })
    .png()
    .toBuffer();
}

await mkdir(OUT, { recursive: true });
for (const van of ["1", "2"]) {
  const files = [
    { name: `van${van}-192.png`, size: 192 },
    { name: `van${van}-512.png`, size: 512 },
    { name: `van${van}-maskable-512.png`, size: 512, maskable: true },
    { name: `van${van}-apple-touch-180.png`, size: 180 },
  ];
  for (const file of files) {
    const buffer = await icon({ van, ...file });
    await sharp(buffer).toFile(`${OUT}/${file.name}`);
    console.log("wrote", `${OUT}/${file.name}`);
  }
}
