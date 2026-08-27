import type { Metadata, Viewport } from "next";
import "./styles/fika-tokens.css";
import "./globals.css";

export const metadata: Metadata = { title: "FIKA OS", description: "Local controlled ingestion and canonical review" };
export const viewport: Viewport = { themeColor: "#4F34C7", colorScheme: "light" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
