/**
 * Dish Library V2 archive-and-cutover entry point (issue #151). Dry-run / read-only by default; every write
 * path is behind lib/catalogue-cutover/guards.ts. See migrations/dish-library-v2/RUNBOOK.md.
 *
 *   npx tsx scripts/dish-library-v2/cutover.ts --help
 */
import { main } from "../../lib/catalogue-cutover/cli";

process.exitCode = await main(process.argv.slice(2), {
  out: text => process.stdout.write(`${text}\n`),
  err: text => process.stderr.write(`${text}\n`),
  env: process.env,
  cwd: process.cwd(),
});
