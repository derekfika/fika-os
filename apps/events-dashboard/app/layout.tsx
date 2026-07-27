import type {Metadata,Viewport} from "next";import "./globals.css";
export const metadata:Metadata={title:"FIKA OS Events",description:"Company-wide Event planning and readiness",manifest:"/manifest.webmanifest"};export const viewport:Viewport={themeColor:"#4f34c7"};export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
