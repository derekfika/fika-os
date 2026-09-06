import "./styles.css";
import "../../../shared/fika/tokens.css";
import "./shell.css";
import "./planner-stage2.css";
import "./final-tightening.css";
import "./import-menu-week.css";
import "./visual-system.css";
export const metadata = { title: "FIKA OS · Menu Planning" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
