import PortionPlanner from "../portion-planner";
import { Suspense } from "react";
export default function PortionsPage() { return <Suspense fallback={<div className="menu-loading">Loading Portion Planner…</div>}><PortionPlanner /></Suspense>; }
