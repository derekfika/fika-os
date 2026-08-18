import { redirect } from "next/navigation";

/**
 * The production workspace is now queue-first. Keep the old calendar URL
 * resolvable for bookmarks and generated Next.js route types.
 */
export default function ProductionCalendarRedirect() {
  redirect("/production");
}
