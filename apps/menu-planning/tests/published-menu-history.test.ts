import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The History panel must never present a loading or failed request as an empty published record.
test("published history shows loading and checks response status before rendering an empty record", async () => {
  const source = await readFile(new URL("../app/published-menu-history.tsx", import.meta.url), "utf8");
  assert.match(source, /useState\(true\)/, "loading must start true so the empty message is not shown before data arrives");
  assert.match(source, /Loading published menus/, "a loading status must be rendered while the request is pending");
  assert.match(source, /if \(!response\.ok \|\| !Array\.isArray\(body\?\.publications\)\) throw/, "non-2xx or malformed responses must be errors, not empty history");
  assert.match(source, /\.finally\(\(\) => setLoading\(false\)\)/, "loading must clear after success or failure");
  assert.match(source, /role="alert"/, "errors must be announced");
});
