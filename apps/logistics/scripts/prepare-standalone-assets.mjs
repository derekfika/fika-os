import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standaloneRoot = path.join(appRoot, ".next", "standalone");
const source = path.join(appRoot, "public");
const destination = path.join(standaloneRoot, "public");

await mkdir(standaloneRoot, { recursive: true });
await cp(source, destination, { recursive: true, force: true });
