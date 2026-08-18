import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const allowed = new Set(["GILROY-REGULAR.TTF", "GILROY-BLACK.TTF", "fika-logo-white.png"]);
export async function GET(_: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  if (!allowed.has(filename)) return new NextResponse("Not found", { status: 404 });
  const source = filename === "fika-logo-white.png" ? path.resolve(process.cwd(), "../../assets/logos", "fika_logo_white_png.png") : path.resolve(process.cwd(), "../../assets/fonts", filename);
  const contentType = filename.endsWith(".png") ? "image/png" : "font/ttf";
  return new NextResponse(await readFile(source), { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
}
