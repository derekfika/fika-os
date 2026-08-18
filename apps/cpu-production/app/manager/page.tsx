import { redirect } from "next/navigation";

export default function ManagerProductionView() {
  redirect("/?view=site_manager");
}
