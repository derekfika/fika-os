import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { POST as preview } from "../app/api/imports/documents/preview/route";
import { POST as commit } from "../app/api/imports/documents/commit/route";
import { MAX_RECIPE_DOCUMENT_BYTES } from "../lib/contracts";
import { previewRecipeDocument, requireDocumentRecipeCandidate } from "../lib/import-document";
import { docxFixture, documentRequest, pdfFixture, pptxFixture, zipFixture } from "./fixtures/recipe-documents";

test("DOCX, reordered PPTX, and text PDF extract multiple fictional recipes with byte provenance", async () => {
  for (const upload of [docxFixture(), pptxFixture(), pdfFixture()]) {
    const result = await previewRecipeDocument(upload);
    assert.equal(result.sourceHash, createHash("sha256").update(upload.bytes).digest("hex"));
    assert.equal(result.sourceLabel, upload.fileName);
    assert.equal(result.document.byteLength, upload.bytes.length);
    assert.equal(result.document.format, upload.fileName.split(".").at(-1));
    assert.match(result.document.textHash, /^[a-f0-9]{64}$/);
    assert.notEqual(result.document.textHash, result.sourceHash);
    assert.deepEqual(result.candidates.map(candidate => candidate.recipe.name), ["Fixture Citrus Cooler", "Fixture Honey Fizz"]);
    assert.deepEqual(result.candidates[0].recipe.ingredients, [{ amount: 12.5, unit: "ml", name: "lime juice" }, { name: "mint leaves" }]);
    assert.deepEqual(result.candidates[1].recipe.equipment, ["Spoon"]);
    assert.ok(result.candidates[0].warnings.some(warning => warning.includes("omitted")));
    assert.ok(!JSON.stringify(result.candidates[0].recipe).includes("Cost:"));
    assert.ok(result.candidates.every(candidate => candidate.warnings.some(warning => warning.includes("reading order"))));
  }
});

