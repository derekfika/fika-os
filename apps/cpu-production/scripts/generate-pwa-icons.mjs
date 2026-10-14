import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Rasterise the existing CPU FIKA monogram; no new artwork or operational resources.
const source = await readFile(new URL("../app/icon.svg", import.meta.url));
const target = new URL("../public/icons/", import.meta.url);
await mkdir(target, { recursive: true });
for (const [size, name] of [[192, "cpu-192.png"], [512, "cpu-512.png"], [180, "cpu-apple-180.png"]]) {
  await sharp(source).resize(size, size).flatten({ background: "#4f34c7" }).png().toFile(fileURLToPath(new URL(name, target)));
}
const insetMonogram = await sharp(source).resize(384, 384).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 3, background: "#4f34c7" } })
  .composite([{ input: insetMonogram, left: 64, top: 64 }]).png()
  .toFile(fileURLToPath(new URL("cpu-maskable-512.png", target)));
