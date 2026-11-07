import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { beveragePreviewCookieName, checkBeveragePreviewAccess } from "@/lib/preview-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BeveragePreviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.FIKA_BEVERAGE_PREVIEW_ONLY !== "1") return children;
  const cookieStore = await cookies();
  const access = await checkBeveragePreviewAccess(process.env, cookieStore.get(beveragePreviewCookieName())?.value);
  if (access === "missing" || access === "invalid") {
    const hub = process.env.FIKA_HUB_BASE_URL;
    if (!hub) throw new Error("Beverage preview sign-in is not configured.");
    const target = new URL("/", hub);
    target.searchParams.set("launchError", access === "missing" ? "FIKA_SESSION_MISSING" : "FIKA_SESSION_INVALID");
    target.searchParams.set("appId", "beverage-innovation");
    redirect(target.href);
  }
  if (access !== "allow") notFound();
  return children;
}
