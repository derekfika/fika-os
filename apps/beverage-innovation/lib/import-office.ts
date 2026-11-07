import { createHash } from "node:crypto";
import { basename, dirname, join, normalize, sep } from "node:path";
import { crc32 } from "node:zlib";
import { SaxesParser, type SaxesTagNS } from "saxes";
import { fromBufferPromise, type Entry } from "yauzl";
import { MAX_IMPORT_TEXT_LENGTH } from "./import-preview";

const MAX_ZIP_ENTRIES = 512;
const MAX_ARCHIVE_EXPANSION = 64 * 1024 * 1024;
const MAX_XML_PART_BYTES = 2 * 1024 * 1024;
const MAX_XML_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_SLIDES = 40;
const MAX_XML_DEPTH = 128;
const MAX_PPTX_MEDIA_OBJECTS = 100;
const MAX_PPTX_MEDIA_BYTES = 12 * 1024 * 1024;
const MAX_PPTX_MEDIA_OBJECT_BYTES = 8 * 1024 * 1024;
const contentTypeNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const wordNamespaces = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const drawingNamespaces = new Set(["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"]);
const presentationNamespaces = new Set(["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"]);
const documentRelationships = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];

export type OfficeImageCandidate = {
  id: string;
  mediaPartNames: string[];
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
  sha256: string;
  dataUrl: string;
  references: { slideNumber: number; objectIndex: number; mediaPartName: string }[];
};
export type OfficeSlideSource = { slideNumber: number; text: string; textBlocks: string[]; images: OfficeImageCandidate[] };
export type OfficeRecipeSource = { text: string; slides: OfficeSlideSource[]; images: OfficeImageCandidate[]; unsupportedImageCount: number };

export class OfficeDocumentLimitError extends Error {}

function xml(bytes: Buffer, handlers: { open(tag: SaxesTagNS, depth: number): void; close?(tag: SaxesTagNS, depth: number): void; text?(text: string): void }) {
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  parser.on("doctype", () => { throw new Error("OOXML DTD is not supported."); });
  parser.on("error", () => { throw new Error("OOXML XML is malformed."); });
  parser.on("opentag", tag => {
    if (++depth > MAX_XML_DEPTH) throw new OfficeDocumentLimitError();
    handlers.open(tag, depth);
  });
  parser.on("closetag", tag => { handlers.close?.(tag, depth); depth--; });
  parser.on("text", text => handlers.text?.(text));
  parser.on("cdata", text => handlers.text?.(text));
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(bytes)).close();
}

function attribute(tag: SaxesTagNS, local: string, namespaces = [""]) {
  return Object.values(tag.attributes).find(item => item.local === local && namespaces.includes(item.uri))?.value;
}

function verifyMainPart(bytes: Buffer, mainPart: string, contentType: string) {
  let declarations = 0;
  xml(bytes, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== contentTypeNamespace || tag.local !== "Types")) throw new Error("Invalid content types.");
    if (depth !== 2 || tag.uri !== contentTypeNamespace || tag.local !== "Override" || attribute(tag, "PartName") !== `/${mainPart}`) return;
    if (attribute(tag, "ContentType") !== contentType) throw new Error("Office package has the wrong format.");
    declarations++;
  } });
  if (declarations !== 1) throw new Error("Expected one Office main part declaration.");
}

function slideParts(presentation: Buffer, relationships: Buffer) {
  const ids: string[] = [];
  xml(presentation, { open(tag, depth) {
    if (depth === 1 && (!presentationNamespaces.has(tag.uri) || tag.local !== "presentation")) throw new Error("Invalid presentation.");
    if (!presentationNamespaces.has(tag.uri) || tag.local !== "sldId") return;
    const id = attribute(tag, "id", documentRelationships);
    if (!id || ids.includes(id)) throw new Error("Invalid slide reference.");
    ids.push(id);
    if (ids.length > MAX_SLIDES) throw new OfficeDocumentLimitError();
  } });
  const targets = new Map<string, string>();
  xml(relationships, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== relationshipNamespace || tag.local !== "Relationships")) throw new Error("Invalid relationships.");
    if (depth !== 2 || tag.uri !== relationshipNamespace || tag.local !== "Relationship") return;
    const id = attribute(tag, "Id");
    if (!id || !ids.includes(id)) return;
    const type = attribute(tag, "Type");
    const mode = attribute(tag, "TargetMode");
    const target = /^(?:\/ppt\/)?(slides\/slide[1-9]\d*\.xml)$/.exec(attribute(tag, "Target") || "")?.[1];
    if (!target || (mode && mode !== "Internal") || !documentRelationships.some(uri => type === `${uri}/slide`) || targets.has(id)) {
      throw new Error("Invalid slide target.");
    }
    targets.set(id, `ppt/${target}`);
  } });
  const ordered = ids.map(id => targets.get(id));
  if (ordered.some(target => !target) || new Set(ordered).size !== ordered.length) throw new Error("Slide targets are missing or ambiguous.");
  return ordered as string[];
}

