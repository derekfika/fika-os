import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import ImportReview from "../app/imports/ImportReview";
import { MAX_RECIPE_DOCUMENT_BYTES, MAX_RECIPE_STANDARD_DOCUMENT_BYTES } from "../lib/contracts";
import { previewRecipeDocument } from "../lib/import-document";
import { docxFixture, pdfFixture, pptxFixture } from "./fixtures/recipe-documents";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const button = (root: ReactTestInstance, text: string) => root.findAllByType("button").find(item => item.children.includes(text))!;
const label = (root: ReactTestInstance, text: string) => root.findAllByType("label").find(item => item.children.filter(child => typeof child === "string").join("").trim() === text)!;
const chooseDocument = async (root: ReactTestInstance) => { await act(async () => { root.findAllByProps({ name: "source-type" })[1].props.onChange(); }); };
const selectFile = async (root: ReactTestInstance, file: File) => { await act(async () => { root.findByProps({ type: "file" }).props.onChange({ currentTarget: { files: [file], value: "chosen" } }); }); };

test("document review supports all adapters and retains the exact file and review for retry", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const upload of [docxFixture(), pptxFixture(), pdfFixture()]) {
    const parsed = await previewRecipeDocument(upload);
    const file = new File([new Uint8Array(upload.bytes)], upload.fileName, { type: upload.mediaType });
    const commits: { key: string; review: string; file: File }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const form = init?.body as FormData;
      const received = form.get("file");
      assert.ok(received instanceof File);
      assert.equal(received.name, file.name);
      assert.deepEqual(Buffer.from(await received.arrayBuffer()), upload.bytes);
      if (url.endsWith("/preview")) return Response.json(parsed);
      commits.push({ key: (init?.headers as Record<string, string>)["idempotency-key"], review: String(form.get("review")), file: received });
      if (commits.length === 1) throw new TypeError("response lost");
      if (commits.length === 2) return Response.json({ error: { message: "Unavailable" } }, { status: 403 });
      return Response.json({ record: { name: "Fixture Honey Fizz" }, sourceHash: parsed.sourceHash }, { status: 201 });
    };
    let rendered!: ReactTestRenderer;
    await act(async () => { rendered = create(createElement(ImportReview)); });
    await chooseDocument(rendered.root); await selectFile(rendered.root, file);
    await act(async () => { button(rendered.root, "Preview candidates").props.onClick(); });
    const visible = JSON.stringify(rendered.toJSON());
    assert.ok(visible.includes(file.name));
    assert.ok(visible.includes(parsed.document.adapterVersion));
    assert.ok(visible.includes(parsed.sourceHash));
    assert.ok(visible.includes(parsed.document.textHash));
    assert.ok(visible.includes(parsed.document.format.toUpperCase()));
    assert.ok(visible.includes(file.size.toLocaleString("en-GB")));
    assert.equal(rendered.root.findAllByProps({ name: "candidate" }).length, 2);
    if (parsed.document.format === "pptx") {
      assert.ok(visible.includes("Embedded image layers"));
      assert.ok(visible.includes("not attached to the recipe or retained with a draft"));
      assert.ok(rendered.root.findAllByType("img").some(image => image.props.src === parsed.imageCandidates[0].dataUrl));
    }
    await act(async () => { rendered.root.findAllByProps({ name: "candidate" })[1].props.onChange(); });
    await act(async () => { label(rendered.root, "Classification").findByType("select").props.onChange({ target: { value: "draft_concept" } }); });
    await act(async () => { label(rendered.root, "Preparation method").findByType("textarea").props.onChange({ target: { value: "Reviewed method." } }); });
    await act(async () => { rendered.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }); });
    await act(async () => { button(rendered.root, "Create local draft").props.onClick(); });
    assert.equal(rendered.root.findByProps({ type: "file" }).props.disabled, true);
    await selectFile(rendered.root, new File(["different"], "replacement.docx"));
    await act(async () => { button(rendered.root, "Retry same request").props.onClick(); });
    assert.equal(rendered.root.findByProps({ type: "file" }).props.disabled, true);
    await act(async () => { button(rendered.root, "Retry same request").props.onClick(); });
    assert.equal(commits.length, 3);
    assert.ok(commits.every(attempt => attempt.key === commits[0].key && attempt.review === commits[0].review && attempt.file.name === commits[0].file.name));
    const review = JSON.parse(commits[0].review);
    assert.equal(review.sourceHash, parsed.sourceHash);
    assert.equal(review.candidateIndex, 1);
    assert.equal(review.candidateHash, parsed.candidates[1].candidateHash);
    assert.equal(review.reviewed, true);
    assert.equal(review.reviewedCandidate.method, "Reviewed method.");
    assert.equal("text" in review, false);
    const changed = new Uint8Array(upload.bytes); changed[changed.length - 1] ^= 1;
    await selectFile(rendered.root, new File([changed], file.name, { type: upload.mediaType }));
    assert.equal(rendered.root.findAllByProps({ name: "candidate" }).length, 0, "a same-name, same-size replacement invalidates the preview");
    await act(async () => { rendered.root.findAllByProps({ name: "source-type" })[0].props.onChange(); });
    assert.equal(rendered.root.findAllByProps({ type: "file" }).length, 0, "switching to pasted text releases the file control");
    await act(async () => { rendered.unmount(); });
  }
});

