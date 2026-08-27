import { redirect } from "next/navigation";

export default function MnkDashboardPage() {
  redirect("/manage?site=mnk");
}
