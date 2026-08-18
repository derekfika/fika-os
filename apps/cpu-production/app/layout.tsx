import type { Metadata } from "next";
import "./fika-tokens.css";
import "./styles.css";
import "./brand-overrides.css";
export const metadata: Metadata = { title: "CPU Production · FIKA OS", description: "Operational production workspace" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
