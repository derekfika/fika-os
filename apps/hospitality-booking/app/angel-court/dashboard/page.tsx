import { redirect } from "next/navigation";

export default function AngelCourtDashboardPage() {
  redirect("/manage?site=angel-court");
}