test("PPTX preview preserves recipe slide provenance and exposes embedded photos as unpersisted review candidates", async () => {
  const result = await previewRecipeDocument(pptxFixture());
  assert.deepEqual(result.candidates.map(candidate => [candidate.recipe.name, candidate.sourcePage]), [["Fixture Citrus Cooler", 1], ["Fixture Honey Fizz", 2]]);
  assert.equal(result.candidates[0].sourceAuthor, "Anne Knight");
  assert.equal(result.candidates[0].recipe.glassware, "Highball");
  assert.equal(result.imageCandidates.length, 1);
  assert.equal(result.imageCandidates[0].mimeType, "image/png");
  assert.match(result.imageCandidates[0].dataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(result.imageCandidates[0].references, [{ slideNumber: 1, objectIndex: 1, mediaPartName: "ppt/media/image1.png" }]);
  assert.match(result.imageCandidates[0].sha256, /^[a-f0-9]{64}$/);
  const candidate = result.candidates[0];
  const provenance = await requireDocumentRecipeCandidate(pptxFixture(), { sourceHash: result.sourceHash, candidateIndex: 0, candidateHash: candidate.candidateHash });
  assert.deepEqual(provenance.candidate, { index: 0, hash: candidate.candidateHash, slideNumber: 1, sourceAuthor: "Anne Knight", imageReferences: [{ sha256: result.imageCandidates[0].sha256, mediaPartName: "ppt/media/image1.png", objectIndex: 1 }] });
  assert.ok(!JSON.stringify(provenance).includes("data:image"));
});

test("PPTX external image targets and oversized pixel dimensions are never fetched or previewed", async () => {
  const external = await previewRecipeDocument(pptxFixture(false, undefined, "https://example.test/photo.png"));
  assert.equal(external.imageCandidates.length, 0);
  assert.equal(external.unsupportedImageCount, 1);
  const oversized = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/x9sAAAAASUVORK5CYII=", "base64");
  oversized.writeUInt32BE(50_000, 16);
  const limited = await previewRecipeDocument(pptxFixture(false, oversized));
  assert.equal(limited.imageCandidates.length, 0);
  assert.equal(limited.unsupportedImageCount, 1);
});

test("candidate validation rejects changed original bytes even when the extracted text is identical", async () => {
  const file = docxFixture();
  const result = await previewRecipeDocument(file);
  const candidate = result.candidates[1];
  const selection = { sourceHash: result.sourceHash, candidateIndex: candidate.index, candidateHash: candidate.candidateHash };
  const alternate = docxFixture({ extra: [["docProps/irrelevant.xml", "<fictional/>"]] });
  const other = await previewRecipeDocument(alternate);
  assert.equal(other.document.textHash, result.document.textHash);
  assert.notEqual(other.sourceHash, result.sourceHash);
  assert.notEqual(other.candidates[1].candidateHash, candidate.candidateHash);
  assert.deepEqual(await requireDocumentRecipeCandidate(file, selection), {
    sourceHash: result.sourceHash, sourceLabel: file.fileName, document: result.document,
    candidate: { index: 1, hash: candidate.candidateHash },
  });
  await assert.rejects(() => requireDocumentRecipeCandidate(alternate, selection), { code: "BEVERAGE_IMPORT_PREVIEW_CHANGED" });
  await assert.rejects(() => requireDocumentRecipeCandidate(file, { ...selection, candidateIndex: 0 }), { code: "BEVERAGE_IMPORT_PREVIEW_CHANGED" });
});

test("reject corrupt, oversized, mislabelled, macro, DTD, and external Office package inputs", async () => {
  const docx = docxFixture();
  const malformedZip = { ...docx, bytes: docx.bytes.subarray(0, 34) };
  const crcCorruption = Buffer.from(docx.bytes);
  const centralDirectory = crcCorruption.readUInt32LE(crcCorruption.length - 6);
  crcCorruption.writeUInt32LE(0, centralDirectory + 16);
  const cases = [
    [malformedZip, "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [{ ...docx, bytes: crcCorruption }, "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [{ ...docx, bytes: Buffer.alloc(MAX_RECIPE_DOCUMENT_BYTES + 1) }, "BEVERAGE_IMPORT_DOCUMENT_TOO_LARGE"],
    [{ ...docx, fileName: "mislabelled.pdf", mediaType: "application/pdf" }, "BEVERAGE_IMPORT_DOCUMENT_SIGNATURE"],
    [{ ...docx, fileName: "recipe.docm" }, "BEVERAGE_IMPORT_DOCUMENT_FORMAT"],
    [docxFixture({ extra: [["word/vbaProject.bin", "malicious fixture"]] }), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [docxFixture({ mainType: "application/vnd.ms-word.document.macroEnabled.main+xml" }), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [docxFixture({ prefix: '<!DOCTYPE w:document SYSTEM "https://example.test/never-fetch">' }), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [docxFixture({ extra: [["../unsafe", "path"]] }), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [docxFixture({ extra: [["WORD/DOCUMENT.XML", "ambiguous"]] }), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
    [docxFixture({ lines: ["x".repeat(2 * 1024 * 1024)] }), "BEVERAGE_IMPORT_DOCUMENT_LIMIT"],
    [docxFixture({ lines: ["x".repeat(20_001)] }), "BEVERAGE_IMPORT_DOCUMENT_LIMIT"],
    [{ ...docx, bytes: zipFixture(Array.from({ length: 513 }, (_, index) => [`part${index}.xml`, "x"])) }, "BEVERAGE_IMPORT_DOCUMENT_LIMIT"],
    [pptxFixture(true), "BEVERAGE_IMPORT_DOCUMENT_INVALID"],
  ] as const;
  for (const [input, code] of cases) await assert.rejects(() => previewRecipeDocument(input), { code });
});

test("PDF adapter rejects corrupt, blank and too-many-page inputs", async () => {
  await assert.rejects(() => previewRecipeDocument({ ...pdfFixture(), bytes: Buffer.from("%PDF-1.4\ninvalid document\n%%EOF\n") }), { code: "BEVERAGE_IMPORT_DOCUMENT_INVALID" });
  await assert.rejects(() => previewRecipeDocument(pdfFixture([[]])), { code: "BEVERAGE_IMPORT_DOCUMENT_NO_TEXT" });
  await assert.rejects(() => previewRecipeDocument(pdfFixture(Array.from({ length: 41 }, () => ["Name: Fixture"]))), { code: "BEVERAGE_IMPORT_DOCUMENT_LIMIT" });
});

test("document routes authorise before parsing, bound multipart bodies and require explicit reviewed evidence", async t => {
  const fixtureEnv = {
    FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "demo-fika-os",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8294", FIKA_BEVERAGE_LOCAL_AUTH: "fixture",
    FIKA_BEVERAGE_LOCAL_ACTOR_ID: "fixture:document-import-test", FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS: "Contribute",
  };
  for (const [name, value] of Object.entries(fixtureEnv)) {
    const previous = process.env[name];
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
    process.env[name] = value;
  }
  const file = docxFixture();
  assert.equal((await preview(documentRequest("preview", file))).status, 503);
  assert.equal((await commit(documentRequest("commit", file))).status, 503);
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "View";
  assert.equal((await preview(documentRequest("preview", file))).status, 403);
  process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS = "Contribute";
  assert.equal((await preview(documentRequest("preview", file, undefined, { Origin: "https://example.test" }))).status, 403);
  assert.equal((await preview(documentRequest("preview", file, { unexpected: true }))).status, 400);
  assert.equal((await preview(documentRequest("preview", file, undefined, { "Content-Length": String(13 * 1024 * 1024) }))).status, 413);
  assert.equal((await preview(documentRequest("preview", { ...file, bytes: Buffer.alloc(MAX_RECIPE_DOCUMENT_BYTES + 1) }))).status, 413);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RECIPE_DOCUMENT_BYTES + 200_000)); controller.close(); } });
  const streamRequest = new Request("http://localhost:13617/api/imports/documents/preview", {
    method: "POST", body: stream, headers: { "Content-Type": "multipart/form-data; boundary=test" }, duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal((await preview(streamRequest)).status, 413);
  assert.equal((await commit(documentRequest("commit", file))).status, 400);
  const result = await previewRecipeDocument(file);
  const candidate = result.candidates[1];
  const review = { sourceHash: result.sourceHash, candidateIndex: 1, candidateHash: candidate.candidateHash, classification: "draft_concept", reviewed: true, reviewedCandidate: candidate.recipe };
  assert.equal((await commit(documentRequest("commit", file, { ...review, reviewed: false }))).status, 400);
  assert.equal((await commit(documentRequest("commit", file, { ...review, reviewedCandidate: { ...candidate.recipe, allergens: [] } }))).status, 400);
  assert.equal((await commit(documentRequest("commit", docxFixture({ extra: [["docProps/change.xml", "changed"]] }), review))).status, 409);
});
