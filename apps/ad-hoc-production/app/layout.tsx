import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./fika-tokens.css";
import "./styles.css";
import { AppFrame } from "./frame";

export const metadata: Metadata = { title: "Ad-Hoc Production · FIKA OS" };

export default function Layout({ children }: { children: ReactNode }) {
  const environment = (process.env.FIKA_RUNTIME_MODE || "local").toUpperCase();
  return <html lang="en"><body><AppFrame environment={environment}>{children}</AppFrame></body></html>;
}
