import { redirect } from "next/navigation";

/** Role-based route for the production-chef view. */
export default function ProductionChefView() {
  redirect("/?view=production");
}
