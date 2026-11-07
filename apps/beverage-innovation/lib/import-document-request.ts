import { MAX_RECIPE_DOCUMENT_BYTES, MAX_RECIPE_STANDARD_DOCUMENT_BYTES, localImportReviewSchema } from "./contracts";
import { RecipeDocumentError, type RecipeDocumentUpload } from "./import-document";

const MAX_REVIEW_BYTES = 128 * 1024;
const MAX_MULTIPART_BYTES = MAX_RECIPE_DOCUMENT_BYTES + MAX_REVIEW_BYTES + 4096;
const UPLOAD_TIMEOUT_MS = 10_000;
const invalid = () => new RecipeDocumentError("Send one file and the required review fields as multipart form data.", 400, "BEVERAGE_IMPORT_DOCUMENT_FORM_INVALID");
const tooLarge = () => new RecipeDocumentError("PPTX documents are limited to 12 MiB; DOCX and PDF documents are limited to 4 MiB. Review data is limited to 128 KiB.", 413, "BEVERAGE_IMPORT_DOCUMENT_TOO_LARGE");

async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_MULTIPART_BYTES) throw tooLarge();
  if (!request.body) throw invalid();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, UPLOAD_TIMEOUT_MS);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (timedOut) throw new RecipeDocumentError("The local document upload timed out.", 408, "BEVERAGE_IMPORT_DOCUMENT_TIMEOUT");
      if (done) break;
      length += value.byteLength;
      if (length > MAX_MULTIPART_BYTES) throw tooLarge();
      chunks.push(value);
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof RecipeDocumentError ? error : invalid();
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

async function documentForm(request: Request, expectedParts: number) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new RecipeDocumentError("Send document imports from the local Beverage app.", 403, "BEVERAGE_IMPORT_DOCUMENT_ORIGIN");
  }
  const contentType = request.headers.get("content-type") || "";
  const match = /^multipart\/form-data;\s*boundary=(?:"([-A-Za-z0-9'()+_,./:=?]{1,70})"|([-A-Za-z0-9'()+_,./:=?]{1,70}))$/i.exec(contentType);
  if (!match) throw invalid();
  const body = await boundedBody(request);
  const marker = Buffer.from(`--${match[1] || match[2]}`);
  if (!body.subarray(0, marker.length).equals(marker)) throw invalid();
  const delimiter = Buffer.concat([Buffer.from("\r\n"), marker]);
  let parts = 0;
  for (let position = body.indexOf(delimiter); position !== -1; position = body.indexOf(delimiter, position + delimiter.length)) {
    if (++parts > expectedParts) throw invalid();
  }
  if (parts !== expectedParts) throw invalid();
  let form: FormData;
  try { form = await new Response(new Uint8Array(body), { headers: { "Content-Type": contentType } }).formData(); }
  catch { throw invalid(); }
  if ([...form].length !== expectedParts) throw invalid();
  const file = form.get("file");
  if (!file || typeof file === "string" || form.getAll("file").length !== 1) throw invalid();
  const fileLimit = file.name.toLowerCase().endsWith(".pptx") ? MAX_RECIPE_DOCUMENT_BYTES : MAX_RECIPE_STANDARD_DOCUMENT_BYTES;
  if (file.size > fileLimit) throw tooLarge();
  const upload: RecipeDocumentUpload = { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, mediaType: file.type };
  return { form, upload };
}

export async function readDocumentPreviewRequest(request: Request) {
  return (await documentForm(request, 1)).upload;
}

export async function readDocumentCommitRequest(request: Request) {
  const { form, upload } = await documentForm(request, 2);
  const value = form.get("review");
  if (typeof value !== "string" || form.getAll("review").length !== 1) throw invalid();
  if (Buffer.byteLength(value) > MAX_REVIEW_BYTES) throw tooLarge();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw invalid(); }
  return { upload, review: localImportReviewSchema.parse(parsed) };
}
