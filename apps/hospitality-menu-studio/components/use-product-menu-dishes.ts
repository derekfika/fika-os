import { useEffect, useMemo, useState } from "react";
import { productMenuDishKey, type ProductMenuDish, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { useStudioReads } from "./studio-reads";

function keyForDish(dish: ProductMenuDish) {
  return productMenuDishKey({ dishId: dish.id, revision: dish.version });
}

export function useProductMenuDishes(references: ProductMenuDishReference[], library: ProductMenuDish[]) {
  const reads = useStudioReads();
  const known = useMemo(() => new Map(library.map(dish => [keyForDish(dish), dish])), [library]);
  const requested = [...new Set(references.map(productMenuDishKey).filter(key => !known.has(key)))].sort().join(",");
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ requested: string; items: ProductMenuDish[]; error?: true } | null>(null);

  useEffect(() => {
    if (!requested) return;
    let active = true;
    async function load() {
      try {
        const items = await reads.loadRevisions(requested.split(","));
        if (active) setResult({ requested, items });
      } catch {
        if (active) setResult({ requested, items: [], error: true });
      }
    }
    void load();
    return () => { active = false; };
  }, [reads, requested, attempt]);

  const resolved = result?.requested === requested ? result : null;
  const byRevision = useMemo(() => new Map([...known, ...(resolved?.items ?? []).map(dish => [keyForDish(dish), dish] as const)]), [known, resolved]);
  return {
    byRevision,
    loading: Boolean(requested && !resolved),
    error: Boolean(resolved?.error),
    retry: () => { setResult(null); setAttempt(value => value + 1); },
  };
}
