import { notFound } from "next/navigation";
import type { Metadata, Viewport } from "next";
import MobilePinGate from "../MobilePinGate";
import PwaRegister from "../PwaRegister";

// viewport-fit=cover lets the driver shell use the iPhone safe-area insets; the header and bottom nav pad for them.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#4f34c7" };

function vanNumber(van: string) {
  return van === "van2" ? "2" : van === "van1" ? "1" : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ van: string }> }): Promise<Metadata> {
  const number = vanNumber((await params).van);
  if (!number) return {};
  return {
    title: `FIKA Van ${number} Driver`,
    manifest: `/pwa/manifest-van${number}.webmanifest`,
    appleWebApp: { capable: true, title: `Van ${number}`, statusBarStyle: "black-translucent" },
    icons: { apple: `/pwa/van${number}-apple-touch-180.png` },
  };
}

export default async function FixedVanMobile({ params }: { params: Promise<{ van: string }> }) {
  const { van } = await params;
  if (van !== "van1" && van !== "van2") notFound();
  return (
    <>
      <PwaRegister />
      <MobilePinGate vehicle={van === "van1" ? "Van 1" : "Van 2"} />
    </>
  );
}
