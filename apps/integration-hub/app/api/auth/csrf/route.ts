import { NextResponse } from "next/server";
import { csrfCookieOptions, newCsrfToken } from "@/lib/csrf";
import { csrfCookieName } from "@/lib/runtime-config";
export async function GET() { const token = newCsrfToken(); const response = NextResponse.json({ csrfToken: token }); response.cookies.set(csrfCookieName(), token, csrfCookieOptions()); return response; }
