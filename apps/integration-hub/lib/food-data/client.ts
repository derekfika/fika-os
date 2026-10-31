import { openFoodBundleStore } from "./cache";
import { createFoodDataLoader } from "./loader";

/** Browser-only helpers. Importing this module never touches IndexedDB until a function is called. */
export async function clearFoodDataCache() {
  try { const { store } = await openFoodBundleStore(); await store.clearAll(); } catch { /* Nothing local to clear. */ }
}

export async function createBrowserFoodDataLoader() {
  const { store, persistent } = await openFoodBundleStore();
  return { loader: createFoodDataLoader({ fetch: (input, init) => window.fetch(input, init), store, environment: `${window.location.protocol}//${window.location.host}` }), persistent };
}
