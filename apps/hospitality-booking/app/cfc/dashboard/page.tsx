import { redirect } from "next/navigation";

export default function CfcDashboardPage() {
  redirect("/manage?site=cfc");
}
