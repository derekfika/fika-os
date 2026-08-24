import type { ReactNode } from "react";
import "./fika-tokens.css";
import "./styles.css";
import "./branding.css";
import "./allergens/styles.css";
export default function Layout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
