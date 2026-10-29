import { readFile } from "node:fs/promises";
import path from "node:path";
import { dictionaryHandler } from "@/lib/dictionary/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let bytes: Promise<Uint8Array> | undefined;
export const GET = dictionaryHandler(() => {
  bytes ??= readFile(path.join(process.cwd(), "dictionary", "en-GB-3.0.0-culinary-1.json.gz"))
    .catch(error => { bytes = undefined; throw error; });
  return bytes;
});
