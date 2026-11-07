import { crc32, deflateRawSync } from "node:zlib";
import type { RecipeDocumentUpload } from "../../lib/import-document";

const first = [
  "Name: Fixture Citrus Cooler", "Type: Mocktail", "Ingredient: 12.5 ml lime juice", "Ingredient: mint leaves",
  "Method: Stir gently.", "Glassware: Highball", "Allergens: None", "Cost: £4",
];
const second = [
  "Drink: Fixture Honey Fizz", "Type: Cold drink", "Ingredient: 2 dashes bitters",
  "Method: Serve over ice.", "Equipment: Spoon", "Garnish: Lime wheel",
];
const contentTypes = "http://schemas.openxmlformats.org/package/2006/content-types";
const packageRelationships = "http://schemas.openxmlformats.org/package/2006/relationships";
const officeRelationships = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const presentation = "http://schemas.openxmlformats.org/presentationml/2006/main";
const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
const xmlText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Deterministic ZIP fixture builder. Use real deflate streams and CRCs.
export function zipFixture(files: Array<[string, string]>) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const filename = Buffer.from(name);
    const bytes = Buffer.from(text);
    const packed = deflateRawSync(bytes);
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(bytes.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, filename, packed);
    central.push(entry, filename);
    offset += header.length + filename.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function docxFixture(options: { lines?: string[]; prefix?: string; extra?: Array<[string, string]>; mainType?: string } = {}): RecipeDocumentUpload {
  const lines = options.lines || [...first, ...second];
  const mainType = options.mainType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
  const paragraphs = lines.map(line => `<w:p><w:r><w:t>${xmlText(line)}</w:t></w:r></w:p>`).join("");
  return {
    fileName: "fictional-recipes.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: zipFixture([
      ["[Content_Types].xml", `<Types xmlns="${contentTypes}"><Override PartName="/word/document.xml" ContentType="${mainType}"/></Types>`],
      ["word/document.xml", `${options.prefix || ""}<w:document xmlns:w="${word}"><w:body>${paragraphs}</w:body></w:document>`],
      ...(options.extra || []),
    ]),
  };
}

export function pptxFixture(external = false): RecipeDocumentUpload {
  const slide = (lines: string[]) => `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}"><p:cSld><p:spTree><p:sp><p:txBody>${lines.map(line => `<a:p><a:r><a:t>${xmlText(line)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  return {
    fileName: "fictional-recipes.pptx", mediaType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    bytes: zipFixture([
      ["[Content_Types].xml", `<Types xmlns="${contentTypes}"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`],
      ["ppt/slides/slide1.xml", slide(second)],
      ["ppt/slides/slide2.xml", slide(first)],
      ["ppt/presentation.xml", `<p:presentation xmlns:p="${presentation}" xmlns:r="${officeRelationships}"><p:sldIdLst><p:sldId id="257" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`],
      ["ppt/_rels/presentation.xml.rels", `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${officeRelationships}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${officeRelationships}/slide" ${external ? 'Target="https://example.test/slide.xml" TargetMode="External"' : 'Target="slides/slide2.xml"'}/></Relationships>`],
    ]),
  };
}

export function pdfFixture(pages = [first.map(value => value.replace("£", "GBP ")), second]): RecipeDocumentUpload {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of pages.entries()) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    const commands = lines.map(line => `(${line.replace(/[\\()]/g, "\\$&")}) Tj\n0 -18 Td`).join("\n");
    const stream = `BT\n/F1 12 Tf\n60 740 Td\n${commands}\nET\n`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(body);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { fileName: "fictional-recipes.pdf", mediaType: "application/pdf", bytes: Buffer.from(body) };
}

export function documentRequest(action: "preview" | "commit", upload: RecipeDocumentUpload, review?: unknown, headers?: HeadersInit) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(upload.bytes)], { type: upload.mediaType }), upload.fileName);
  if (review !== undefined) form.set("review", JSON.stringify(review));
  return new Request(`http://localhost:13617/api/imports/documents/${action}`, { method: "POST", body: form, headers });
}
