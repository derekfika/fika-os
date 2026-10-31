import type { Metadata } from "next";
import FoodDataWorkspace from "../ui/food-data/FoodDataWorkspace";

export const metadata: Metadata = { title: "Food Data · FIKA OS" };
export default function FoodDataPage() { return <FoodDataWorkspace />; }
