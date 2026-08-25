import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@hub/lib/api";
import * as XLSX from "xlsx";

type Category = "Salad 1" | "Salad 2" | "Salad 3" | "Salad 4" | "Salad 5" | "Salad 6" | "Cold protein" | "Soup" | "Hot meat" | "Hot veg / vegan" | "Extras / sides";
type Candidate = { id: string; title: string; day: string; sourceFile: string; sourceSheet: string; sourceRow: number; siteQuantities: Record<string, number>; quantityTotal: number; allergens: Record<string, string>; mayContainNotes: string; reviewState: "needs_review"; sourceEvidence: string[]; category?: Category };
const daySheets = new Set(["mon", "tue", "wed", "thurs", "thu", "fri"]);
function text(value: unknown) { return String(value ?? "").trim(); }
function titleCase(value: string) { return value.toLowerCase().replace(/\b[\p{L}\p{N}]/gu, (character) => character.toUpperCase()); }
function category(value: unknown): Category | undefined {
  const normal = text(value).toLowerCase().replace(/[\/_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^salad\s*[1-6]$/.test(normal)) return `Salad ${normal.slice(-1)}` as Category;
  if (normal === "cold protein") return "Cold protein";
  if (normal === "soup") return "Soup";
  if (normal === "hot meat") return "Hot meat";
  if (normal === "hot veg vegan" || normal === "hot veg / vegan") return "Hot veg / vegan";
  if (normal === "extras sides" || normal === "extras side") return "Extras / sides";
  return undefined;
}
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an XLSX workbook first." }, { status: 422 });
  try {
    const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", cellDates: false });
    const candidates: Candidate[] = [];
    for (const sheetName of workbook.SheetNames) {
      const lower = sheetName.toLowerCase();
      if (!daySheets.has(lower)) continue;
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
      const headers = (rows[1] || []).map(text);
      const categoryIndex = headers.findIndex((header) => /^(category|menu category|section|course)$/i.test(header));
      for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const title = titleCase(text(row[1] || row[0]));
        if (!title || /^total$/i.test(title)) continue;
        const siteQuantities: Record<string, number> = {};
        headers.forEach((header, index) => { const number = Number(row[index]); if (header && header.toLowerCase() !== "total" && Number.isFinite(number) && number > 0) siteQuantities[header] = number; });
        const rowCategory = categoryIndex >= 0 ? category(row[categoryIndex]) : category(row[0]);
        candidates.push({ id: `candidate:${file.name}:${sheetName}:${rowIndex + 1}`, title, day: lower, sourceFile: file.name, sourceSheet: sheetName, sourceRow: rowIndex + 1, siteQuantities, quantityTotal: Object.values(siteQuantities).reduce((sum, value) => sum + value, 0), allergens: {}, mayContainNotes: "", reviewState: "needs_review", ...(rowCategory ? { category: rowCategory } : {}), sourceEvidence: [file.name, `sheet:${sheetName}`, `row:${rowIndex + 1}`, ...workbook.SheetNames.filter((name) => name.toLowerCase().startsWith("fika"))] });
      }
    }
    return NextResponse.json({ sourceFile: file.name, candidates, sheets: workbook.SheetNames, allergenSheets: workbook.SheetNames.filter((name) => name.toLowerCase().startsWith("fika")) });
  } catch (error) { return errorResponse(error); }
}
