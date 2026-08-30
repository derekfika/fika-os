import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const asset = async (path, mime) => `data:${mime};base64,${(await readFile(resolve(root, path))).toString("base64")}`;
const output = `// Generated from app-local, checked-in brand assets. Do not edit manually.\nexport const FIKA_LOGO_DATA_URI = ${JSON.stringify(await asset("public/fika-logo-white.png", "image/png"))};\nexport const VIM_HEAVY_DATA_URI = ${JSON.stringify(await asset("public/fonts/Vim-Heavy.otf", "font/otf"))};\nexport const GILROY_REGULAR_DATA_URI = ${JSON.stringify(await asset("public/fonts/GILROY-REGULAR.TTF", "font/ttf"))};\nexport const GILROY_BLACK_DATA_URI = ${JSON.stringify(await asset("public/fonts/GILROY-BLACK.TTF", "font/ttf"))};\n`;
await writeFile(resolve(root, "lib/quote-brand-assets.generated.ts"), output);
