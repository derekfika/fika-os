import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  references: { type: "string" }, before: { type: "string" }, after: { type: "string" },
  output: { type: "string" }, screens: { type: "string", default: "01,02,03,04,05,06,07" },
} });
for (const key of ["references", "before", "after", "output"]) {
  assert(values[key] && isAbsolute(values[key]), `--${key} needs an absolute path.`);
}
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const img = (bytes, type) => "data:image/" + type + ";base64," + bytes.toString("base64");

function imageInfo(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { type: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 16) === "WEBPVP8L" && bytes[20] === 0x2f) {
    const dimensions = bytes.readUInt32LE(21);
    return { type: "webp", width: (dimensions & 16383) + 1, height: ((dimensions >>> 14) & 16383) + 1 };
  }
  throw new Error("Expected PNG or lossless WebP reference bytes.");
}

async function captured(directory, stem) {
  const file = join(directory, stem + "-native");
  const [bytes, provenance] = await Promise.all([readFile(file + ".png"), readFile(file + ".json", "utf-8")]);
  const metadata = JSON.parse(provenance);
  const dimensions = imageInfo(bytes);
  assert(/^[0-9a-f]{40}$/.test(metadata.app.buildSha) && /^[0-9a-f]{64}$/.test(metadata.fixtureHash),
    "Capture provenance lacks a valid source or fixture hash.");
  assert.equal(metadata.imageSha256, hash(bytes), "Recorded image hash differs from bytes.");
  assert.equal(dimensions.width, metadata.viewport.width);
  assert.equal(dimensions.height, metadata.viewport.height);
  return { bytes, metadata, dimensions };
}

const referenceNames = await readdir(values.references);
const selected = values.screens.split(",");
assert(selected.every(screen => /^0[1-7]$/.test(screen)));
const sections = [];
for (const screen of selected) {
  const references = referenceNames.filter(file => new RegExp(`^${screen}-[a-z0-9-]+\\.png$`).test(file));
  assert.equal(references.length, 1, `Expected one reference image for screen ${screen}.`);
  const referenceFile = references[0];
  const stem = basename(referenceFile, ".png");
  const [reference, before, after] = await Promise.all([
    readFile(join(values.references, referenceFile)), captured(values.before, stem), captured(values.after, stem),
  ]);
  assert.equal(before.metadata.fixtureHash, after.metadata.fixtureHash, `${stem}: before and after used different fixtures.`);
  assert.equal(before.metadata.chromiumVersion, after.metadata.chromiumVersion, `${stem}: Chromium versions differ.`);
  const dimensions = imageInfo(reference);
  for (const actual of [before, after]) {
    assert.equal(actual.dimensions.width, dimensions.width);
    assert.equal(actual.dimensions.height, dimensions.height);
  }
  const sources = [img(reference, dimensions.type), img(before.bytes, before.dimensions.type), img(after.bytes, after.dimensions.type)];
  const title = stem.replaceAll("-", " ");
  sections.push(`<section aria-labelledby="screen-${screen}">
    <h2 id="screen-${screen}">${title} · ${dimensions.width} × ${dimensions.height}</h2>
    <div class="comparison">${sources.map((source, index) => {
      const caption = ["Reference", "Before", "After"][index];
      return `<figure><img loading="lazy" src="${source}" alt="${caption} · ${title}"><figcaption>${caption}</figcaption></figure>`;
    }).join("")}</div>
    <details><summary>Compare reference and after with an overlay</summary>
      <label>After opacity <input type="range" min="0" max="100" value="50"></label>
      <div class="overlay"><img loading="lazy" src="${sources[0]}" alt="Reference"><img loading="lazy" src="${sources[2]}" alt="After"></div>
    </details>
    <p class="provenance">Reference SHA-256 ${hash(reference)}<br>Before ${before.metadata.app.buildSha}<br>After ${after.metadata.app.buildSha}${after.metadata.uncommittedCandidate ? " · working-tree candidate" : ""}<br>Fixture SHA-256 ${before.metadata.fixtureHash}</p>
  </section>`);
}

await writeFile(values.output, `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Menu Studio visual comparison</title>
<style>
  body { margin:24px auto; padding:0 24px; max-width:1800px; font:16px system-ui; color:#201b27; background:#faf9fb }
  section { padding:16px 0; border-top:1px solid #ddd8e3 }
  .comparison { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px }
  figure { margin:0 } img { display:block; max-width:100%; height:auto }
  figcaption, .provenance { margin-top:8px; color:#494152 }
  .provenance { overflow-wrap:anywhere; font-size:.85rem }
  details { margin:16px 0 } label { display:block; margin:12px 0 }
  .overlay { display:inline-grid; background:#fff }
  .overlay img { grid-area:1/1 } .overlay img + img { opacity:.5 }
  @media (max-width:800px) { .comparison { grid-template-columns:1fr } }
</style></head><body><h1>Menu Studio visual comparison</h1>${sections.join("")}
<script>
  document.querySelectorAll("input[type=range]").forEach(control => {
    control.addEventListener("input", () => {
      control.closest("details").querySelector(".overlay img + img").style.opacity = control.value / 100;
    });
  });
</script></body></html>\n`, { flag: "wx" });
