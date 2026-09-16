import type { ProjectedDay } from "../../lib/projection";

export function cpuReviewStatusLabel(day?: Pick<ProjectedDay, "cpuReview">) {
  return day?.cpuReview?.status === "signed"
    ? "Signed by CPU"
    : day?.cpuReview
      ? "Awaiting CPU sign-off"
      : "Pending CPU handoff";
}
