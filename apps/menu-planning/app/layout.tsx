import "./styles.css";
export const metadata = { title: "FIKA OS · Menu Planning" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
