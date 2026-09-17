import "./globals.css";
import "./hospitality-site-theme.css";
export const metadata = { title: "FIKA OS · Hospitality Booking", description: "FIKA OS Hospitality Booking" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
