import WeekPlanner from "./week-planner";
import { Suspense } from "react";

export default function PlannerPage() {
  // Plan the week; Publish menu remains governed from the production workflow.
  // Allergen declarations live in the separate Allergen Checker route.
  return <Suspense fallback={<div className="menu-loading">Loading Week Planner…</div>}><WeekPlanner /></Suspense>;
}
