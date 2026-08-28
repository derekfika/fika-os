import { AdmissionError } from "../../components/AdmissionError";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  return <AdmissionError application="Menu Planning" code={String(query.code || "APP_UNAVAILABLE")} message={String(query.message || "Menu Planning is temporarily unavailable.")} supportingText={query.supportingText ? String(query.supportingText) : undefined} requestId={query.requestId ? String(query.requestId) : undefined} />;
}
