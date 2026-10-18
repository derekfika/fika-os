import HospitalityWorkspace from "../ui/HospitalityWorkspace";

export const dynamic = "force-dynamic";

export default function WorkspacePage() {
  return (
    <HospitalityWorkspace
      rcoaConfigured={Boolean(process.env.FIKA_RCOA_OPLOC_ID?.trim())}
      rcoaBookingSubmissionsEnabled={process.env.FIKA_RCOA_BOOKING_SUBMISSIONS_ENABLED === "true"}
    />
  );
}
