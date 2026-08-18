import { NextResponse } from "next/server";
import { publicationBlockers } from "@/lib/domain";
import { getMenuSnapshot, runMenuCommand } from "@/lib/store";
export async function GET() { const snapshot = getMenuSnapshot(); return NextResponse.json({ snapshot, blockers: publicationBlockers(snapshot) }); }
export async function POST(request: Request) { try { const command = await request.json(); if (command.action === "inspect-workbook") return NextResponse.json({ message: "Use the workbook inspection endpoint with the file body." }); const snapshot = runMenuCommand(command); return NextResponse.json({ snapshot, blockers: publicationBlockers(snapshot) }); } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); } }
