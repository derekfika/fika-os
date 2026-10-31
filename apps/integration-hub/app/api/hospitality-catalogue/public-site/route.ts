import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { db } from "@/lib/firebase-admin";
import { authoriseCatalogueRead } from "@/lib/hospitality-catalogue-read-auth";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { PUBLIC_HOSPITALITY_SITE_KEYS, resolvePublicHospitalityOploc } from "@/lib/hospitality-public-site";

const SITE_KEYS = new Set<string>(PUBLIC_HOSPITALITY_SITE_KEYS);

/** Resolve only the stable portal key through an exact, confirmed Hub location mapping. */
export async function GET(request: NextRequest) {
  try {
    await authoriseCatalogueRead(request);
    const site = new URL(request.url).searchParams.get("site")?.trim().toLowerCase() || "";
    if (!SITE_KEYS.has(site)) return NextResponse.json({ error: { message: "A supported public Hospitality site key is required." } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const mappings = await db.collection("integrationHubSourceMappings").where("sourceIdentifier", "==", site).limit(2).get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality.catalogue.public-site", source: "FIRESTORE", dataset: "integrationHubSourceMappings", documents: mappings.size, estimatedBillableReads: mappings.size, firestoreReadKind: "query" });
    const confirmed = mappings.docs.map(document => document.data());
    const targetId = confirmed.length === 1 ? String(confirmed[0]?.targetCanonicalId || confirmed[0]?.oplocId || "") : "";
    if (!targetId) return NextResponse.json({ error: { message: "This Hospitality site has no unique confirmed Hub location mapping." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const target = await db.collection("integrationHubCanonical").where("canonicalId", "==", targetId).where("entityType", "==", "OPLOC").limit(2).get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality.catalogue.public-site-oploc", source: "FIRESTORE", dataset: "integrationHubCanonical", documents: target.size, estimatedBillableReads: target.size, firestoreReadKind: "query" });
    const oplocId = resolvePublicHospitalityOploc(site, confirmed, target.docs.map(document => document.data() as import("@/lib/types").CanonicalRecord));
    if (!oplocId) return NextResponse.json({ error: { message: "This Hospitality site destination is not a unique active canonical OPLOC." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ oplocId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
