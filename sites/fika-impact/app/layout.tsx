import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const gilroy = localFont({
  variable: "--font-gilroy",
  display: "swap",
  src: [
    { path: "../public/fonts/Gilroy-Regular.ttf", weight: "400", style: "normal" },
    { path: "../public/fonts/Gilroy-Medium.ttf", weight: "500", style: "normal" },
    { path: "../public/fonts/Gilroy-Bold.ttf", weight: "700", style: "normal" },
    { path: "../public/fonts/Gilroy-Black.ttf", weight: "900", style: "normal" },
  ],
});

const vim = localFont({
  variable: "--font-vim",
  display: "swap",
  src: [{ path: "../public/fonts/Vim-Heavy.otf", weight: "900", style: "normal" }],
});

export const metadata: Metadata = {
  title: "FIKA Impact — One Liverpool Street",
  description: "Live environmental impact from the FIKA coffee bar at One Liverpool Street.",
  icons: { icon: "./fika-logo.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${gilroy.variable} ${vim.variable}`}>
      <body>{children}</body>
    </html>
  );
}
