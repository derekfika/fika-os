import { redirect } from "next/navigation";

export default async function HospitalityManagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["oploc", "site", "surface"]) {
    const value = query[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  redirect(`/workspace${params.toString() ? `?${params.toString()}` : ""}`);
}
