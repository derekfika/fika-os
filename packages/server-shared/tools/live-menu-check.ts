/**
 * LIVE verification of the menu-artifact path against real Google Drive + Slides (local OAuth or hosted DWD), using the
 * same engine as the staging live-check routes.
 *
 *   npx tsx packages/server-shared/tools/live-menu-check.ts [core|amend|paging ...]   (default: all three, in order)
 *
 * Credentials come from the environment exactly as the apps resolve them:
 *   local:  FIKA_RUNTIME_MODE=local + GOOGLE_OAUTH_CLIENT_FILE / GOOGLE_OAUTH_TOKEN_FILE
 *   hosted: GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON (NODE_ENV=production)
 * Required: GOOGLE_MENU_TEMPLATE_ID_MNK, GOOGLE_MENU_LABEL_TEMPLATE_ID_MNK and the MNK OPLOC destination
 * (GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_<KEY> + GOOGLE_MENU_PARENT_FOLDER_ID_OPLOC_<KEY>).
 * Writes `LIVECHECK_*` files under <parent>/WC_2026-10-05 (the `cleanup` group trashes them again); superseded files go to the Drive trash; nothing is
 * permanently deleted. Results: artifacts/live-check/result.json (git-ignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { menuDestinationToken, resolveMenuDestination } from "../src/menu-artifact";
import { runMenuLiveCheck, type LiveCheckGroup } from "../src/menu-livecheck";

async function main() {
  const destination = resolveMenuDestination({ oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f" });
  const token = await menuDestinationToken(destination);
  const runId = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const groups = (process.argv.slice(2).length ? process.argv.slice(2) : ["core", "amend", "paging"]) as LiveCheckGroup[];
  const reports = [];
  for (const group of groups) {
    const report = await runMenuLiveCheck({ destination, token, group, runId });
    reports.push(report);
    console.log(group, report.passed ? "PASS" : "FAIL", JSON.stringify(report.checks.filter(entry => !entry.ok)));
  }
  mkdirSync("artifacts/live-check", { recursive: true });
  writeFileSync("artifacts/live-check/result.json", JSON.stringify({ runId, reports }, null, 2));
  if (reports.some(report => !report.passed)) process.exit(1);
}
main().catch(error => { console.error("LIVE CHECK FAILED:", error.message); process.exit(1); });
