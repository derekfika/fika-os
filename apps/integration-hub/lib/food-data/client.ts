import { openFoodBundleStore } from "./cache";
import { createFoodDataLoader } from "./loader";
import { createCompositionLoader } from "./composition-loader";

/** Browser-only helpers. Importing this module never touches IndexedDB until a function is called. */
export async function clearFoodDataCache() {
  try { const { store } = await openFoodBundleStore(); await store.clearAll(); } catch { /* Nothing local to clear. */ }
}

export async function createBrowserFoodDataLoader() {
  const { store, persistent } = await openFoodBundleStore();
  const environment = `${window.location.protocol}//${window.location.host}`;
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init);
  return {
    loader: createFoodDataLoader({ fetch: fetcher, store, environment }),
    compositionLoader: createCompositionLoader({ fetch: fetcher, store, environment }),
    persistent,
  };
}
