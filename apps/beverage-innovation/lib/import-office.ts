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
const contentTypeNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const relationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";
const wordNamespaces = new Set(["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]);
const drawingNamespaces = new Set(["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"]);
const presentationNamespaces = new Set(["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"]);
const documentRelationships = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];

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

export async function extractOfficeRecipeText(bytes: Buffer, format: "docx" | "pptx"): Promise<string> {
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

    const contentTypes = await read("[Content_Types].xml");
    const collector = textCollector();
    if (format === "docx") {
      const mainPart = "word/document.xml";
      verifyMainPart(contentTypes, mainPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
      extractParagraphs(await read(mainPart), format, collector.append);
    } else {
      const mainPart = "ppt/presentation.xml";
      verifyMainPart(contentTypes, mainPart, "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
      for (const part of slideParts(await read(mainPart), await read("ppt/_rels/presentation.xml.rels"))) {
        extractParagraphs(await read(part), format, collector.append);
      }
    }
    return collector.value();
  } finally {
    zip.close();
  }
}
