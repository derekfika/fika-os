import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FIKA Impact",
  description: "Live environmental impact at One Liverpool Street.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