test("a document preview that does not match the selected file is not offered for review", async t => {
  const originalFetch = globalThis.fetch;
  const upload = docxFixture();
  const parsed = await previewRecipeDocument(upload);
  globalThis.fetch = async () => Response.json({ ...parsed, sourceLabel: "other.docx" });
  t.after(() => { globalThis.fetch = originalFetch; });
  let rendered!: ReactTestRenderer;
  await act(async () => { rendered = create(createElement(ImportReview)); });
  t.after(() => { act(() => rendered.unmount()); });
  await chooseDocument(rendered.root);
  await selectFile(rendered.root, new File([new Uint8Array(upload.bytes)], upload.fileName, { type: upload.mediaType }));
  await act(async () => { button(rendered.root, "Preview candidates").props.onClick(); });
  assert.equal(rendered.root.findAllByProps({ name: "candidate" }).length, 0);
  assert.ok(JSON.stringify(rendered.toJSON()).includes("Could not preview the recipe"));
});

test("document picker reports unsupported, empty, oversized and signature errors without a commit", async t => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: { message: "The file signature or structure does not match its document type." } }, { status: 415 }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  let rendered!: ReactTestRenderer;
  await act(async () => { rendered = create(createElement(ImportReview)); });
  t.after(() => { act(() => rendered.unmount()); });
  await chooseDocument(rendered.root);
  await selectFile(rendered.root, new File(["x"], "recipe.txt"));
  assert.ok(JSON.stringify(rendered.toJSON()).includes("Choose a DOCX, PPTX or PDF"));
  await selectFile(rendered.root, new File([], "empty.pdf"));
  assert.ok(JSON.stringify(rendered.toJSON()).includes("non-empty"));
  await selectFile(rendered.root, new File([new Uint8Array(MAX_RECIPE_STANDARD_DOCUMENT_BYTES + 1)], "large.pdf"));
  assert.ok(JSON.stringify(rendered.toJSON()).includes("limited to 4 MiB"));
  assert.equal(requests, 0);
  await selectFile(rendered.root, new File(["not a PDF"], "invalid.pdf", { type: "application/pdf" }));
  await act(async () => { button(rendered.root, "Preview candidates").props.onClick(); });
  assert.ok(JSON.stringify(rendered.toJSON()).includes("signature or structure"));
  assert.equal(requests, 1);
  assert.equal(rendered.root.findAllByProps({ name: "candidate" }).length, 0);
});
