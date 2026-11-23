import RcoaInvoiceReport from "../../ui/RcoaInvoiceReport";

export const dynamic = "force-dynamic";

export default async function RcoaInvoiceReportsPage({ searchParams }: { searchParams: Promise<{ oploc?: string }> }) {
  const { oploc } = await searchParams;
  return <RcoaInvoiceReport oploc={typeof oploc === "string" ? oploc : ""} />;
}
