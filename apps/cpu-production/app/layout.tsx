import type { Metadata, Viewport } from "next";
import { CPU_PWA_THEME_COLOR } from "../lib/cpu-pwa";
import "./fika-tokens.css";
import "./styles.css";
import "./brand-overrides.css";
import "./cpu-tablet.css";
export const metadata: Metadata = {
  title: "CPU Production · FIKA OS",
  description: "Operational production workspace",
  applicationName: "FIKA CPU Production",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FIKA CPU", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/cpu-apple-180.png", sizes: "180x180", type: "image/png" }] },
  other: { "mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: CPU_PWA_THEME_COLOR };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
