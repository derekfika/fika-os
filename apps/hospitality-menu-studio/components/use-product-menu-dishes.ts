import { useEffect, useState } from "react";
import { productMenuDishBatchSize, productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";

function keyForDish(dish: ProductMenuDish) {
  return productMenuDishKey({ dishId: dish.id, revision: dish.version });
}

export function useProductMenuDishes(references: ProductMenuDishReference[], library: ProductMenuDish[]) {
  const known = new Map(library.map(dish => [keyForDish(dish), dish]));
  const requested = [...new Set(references.map(productMenuDishKey).filter(key => !known.has(key)))].sort().join(",");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ requested: string; items: ProductMenuDish[]; error?: true } | null>(null);

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    async function load() {
      try {
        const keys = requested.split(",");
        const items: ProductMenuDish[] = [];
        for (let start = 0; start < keys.length; start += productMenuDishBatchSize) {
          const dishRevisions = keys.slice(start, start + productMenuDishBatchSize).join(",");
          const query = new URLSearchParams({ dishRevisions });
          const response = await fetch(`/api/studio/product-menus?${query}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Saved dishes unavailable");
          const batch = await response.json() as { items: ProductMenuDish[] };
          if (!Array.isArray(batch.items)) throw new Error("Saved dishes unavailable");
          items.push(...batch.items);
        }
        if (!controller.signal.aborted) setResult({ requested, items });
      } catch {
        if (!controller.signal.aborted) setResult({ requested, items: [], error: true });
      }
    }
    void load();
    return () => controller.abort();
  }, [requested, attempt]);

  const resolved = result?.requested === requested ? result : null;
  for (const dish of resolved?.items ?? []) known.set(keyForDish(dish), dish);
  return {
    byRevision: known,
    loading: Boolean(requested && !resolved),
    error: Boolean(resolved?.error),
    retry: () => { setResult(null); setAttempt(value => value + 1); },
  };
}
