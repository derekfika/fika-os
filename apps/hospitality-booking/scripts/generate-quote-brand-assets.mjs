import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asset = async (path, mime) => `data:${mime};base64,${(await readFile(resolve(root, path))).toString("base64")}`;
const siteAssets = {
  mnk: await asset("public/brand/mnk/mnk-international-logo.png", "image/png"),
  "angel-court": await asset("public/brand/angel-court/angel-court-bank-logo.png", "image/png"),
  cfc: await asset("public/brand/cfc/cfc-positive-logo.svg", "image/svg+xml"),
  "munich-re": await asset("public/brand/munich-re/munich-re-logo.svg", "image/svg+xml"),
};
const output = `// Generated from app-local, checked-in brand assets. Do not edit manually.\nexport const FIKA_LOGO_DATA_URI = ${JSON.stringify(await asset("public/fika-logo-white.png", "image/png"))};\nexport const VIM_HEAVY_DATA_URI = ${JSON.stringify(await asset("public/fonts/Vim-Heavy.otf", "font/otf"))};\nexport const GILROY_REGULAR_DATA_URI = ${JSON.stringify(await asset("public/fonts/GILROY-REGULAR.TTF", "font/ttf"))};\nexport const GILROY_BLACK_DATA_URI = ${JSON.stringify(await asset("public/fonts/GILROY-BLACK.TTF", "font/ttf"))};\n`;
await writeFile(resolve(root, "lib/quote-brand-assets.generated.ts"), `${output}export const SITE_LOGO_DATA_URIS: Record<string, string> = ${JSON.stringify(siteAssets)};\n`);
