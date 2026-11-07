import { createHash } from "node:crypto";
import {
  MAX_RECIPE_DOCUMENT_BYTES, MAX_RECIPE_STANDARD_DOCUMENT_BYTES, recipeDocumentFormatSchema,
  type DocumentRecipeProvenance, type LocalDocumentImportPreview, type LocalImportReview, type RecipeDocumentFormat,
} from "./contracts";
import { importFingerprint, previewPastedRecipes } from "./import-preview";
import { extractOfficeRecipeSource, OfficeDocumentLimitError, type OfficeRecipeSource } from "./import-office";
import { extractPdfRecipeText } from "./import-pdf";

const DOCUMENT_ADAPTER_VERSION = "recipe-document-v2";
const MAX_ACTIVE_PARSES = 2;
const mediaTypes = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
} satisfies Record<RecipeDocumentFormat, string>;
let activeParses = 0;

export class RecipeDocumentError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export type RecipeDocumentUpload = { bytes: Buffer; fileName: string; mediaType: string };

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourceFormat(upload: RecipeDocumentUpload) {
  if (!upload.bytes.length) throw new RecipeDocumentError("Choose a non-empty recipe document.", 400, "BEVERAGE_IMPORT_DOCUMENT_REQUIRED");
  if (!upload.fileName || upload.fileName.length > 160 || /[\\/:\p{Cc}\p{Cf}]/u.test(upload.fileName)) {
    throw new RecipeDocumentError("Use a file name without path or control characters.", 400, "BEVERAGE_IMPORT_DOCUMENT_NAME_INVALID");
  }
  const format = recipeDocumentFormatSchema.safeParse(upload.fileName.split(".").at(-1)?.toLowerCase());
  if (format.success && upload.bytes.length > (format.data === "pptx" ? MAX_RECIPE_DOCUMENT_BYTES : MAX_RECIPE_STANDARD_DOCUMENT_BYTES)) {
    const limit = format.data === "pptx" ? "12 MiB" : "4 MiB";
    throw new RecipeDocumentError(`Recipe ${format.data.toUpperCase()} documents are limited to ${limit}.`, 413, "BEVERAGE_IMPORT_DOCUMENT_TOO_LARGE");
  }
  const type = upload.mediaType.toLowerCase();
  if (!upload.fileName.includes(".") || !format.success ||
      (type && type !== "application/octet-stream" && type !== mediaTypes[format.data] && !(type === "application/zip" && format.data !== "pdf"))) {
    throw new RecipeDocumentError("Choose a DOCX, PPTX or PDF recipe document.", 415, "BEVERAGE_IMPORT_DOCUMENT_FORMAT");
  }
  const signature = upload.bytes.subarray(0, 12).toString("ascii");
  const valid = format.data === "pdf"
    ? /^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(signature) && /%%EOF\s*$/.test(upload.bytes.subarray(-1024).toString("latin1"))
    : upload.bytes.readUInt8(0) === 0x50 && upload.bytes[1] === 0x4b && upload.bytes[2] === 3 && upload.bytes[3] === 4;
  if (!valid) throw new RecipeDocumentError("The file signature or structure does not match its document type.", 415, "BEVERAGE_IMPORT_DOCUMENT_SIGNATURE");
  return format.data;
}

const documentLimit = () => new RecipeDocumentError("The document exceeds the extraction limits. Split or simplify it and try again.", 413, "BEVERAGE_IMPORT_DOCUMENT_LIMIT");
const invalidDocument = () => new RecipeDocumentError("The document is corrupt, encrypted or unsupported. Export a fresh copy or paste the text.", 422, "BEVERAGE_IMPORT_DOCUMENT_INVALID");
const changedPreview = () => new RecipeDocumentError("The original document or selected recipe changed. Preview and review it again.", 409, "BEVERAGE_IMPORT_PREVIEW_CHANGED");

async function extractSource(bytes: Buffer, format: RecipeDocumentFormat, includeImages: boolean): Promise<OfficeRecipeSource> {
  if (activeParses >= MAX_ACTIVE_PARSES) throw new RecipeDocumentError("The local extractor is busy. Try again in a moment.", 429, "BEVERAGE_IMPORT_DOCUMENT_BUSY");
  activeParses++;
  try {
    if (format !== "pdf") {
      try { return await extractOfficeRecipeSource(bytes, format, includeImages); }
      catch (error) { throw error instanceof OfficeDocumentLimitError ? documentLimit() : invalidDocument(); }
    }
    const result = await extractPdfRecipeText(bytes);
    if ("text" in result) return { text: result.text, slides: [], images: [], unsupportedImageCount: 0 };
    if (result.error === "limit") throw documentLimit();
    if (result.error === "unavailable") throw new RecipeDocumentError("The local PDF extractor is unavailable.", 503, "BEVERAGE_IMPORT_DOCUMENT_UNAVAILABLE");
    throw invalidDocument();
  } finally {
    activeParses--;
  }
}

