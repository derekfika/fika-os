import DevelopmentApp from "./DevelopmentApp";

export const metadata = { title: "Development · FIKA OS" };
// The page shell carries no data. All metadata is fetched client-side from /api/development, which is admission-gated server-side.
export default function DevelopmentPage() { return <DevelopmentApp />; }