function slideImageRelationshipIds(bytes: Buffer) {
  const ids: string[] = [];
  xml(bytes, { open(tag, depth) {
    if (depth === 1 && (!presentationNamespaces.has(tag.uri) || tag.local !== "sld")) throw new Error("Office slide has the wrong root.");
    if (tag.local !== "blip" || !drawingNamespaces.has(tag.uri)) return;
    const id = attribute(tag, "embed", documentRelationships);
    if (id) ids.push(id);
  } });
  return ids;
}

function imageRelationshipTargets(bytes: Buffer, slidePart: string) {
  const targets = new Map<string, string>();
  xml(bytes, { open(tag, depth) {
    if (depth === 1 && (tag.uri !== relationshipNamespace || tag.local !== "Relationships")) throw new Error("Invalid image relationships.");
    if (depth !== 2 || tag.uri !== relationshipNamespace || tag.local !== "Relationship") return;
    const id = attribute(tag, "Id");
    if (!id) throw new Error("Invalid image relationship ID.");
    if (targets.has(id)) throw new Error("Duplicate image relationship ID.");
    if (!documentRelationships.some(uri => attribute(tag, "Type") === `${uri}/image`)) return;
    const mode = attribute(tag, "TargetMode");
    const target = attribute(tag, "Target");
    if (mode && mode !== "Internal") return;
    if (!target || target.includes("\\") || target.includes("?") || target.includes("#") || /^[a-z]+:/i.test(target)) return;
    const packagePath = normalize(target.startsWith("/") ? target.slice(1) : join(dirname(slidePart), target)).split(sep).join("/");
    const mediaName = packagePath.startsWith("ppt/media/") ? packagePath.slice("ppt/media/".length) : "";
    if (!mediaName || mediaName.includes("/") || !/^[A-Za-z0-9_.-]{1,120}$/.test(mediaName)) return;
    targets.set(id, packagePath);
  } });
  return targets;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  let cursor = 2;
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (cursor + 9 < bytes.length && cursor < 1024 * 1024) {
    if (bytes[cursor] !== 0xff) { cursor++; continue; }
    while (bytes[cursor] === 0xff) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (cursor + 2 > bytes.length) return undefined;
    const segmentLength = bytes.readUInt16BE(cursor);
    if (segmentLength < 2 || cursor + segmentLength > bytes.length) return undefined;
    if (frameMarkers.has(marker) && segmentLength >= 7) return { height: bytes.readUInt16BE(cursor + 3), width: bytes.readUInt16BE(cursor + 5) };
    cursor += segmentLength;
  }
  return undefined;
}

function imageMime(bytes: Buffer): OfficeImageCandidate["mimeType"] | undefined {
  let mimeType: OfficeImageCandidate["mimeType"] | undefined;
  let dimensions: { width: number; height: number } | undefined;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = "image/png";
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    mimeType = "image/jpeg";
    dimensions = jpegDimensions(bytes);
  }
  if (!mimeType || !dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 12_000 || dimensions.height > 12_000 || dimensions.width * dimensions.height > 40_000_000) return undefined;
  return mimeType;
}

function textCollector() {
  const chunks: string[] = [];
  let length = 0;
  return {
    append(value: string) {
      if (length + value.length > MAX_IMPORT_TEXT_LENGTH) throw new OfficeDocumentLimitError();
      if (value) chunks.push(value);
      length += value.length;
    },
    value: () => chunks.join(""),
  };
}

