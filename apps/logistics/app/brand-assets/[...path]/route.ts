import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const types: Record<string, string> = { ".otf": "font/otf", ".ttf": "font/ttf", ".png": "image/png" };

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const relative = segments.join("/");
  if (!/^(fonts|logos)\/[A-Za-z0-9_.-]+\.(otf|ttf|png)$/i.test(relative)) return new NextResponse("Not found", { status: 404 });
  const root = path.resolve(process.cwd(), "../../assets");
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return new NextResponse("Not found", { status: 404 });
  try {
    const body = await readFile(file);
    return new NextResponse(body, { headers: { "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream" } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
