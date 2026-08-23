import AllergenChecker from "../allergen-checker";
import { Suspense } from "react";
export default function AllergensPage() { return <Suspense fallback={<div className="menu-loading">Loading Allergen Checker…</div>}><AllergenChecker /></Suspense>; }
