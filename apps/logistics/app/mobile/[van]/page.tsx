import { notFound } from "next/navigation";
import MobileWorkflow from "../MobileWorkflow";

export default async function FixedVanMobile({ params }: { params: Promise<{ van: string }> }) {
  const { van } = await params;
  if (van !== "van1" && van !== "van2") notFound();
  return <MobileWorkflow fixedVan={van === "van1" ? "Van 1" : "Van 2"} />;
}
