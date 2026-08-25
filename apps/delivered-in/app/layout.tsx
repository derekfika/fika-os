import "./styles.css";
import "./delivered-in-polish.css";
import "./presentation-overrides.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "FIKA OS · Delivered-In", description: "Published Delivered-In menus and allergen information." };

export default function Layout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
