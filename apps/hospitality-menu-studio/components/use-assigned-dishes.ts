import { useEffect, useMemo, useState } from "react";
import type { Dish } from "../lib/contract";

type Hydration = {
  items: Dish[];
  missing: string[];
  error: string;
  loading: boolean;
};
const empty: Hydration = { items: [], missing: [], error: "", loading: false };

/** Resolve only assigned IDs absent from the loaded library, in bounded read-only batches. */
export function useAssignedDishes(
  ids: readonly string[],
  dishes: readonly Dish[],
) {
  const known = new Set(dishes.map((dish) => dish.id));
  const key = JSON.stringify(
    [...new Set(ids.filter((id) => !known.has(id)))].sort(),
  );
  const missingIds: string[] = useMemo(() => JSON.parse(key), [key]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: Hydration }>({
    key: "",
    value: empty,
  });
  useEffect(() => {
    if (!missingIds.length) {
      setResult({ key, value: empty });
      return;
    }
    const controller = new AbortController();
    setResult({ key, value: { ...empty, loading: true } });
    (async () => {
      const items: Dish[] = [];
      try {
        for (let offset = 0; offset < missingIds.length; offset += 24) {
          const params = new URLSearchParams({
            list: "assigned-dishes",
            ids: missingIds.slice(offset, offset + 24).join(","),
          });
          const response = await fetch(`/api/studio?${params}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok)
            throw new Error("Assigned dishes could not be loaded.");
          const body = await response.json();
          if (!Array.isArray(body.items))
            throw new Error("Assigned dishes could not be loaded.");
          items.push(...body.items);
        }
        if (!controller.signal.aborted) {
          const returned = new Set(items.map((item) => item.id));
          setResult({
            key,
            value: {
              items,
              missing: missingIds.filter((id) => !returned.has(id)),
              error: "",
              loading: false,
            },
          });
        }
      } catch {
        if (!controller.signal.aborted)
          setResult({
            key,
            value: {
              ...empty,
              error:
                "Assigned dishes could not be loaded. Retry to see their names.",
              loading: false,
            },
          });
      }
    })();
    return () => controller.abort();
  }, [key, missingIds, attempt]);
  const current =
    result.key === key
      ? result.value
      : { ...empty, loading: missingIds.length > 0 };
  return { ...current, retry: () => setAttempt((value) => value + 1) };
}
