import { redirect } from "next/navigation";

/** Role-based route; /craig remains as a compatibility alias. */
export default function HospitalityChefView() {
  redirect("/?view=hospitality");
}
