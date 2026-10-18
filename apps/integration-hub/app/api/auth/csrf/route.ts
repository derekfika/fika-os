import { NextResponse } from "next/server";
import { csrfCookieName, csrfCookieOptions, newCsrfToken } from "@/lib/csrf";
export async function GET() { const token = newCsrfToken(); const response = NextResponse.json({ csrfToken: token }); response.cookies.set(csrfCookieName(), token, csrfCookieOptions()); return response; }
