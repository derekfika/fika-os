import { forwardBuffetMenu } from "@/lib/buffet-menu-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() { return forwardBuffetMenu(); }