function extractParagraphs(bytes: Buffer, format: "docx" | "pptx", append: (text: string) => void) {
  const root = format === "docx" ? { namespaces: wordNamespaces, name: "document" } : { namespaces: presentationNamespaces, name: "sld" };
  const namespaces = format === "docx" ? wordNamespaces : drawingNamespaces;
  let paragraphDepth = 0;
  let textDepth = 0;
  let paragraphHasText = false;
  xml(bytes, {
    open(tag, depth) {
      if (depth === 1 && (!root.namespaces.has(tag.uri) || tag.local !== root.name)) throw new Error("Office text part has the wrong root.");
      if (!namespaces.has(tag.uri)) return;
      if (tag.local === "p" && !paragraphDepth) { paragraphDepth = depth; paragraphHasText = false; }
      if (!paragraphDepth) return;
      if (tag.local === "t") textDepth = depth;
      if (tag.local === "tab") append(" ");
      if (tag.local === "br" || tag.local === "cr") append("\n");
    },
    close(_tag, depth) {
      if (depth === textDepth) textDepth = 0;
      if (depth === paragraphDepth) {
        if (paragraphHasText) append("\n");
        paragraphDepth = 0;
      }
    },
    text(value) { if (textDepth) { append(value); paragraphHasText ||= Boolean(value.trim()); } },
  });
}

function extractSlideTextBlocks(bytes: Buffer): string[] {
  const blocks: string[] = [];
  let shapeDepth = 0;
  let paragraphDepth = 0;
  let textDepth = 0;
  let currentShape: string[] = [];
  let currentParagraph = "";
  xml(bytes, {
    open(tag, depth) {
      if (depth === 1 && (!presentationNamespaces.has(tag.uri) || tag.local !== "sld")) throw new Error("Office slide has the wrong root.");
      if (presentationNamespaces.has(tag.uri) && tag.local === "sp") { shapeDepth = depth; currentShape = []; }
      if (!shapeDepth || !drawingNamespaces.has(tag.uri)) return;
      if (tag.local === "p" && !paragraphDepth) { paragraphDepth = depth; currentParagraph = ""; }
      if (tag.local === "t") textDepth = depth;
    },
    close(_tag, depth) {
      if (depth === textDepth) textDepth = 0;
      if (depth === paragraphDepth) {
        const value = currentParagraph.trim();
        if (value) currentShape.push(value);
        paragraphDepth = 0;
      }
      if (depth === shapeDepth) {
        const value = currentShape.join("\n").trim();
        if (value) blocks.push(value);
        shapeDepth = 0;
      }
    },
    text(value) { if (textDepth) currentParagraph += value; },
  });
  return blocks;
}

