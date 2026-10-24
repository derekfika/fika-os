import type { AdHocAllergenChecker } from "../../shared/ad-hoc-production-contract";

/** Google Drive / Docs hosts the signed PDF may be served from. Anything else is never rendered as a link. */
const SAFE_LINK_HOSTS = new Set(["drive.google.com", "docs.google.com"]);
export function safeDriveLink(url: string | undefined) {
  if (!url) return undefined;
  try { const parsed = new URL(url); return parsed.protocol === "https:" && SAFE_LINK_HOSTS.has(parsed.hostname) ? parsed.toString() : undefined; } catch { return undefined; }
}

export type AllergenCheckerView = { tone: "pending" | "signed" | "withdrawn"; label: string; detail?: string; link?: string };

/** Text-first presentation of CPU's allergen checker state for the requester. A link exists only while the signed PDF is current. */
export function allergenCheckerView(checker: AdHocAllergenChecker | undefined, formatDate: (iso: string) => string = iso => iso): AllergenCheckerView {
  if (!checker || checker.state === "not_signed") return { tone: "pending", label: "Not yet signed", detail: "CPU's chefs sign the allergen checker once the order is reviewed. The PDF link appears here when it is signed." };
  const who = checker.signers?.length ? ` by ${checker.signers.map(signer => signer.name).join(" and ")}` : "";
  if (checker.state === "withdrawn") return { tone: "withdrawn", label: "Signed checker withdrawn", detail: `${checker.reason || "The signed allergen checker is no longer valid."} CPU will sign it again after review.` };
  const link = safeDriveLink(checker.driveUrl);
  const when = checker.signedAt ? ` on ${formatDate(checker.signedAt)}` : "";
  return link
    ? { tone: "signed", label: `Signed${who}${when}`, detail: checker.fileName, link }
    : { tone: "signed", label: `Signed${who}${when}`, detail: "The PDF link is not available to show here. Ask CPU for the file." };
}
