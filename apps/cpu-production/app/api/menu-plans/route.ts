import { NextRequest, NextResponse } from "next/server";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

export type DeliveredMenuEntry = {
  id: string;
  title: string;
  portions: number;
  allergens: Record<string, string>;
  mayContainNotes?: string;
  sourceEvidence?: string[];
};
export type DeliveredMenuPlan = {
  id: string;
  name: string;
  weekStarting: string;
  weeks: Array<{ weekStarting: string; days: Array<{ date: string; day: string; entries: DeliveredMenuEntry[] }> }>;
  sourceImports?: Array<{ fileName: string; importedAt: string; candidateCount: number; sheets: string[] }>;
  updatedAt: string;
};

function root() {
  let current = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    if (existsSync(path.join(current, "local-data", "menu-planning"))) return current;
    current = path.dirname(current);
  }
  return path.resolve(process.cwd(), "..", "..");
}
const filePath = () => path.join(root(), "local-data", "menu-planning", "delivered-in-menus.json");
async function readPlans(): Promise<DeliveredMenuPlan[]> {
  try { return JSON.parse(await fs.readFile(filePath(), "utf8")) as DeliveredMenuPlan[]; } catch { return []; }
}
export async function GET() { return NextResponse.json({ plans: await readPlans() }, { headers: { "cache-control": "no-store" } }); }
export async function POST(request: NextRequest) {
  const body = await request.json() as Partial<DeliveredMenuPlan>;
  if (!body.name?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body.weekStarting || "") || !Array.isArray(body.weeks)) {
    return NextResponse.json({ error: "Name, week starting date and six-week plan are required." }, { status: 422 });
  }
  const weekStarting = body.weekStarting as string;
  const now = new Date().toISOString();
  const plan: DeliveredMenuPlan = { id: body.id || `delivered-menu:${weekStarting}`, name: body.name.trim(), weekStarting, weeks: body.weeks as DeliveredMenuPlan["weeks"], sourceImports: body.sourceImports || [], updatedAt: now };
  const next = [...(await readPlans()).filter((item) => item.id !== plan.id), plan];
  await fs.mkdir(path.dirname(filePath()), { recursive: true });
  await fs.writeFile(filePath(), JSON.stringify(next, null, 2), "utf8");
  return NextResponse.json({ plan });
}
