import { NextResponse } from "next/server";
import { CSRF_COOKIE, csrfCookieOptions, newCsrfToken } from "@/lib/csrf";
export async function GET() { const token = newCsrfToken(); const response = NextResponse.json({ csrfToken: token }); response.cookies.set(CSRF_COOKIE, token, csrfCookieOptions()); return response; }
