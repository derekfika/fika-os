import { redirect } from "next/navigation";

/**
 * Compatibility entry point for existing bookmarks. The MNK dashboard now
 * lives under the same site namespace as the booking portal.
 */
export default function Page() {
  redirect("/hospitality/manage");
}
