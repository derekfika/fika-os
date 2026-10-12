import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const controls = async () => { const source = await page; return source.slice(source.indexOf("function SiteMenuControls"), source.indexOf("function SiteMenuControls") + 6500); };

test("the tablet-menu status uses the live site-menu lookup, like the labels, and only falls back to the stored projection", async () => {
  const source = await controls();
  assert.match(source, /const \[tabletState, setTabletState\] = useState<TabletState \| undefined>\(undefined\)/);
  assert.match(source, /setTabletState\(body\.siteMenu\)/, "the live GET siteMenu is stored");
  assert.match(source, /const state: TabletState = tabletState \|\| day\.siteMenu \|\| \{ status: "none" as const \}/, "live state wins over the stored day projection");
  assert.doesNotMatch(source, /const state = day\.siteMenu/, "the stored projection is no longer the primary source");
});

test("a live state never leaks across days, and a fresh tablet generation updates the state immediately", async () => {
  const source = await controls();
  assert.match(source, /setTabletState\(undefined\);[^\n]*\n\s*void fetch\(`\/api\/delivered-in\/site-menu\?oplocId=/, "reset before each day's lookup");
  assert.match(source, /if \(body\.siteMenu\) setTabletState\(body\.siteMenu\); onGenerated\(\);/, "the POST response updates the state, then the day refreshes");
});

test("generation, validation and idempotency are untouched: the POST request is unchanged", async () => {
  const source = await controls();
  assert.match(source, /action: state\.status === "none" \? "generate" : "regenerate"/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /if \(format !== "tablet" && body\.artifact\) setLabelStates/);
});
