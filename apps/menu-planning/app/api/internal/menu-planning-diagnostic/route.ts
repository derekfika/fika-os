import { NextRequest, NextResponse } from "next/server";
import { Firestore } from "@google-cloud/firestore";
import { getMenuPlanningOperationalStore, MenuPlanningFirestoreRepository } from "@/lib/operational-store";
import { listWeeks } from "@/lib/rolling-menu";
import { requirePublicationActor, resolveMenuActor } from "@/lib/auth";

/** Temporary server-only, read-only staging diagnostic. Remove after runtime diagnosis. */
export async function GET(request: NextRequest) {
  try {
    // This secret is runtime-only in App Hosting; dynamic lookup prevents the
    // build from treating its unavailable build-time value as permanently empty.
    const expectedToken = process.env["FIKA_INTERNAL_API_TOKEN"];
    const suppliedToken = request.headers.get("x-fika-internal-token");
    if (!expectedToken || suppliedToken !== expectedToken) requirePublicationActor(await resolveMenuActor(request));

    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
    const database = new Firestore({ projectId: projectId || undefined });
    const direct = await database.collection("fikaMenuPlanningWeeks").get();
    const repository = new MenuPlanningFirestoreRepository(database);
    const repositoryState = await repository.readRollingState();
    const store = getMenuPlanningOperationalStore();
    const applicationWeeks = await listWeeks();
    const settings = (database as unknown as { _settings?: { databaseId?: string } })._settings;
    return NextResponse.json({
      FIKA_RUNTIME_MODE: process.env.FIKA_RUNTIME_MODE || null,
      FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || null,
      GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || null,
      FIRESTORE_EMULATOR_HOST: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
      selectedOperationalAdapter: store.constructor.name === "FirestoreOperationalStore" ? "firestore" : "sqlite",
      resolvedFirestoreProjectId: projectId || null,
      resolvedFirestoreDatabaseId: settings?.databaseId || "(default)",
      directWeeks: { count: direct.size, firstIds: direct.docs.slice(0, 3).map(doc => doc.id) },
      repositoryWeeks: repositoryState.weeks.length,
      applicationWeeks: applicationWeeks.length,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 403 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Diagnostic failed." }, { status, headers: { "cache-control": "no-store" } });
  }
}