function slideImportText(source: OfficeRecipeSource) {
  if (!source.slides.length) return { text: source.text, sourcePages: [] as number[], inferredTitles: new Set<number>(), inferredGlassware: new Set<number>(), authors: [] as string[] };
  const blocks: string[] = [];
  const sourcePages: number[] = [];
  const inferredTitles = new Set<number>();
  const inferredGlassware = new Set<number>();
  const authors: string[] = [];
  let parsedIndex = 0;
  for (const slide of source.slides) {
    const slideBlocks = (slide.textBlocks.length ? slide.textBlocks : [slide.text]).map(block => block.trim()).filter(Boolean);
    const credit = slideBlocks.find(block => /^by\s+.+/i.test(block));
    authors.push(credit ? credit.replace(/^by\s+/i, "").trim() : "");
    const recipeBlocks = slideBlocks.filter(block => !/^by\s+.+/i.test(block));
    if (!recipeBlocks.length) continue;
    const first = recipeBlocks[0].split(/\r?\n/, 1)[0].trim();
    const isLabeled = /^(?:name|drink)\s*:/i.test(first);
    const isField = /^[a-z ]+\s*:/i.test(first);
    const inferredTitle = !isLabeled && !isField;
    const normalizedBlocks = recipeBlocks.map(block => block.replace(/^methods?\s*:/i, "Method:"));
    if (inferredTitle) normalizedBlocks[0] = `Name: ${first}${normalizedBlocks[0].slice(first.length)}`;
    let inferredGlasswareCandidate = false;
    const lastBlock = normalizedBlocks.at(-1);
    if (normalizedBlocks.length > 1 && lastBlock && !/^[a-z ]+\s*:/i.test(lastBlock)) {
      normalizedBlocks[normalizedBlocks.length - 1] = `Glassware: ${lastBlock}`;
      inferredGlasswareCandidate = true;
    }
    const block = normalizedBlocks.join("\n");
    const perSlide = previewPastedRecipes(block);
    for (const [index] of perSlide.candidates.entries()) {
      sourcePages.push(slide.slideNumber);
      if (index === 0 && inferredTitle) inferredTitles.add(parsedIndex);
      if (index === 0 && inferredGlasswareCandidate) inferredGlassware.add(parsedIndex);
      parsedIndex++;
    }
    blocks.push(block);
  }
  return { text: blocks.join("\n---\n"), sourcePages, inferredTitles, inferredGlassware, authors };
}

async function preview(upload: RecipeDocumentUpload, expectedHash?: string, includeImages = true): Promise<LocalDocumentImportPreview> {
  const format = sourceFormat(upload);
  const sourceHash = sha256(upload.bytes);
  if (expectedHash && sourceHash !== expectedHash) throw changedPreview();
  const extracted = await extractSource(upload.bytes, format, includeImages);
  const sourceText = format === "pptx" ? slideImportText(extracted) : { text: extracted.text, sourcePages: [] as number[], inferredTitles: new Set<number>(), inferredGlassware: new Set<number>(), authors: [] as string[] };
  const text = sourceText.text;
  if (!text.trim()) throw new RecipeDocumentError("No recipe text was found. Use an export with selectable text or paste the text.", 422, "BEVERAGE_IMPORT_DOCUMENT_NO_TEXT");
  const parsed = previewPastedRecipes(text);
  const document = { format, byteLength: upload.bytes.length, adapterVersion: DOCUMENT_ADAPTER_VERSION, textHash: parsed.sourceHash };
  return {
    sourceHash,
    sourceLabel: upload.fileName,
    document,
    imageCandidates: extracted.images,
    unsupportedImageCount: extracted.unsupportedImageCount,
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      candidateHash: importFingerprint(JSON.stringify([DOCUMENT_ADAPTER_VERSION, format, sourceHash, candidate.candidateHash])),
      ...(sourceText.sourcePages[candidate.index] ? { sourcePage: sourceText.sourcePages[candidate.index] } : {}),
      ...(sourceText.sourcePages[candidate.index] && sourceText.authors[sourceText.sourcePages[candidate.index] - 1] ? { sourceAuthor: sourceText.authors[sourceText.sourcePages[candidate.index] - 1] } : {}),
      ...(sourceText.sourcePages[candidate.index] ? { imageReferences: extracted.images.flatMap(image => image.references.filter(reference => reference.slideNumber === sourceText.sourcePages[candidate.index]).map(reference => ({ sha256: image.sha256, mediaPartName: reference.mediaPartName, objectIndex: reference.objectIndex }))) } : {}),
      warnings: [
        ...candidate.warnings,
        ...(sourceText.inferredTitles.has(candidate.index) ? ["An unlabelled slide title was used as the drink name. Verify it against the source."] : []),
        ...(sourceText.inferredGlassware.has(candidate.index) ? ["The final unlabelled slide text was mapped as a glassware candidate. Verify it against the source."] : []),
        "Check extracted reading order and recipe fields against the original document.",
      ],
    })),
  };
}

export function previewRecipeDocument(upload: RecipeDocumentUpload) {
  return preview(upload);
}

export async function requireDocumentRecipeCandidate(
  upload: RecipeDocumentUpload,
  review: Pick<LocalImportReview, "sourceHash" | "candidateIndex" | "candidateHash">,
): Promise<DocumentRecipeProvenance> {
  const result = await preview(upload, review.sourceHash);
  const candidate = result.candidates[review.candidateIndex];
  if (!candidate || candidate.candidateHash !== review.candidateHash) throw changedPreview();
  return { sourceHash: result.sourceHash, sourceLabel: result.sourceLabel, document: result.document, candidate: {
    index: candidate.index, hash: candidate.candidateHash,
    ...(candidate.sourcePage ? { slideNumber: candidate.sourcePage } : {}),
    ...(candidate.sourceAuthor ? { sourceAuthor: candidate.sourceAuthor } : {}),
    ...(candidate.imageReferences?.length ? { imageReferences: candidate.imageReferences } : {}),
  } };
}
