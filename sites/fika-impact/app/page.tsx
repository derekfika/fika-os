import type { Metadata } from "next";
import FikaImpact from "./components/FikaImpact";

export const metadata: Metadata = {
  title: "FIKA Impact — One Liverpool Street",
  description: "Making the impact of every coffee visible.",
};

export default function Home() {
  return <FikaImpact />;
}
