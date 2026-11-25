import type { Dish } from "../../shared/hospitality-menu-studio-content";

export const productMenuDishBatchSize = 24;
export type ProductMenuDishReference = { dishId: string; revision: number };
export type ProductMenuDish = Pick<Dish, "id" | "version" | "name" | "category" | "customerDescription">;

export function productMenuDishKey({ dishId, revision }: ProductMenuDishReference) {
  return `${dishId}@${revision}`;
}
