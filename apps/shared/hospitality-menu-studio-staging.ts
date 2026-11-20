export const studioReviewStaging = {
  projectId: "fika-os-dev",
  studioIdentity: {
    email: "fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com",
    subject: "115415878091159761145",
  },
  cpuOrigin: "https://cpu-staging.fikacatering.com",
  hubOrigin: "https://staging-os.fikacatering.com",
  intakePath: "/api/internal/studio-dish-review",
  maximumRequestBytes: 500_000,
} as const;

export const studioReviewAudience = studioReviewStaging.cpuOrigin + studioReviewStaging.intakePath;
export const studioPublicationAudience = studioReviewStaging.hubOrigin + "/api/hospitality-studio-publications";
