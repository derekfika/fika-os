import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "FIKA OS · Logistics", description: "Plan and dispatch daily deliveries." };

export default function Layout({children}:{children:ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
