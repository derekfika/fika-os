import { NextRequest, NextResponse } from "next/server";
import { stagingDriveAclDiagnostic } from "@fika/server-shared/staging-drive";
import { requireRcoaHospitalityAdminForStagingDiagnostic, stagingDriveDiagnosticAvailable } from "@/lib/staging-drive-diagnostic-access";

const noStore = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: NextRequest) {
  // This diagnostic is deliberately unavailable outside the isolated staging project.
  if (!stagingDriveDiagnosticAvailable()) {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: noStore });
  }
  try {
    await requireRcoaHospitalityAdminForStagingDiagnostic(request.headers.get("cookie"));
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403) return NextResponse.json({ error: (error as Error).message }, { status, headers: noStore });
    return NextResponse.json({ error: "The existing Hospitality authorization check is unavailable." }, { status: 503, headers: noStore });
  }
  try {
    const diagnostic = await stagingDriveAclDiagnostic();
    return NextResponse.json(diagnostic, { headers: noStore });
  } catch {
    // Do not echo provider responses, tokens, configuration values, or credential parsing errors.
    return NextResponse.json({ error: "Staging identity or production-isolation verification failed; ACL details were withheld." }, { status: 503, headers: noStore });
  }
}
