import { redirect } from "next/navigation";

export default function CfcDashboardPage() {
  redirect("/hospitality/manage?site=cfc");
}
