import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("hero heading keeps a breakable space where a site hides the <br />, so 'Hospitality,elevated.' can never fuse into one 473px word", () => {
  const portal = read("../app/ui/BookingPortal.tsx");
  assert.match(portal, /Hospitality,\{" "\}\s*<br \/>\s*elevated\./);
  const css = read("../app/globals.css");
  assert.match(css, /\.site-angel-court \.mnk-hero h1 br\{display:none\}/, "Angel Court still shows the heading on one line when it fits");
});

test("narrow phones scale the hero heading so the widest word (CFC 'Hospitality,') fits at 320px and 375px", () => {
  const css = read("../app/globals.css");
  assert.match(css, /@media\(max-width:380px\)\{\.mnk-hero h1\{font-size:clamp\(2\.75rem,13\.5vw,3\.5rem\)\}\}/);
  assert.match(css, /\.mnk-hero h1\{font-size:clamp\(3\.5rem,8vw,6\.8rem\)/, "the shared hero sizing is unchanged above 380px");
});

test("compact top bars put the 44px reset control on its own row under the brand", () => {
  const css = read("../app/globals.css");
  assert.match(css, /@media\(max-width:400px\)\{\.mnk-top\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.mnk-top \.mnk-brand-lockup\{flex:1 1 100%/);
  assert.match(css, /\.mnk-top \.mnk-top-actions\{width:100%/);
  assert.match(css, /\.mnk-top-actions \.start-again--icon\{width:44px;min-width:44px;height:44px/);
});
