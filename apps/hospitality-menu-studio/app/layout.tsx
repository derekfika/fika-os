import type { ReactNode } from "react";
import "../../../shared/fika/tokens.css";
import "../../../shared/fika/component-atlas.css";
import "./styles.css";

export const metadata = { title: "Hospitality Menu Studio · FIKA OS" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body className="fika-ui">{children}</body></html>;
}
