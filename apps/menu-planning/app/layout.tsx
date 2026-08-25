import "./styles.css";
import "./shell.css";
import "./planner-stage2.css";
import "./final-tightening.css";
export const metadata = { title: "FIKA OS · Menu Planning" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