export async function extractOfficeRecipeSource(bytes: Buffer, format: "docx" | "pptx", includeImages = true): Promise<OfficeRecipeSource> {
  const zip = await fromBufferPromise(bytes, { strictFileNames: true, validateEntrySizes: true });
  try {
    if (zip.entryCount > MAX_ZIP_ENTRIES) throw new OfficeDocumentLimitError();
    const entries = new Map<string, Entry>();
    const names = new Set<string>();
    let totalSize = 0;
    for await (const entry of zip.eachEntry()) {
      totalSize += entry.uncompressedSize;
      if (totalSize > MAX_ARCHIVE_EXPANSION) throw new OfficeDocumentLimitError();
      const name = entry.fileName.toLowerCase();
      if (names.has(name) || entry.isEncrypted() || /(?:^|\/)vbaproject\.bin$/i.test(name)) throw new Error("Unsupported or ambiguous Office ZIP package.");
      names.add(name);
      entries.set(entry.fileName, entry);
    }

    let xmlBytes = 0;
    const read = async (name: string) => {
      const entry = entries.get(name);
      if (!entry) throw new Error("Required Office XML part is missing.");
      if (entry.uncompressedSize > MAX_XML_PART_BYTES || xmlBytes + entry.uncompressedSize > MAX_XML_TOTAL_BYTES) throw new OfficeDocumentLimitError();
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      let checksum = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_XML_PART_BYTES || xmlBytes + size > MAX_XML_TOTAL_BYTES) throw new OfficeDocumentLimitError();
        checksum = crc32(chunk, checksum);
        chunks.push(chunk);
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error("Office XML part did not pass integrity checks.");
      xmlBytes += size;
      return Buffer.concat(chunks, size);
    };
    const readOptional = async (name: string) => entries.has(name) ? read(name) : undefined;
    let mediaBytes = 0;
    let mediaEntries = 0;
    const mediaCache = new Map<string, { bytes: Buffer; mimeType?: OfficeImageCandidate["mimeType"] }>();
    const readMedia = async (name: string) => {
      const cached = mediaCache.get(name);
      if (cached) return cached;
      const entry = entries.get(name);
      if (!entry) throw new Error("Referenced Office image is missing.");
      if (++mediaEntries > MAX_PPTX_MEDIA_OBJECTS || entry.uncompressedSize > MAX_PPTX_MEDIA_OBJECT_BYTES || mediaBytes + entry.uncompressedSize > MAX_PPTX_MEDIA_BYTES) throw new OfficeDocumentLimitError();
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let size = 0;
      let checksum = 0;
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > MAX_PPTX_MEDIA_OBJECT_BYTES || mediaBytes + size > MAX_PPTX_MEDIA_BYTES) throw new OfficeDocumentLimitError();
        checksum = crc32(chunk, checksum);
        chunks.push(chunk);
      }
      if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error("Office image did not pass integrity checks.");
      mediaBytes += size;
      const value = { bytes: Buffer.concat(chunks, size), mimeType: imageMime(Buffer.concat(chunks, size)) };
      mediaCache.set(name, value);
      return value;
    };

    const contentTypes = await read("[Content_Types].xml");
    const slides: OfficeSlideSource[] = [];
    const imagesByHash = new Map<string, OfficeImageCandidate>();
    let unsupportedImageCount = 0;
    if (format === "docx") {
      const mainPart = "word/document.xml";
      verifyMainPart(contentTypes, mainPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
      const collector = textCollector();
      extractParagraphs(await read(mainPart), format, collector.append);
      const text = collector.value();
      slides.push({ slideNumber: 1, text, textBlocks: [text], images: [] });
    } else {
      const mainPart = "ppt/presentation.xml";
      verifyMainPart(contentTypes, mainPart, "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
      const parts = slideParts(await read(mainPart), await read("ppt/_rels/presentation.xml.rels"));
      let imageReferences = 0;
      for (const [slideIndex, part] of parts.entries()) {
        const collector = textCollector();
        const slideBytes = await read(part);
        const textBlocks = extractSlideTextBlocks(slideBytes);
        if (textBlocks.length) for (const block of textBlocks) collector.append(`${block}\n`);
        else extractParagraphs(slideBytes, format, collector.append);
        const slideImages: OfficeImageCandidate[] = [];
        if (includeImages) {
          const relationships = await readOptional(join(dirname(part), "_rels", `${basename(part)}.rels`).split(sep).join("/"));
          if (relationships) {
            const targets = imageRelationshipTargets(relationships, part);
            for (const [objectIndex, relationshipId] of slideImageRelationshipIds(slideBytes).entries()) {
              if (++imageReferences > MAX_PPTX_MEDIA_OBJECTS) throw new OfficeDocumentLimitError();
              const target = targets.get(relationshipId);
              if (!target) { unsupportedImageCount++; continue; }
              const media = await readMedia(target);
              if (!media.mimeType) { unsupportedImageCount++; continue; }
              const sha256 = createHash("sha256").update(media.bytes).digest("hex");
              let candidate = imagesByHash.get(sha256);
              if (!candidate) {
                candidate = { id: sha256, mediaPartNames: [], mimeType: media.mimeType, byteLength: media.bytes.length, sha256,
                  dataUrl: `data:${media.mimeType};base64,${media.bytes.toString("base64")}`, references: [] };
                imagesByHash.set(sha256, candidate);
              }
              if (!candidate.mediaPartNames.includes(target)) candidate.mediaPartNames.push(target);
              candidate.references.push({ slideNumber: slideIndex + 1, objectIndex: objectIndex + 1, mediaPartName: target });
              slideImages.push(candidate);
            }
          }
        }
        slides.push({ slideNumber: slideIndex + 1, text: collector.value(), textBlocks, images: slideImages });
      }
    }
    const text = slides.map(slide => slide.text).filter(Boolean).join("\n");
    return { text, slides, images: [...imagesByHash.values()], unsupportedImageCount };
  } finally {
    zip.close();
  }
}

export async function extractOfficeRecipeText(bytes: Buffer, format: "docx" | "pptx"): Promise<string> {
  return (await extractOfficeRecipeSource(bytes, format, false)).text;
}
