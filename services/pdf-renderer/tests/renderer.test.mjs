import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedResource, MAX_BODY_BYTES } from "../renderer.mjs";

test("renderer allows self-contained resources only", () => {
  assert.equal(isAllowedResource("data:text/css,body{}"), true);
  assert.equal(isAllowedResource("about:blank"), true);
  assert.equal(isAllowedResource("https://example.com/remote.js"), false);
  assert.equal(isAllowedResource("http://169.254.169.254/metadata"), false);
});

test("renderer enforces a bounded request body", () => assert.equal(MAX_BODY_BYTES, 5 * 1024 * 1024));
