import { open } from "node:fs/promises";
import { planAuthoredStudioMenuMigration } from "../lib/authored-menu-migration-plan";

const maximumSnapshotBytes = 32 * 1024 * 1024;

async function main() {
  const input = process.argv[2];
  if (process.argv.length !== 3 || !input || input.startsWith("-")) {
    console.error("Usage: tsx scripts/plan-authored-menu-migration.ts <local-studio-export.json>");
    return 64;
  }
  try {
    const file = await open(input, "r");
    let bytes: Buffer;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > maximumSnapshotBytes) throw Error("Invalid input file.");
      bytes = Buffer.alloc(info.size);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat();
      if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw Error("Input changed while reading.");
    } finally { await file.close(); }
    const plan = planAuthoredStudioMenuMigration(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    console.log(JSON.stringify(plan, null, 2));
    return plan.status === "BLOCKED" ? 2 : 0;
  } catch {
    console.error("The supplied Studio export was unreadable or failed identity and archive checks. No plan was produced.");
    return 65;
  }
}

process.exitCode = await main();
