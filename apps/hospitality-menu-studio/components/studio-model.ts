/** Keyboard and pointer controls use the same bounded reorder operation. */
export function moveDish(
  ids: string[],
  index: number,
  direction: -1 | 1,
): string[] {
  const target = index + direction;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length)
    return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function assortmentTotal(components: { quantity: number }[]): number {
  return components.reduce((total, component) => total + component.quantity, 0);
}

/** Never remove a local draft that changed after the acknowledged request. */
export function retainedDraftMatchesRequest(
  retained: string | null,
  request: unknown,
): boolean {
  return retained !== null && retained === JSON.stringify(request);
}

export function localDraftKey(
  actor: string,
  kind: string,
  id: string,
  editor: string,
): string {
  return `fika-studio:${actor}:${kind}:${id}:${editor}`;
}

/** Display groups do not change stored classifications or omit unavailable IDs. */
export function groupSelectedDishes(ids: string[], dishes: { id: string; category: string }[]) {
  const labels = ["Meat", "Fish", "Veggie / Vegan", "Salad", "Dessert", "Other", "Not loaded"] as const;
  const groups = labels.map(label => ({ label, ids: [] as string[] }));
  for (const id of ids) {
    const category = dishes.find(d => d.id === id)?.category;
    const index = category === "meat" ? 0 : category === "fish" ? 1 :
      category === "vegetarian" || category === "vegan" ? 2 : category === "salad" ? 3 :
      category === "dessert" ? 4 : category ? 5 : 6;
    groups[index]!.ids.push(id);
  }
  return groups.filter(group => group.ids.length > 0);
}

/** Reorder within a visible group while retaining every other group's positions. */
export function moveGroupedDish(ids: string[], group: string[], id: string, direction: -1 | 1) {
  const index = group.indexOf(id);
  const target = group[index + direction];
  if (index < 0 || target === undefined) return ids;
  const next = [...ids];
  const a = next.indexOf(id), b = next.indexOf(target);
  if (a < 0 || b < 0) return ids;
  [next[a], next[b]] = [next[b]!, next[a]!];
  return next;
}

/** Guidance is shown only for the named standard section, never enforced. */
export function planningTarget(name: string): string | null {
  const key = name.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
  if (key === "breakfast pots") return "6 dishes";
  if (key === "salad & protein" || key === "salad and protein") return "3 proteins and 3 salads";
  if (key === "hot fork buffet") return "5 meat, 5 fish, 5 combined veggie / vegan, 12 salads and 12 desserts";
  if (["bowl food", "finger food", "canapés", "canapes"].includes(key)) return "5 meat, 5 fish and 5 combined veggie / vegan";
  return null;
}


export type DishReviewStatus = "unverified" | "in_review" | "verified" | "revoked" | "unavailable";
export function dishReviewStatus(value: unknown): DishReviewStatus {
  if (typeof value !== "object" || value === null || !("status" in value)) return "unavailable";
  const status = value.status;
  return status === "unverified" || status === "in_review" || status === "verified" || status === "revoked" ? status : "unavailable";
}

/** Accept only the exact server-returned local CPU handoff for this saved revision. */
export function checkerHandoff(value: unknown, id: string, version: number): { acknowledged: boolean; url?: string } {
  if (typeof value !== "object" || value === null) return { acknowledged: false };
  const result = value as { subject?: { dishId?: unknown; revision?: unknown; sourceHash?: unknown }; checkerPath?: unknown; checkerUrl?: unknown };
  const path = `/allergens/studio/${encodeURIComponent(id)}/${version}`;
  if (result.subject?.dishId !== id || result.subject?.revision !== version || typeof result.subject?.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(result.subject.sourceHash) || result.checkerPath !== path) return { acknowledged: false };
  if (typeof result.checkerUrl !== "string") return { acknowledged: true };
  try {
    const url = new URL(result.checkerUrl);
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port && !url.username && !url.password && url.pathname === path && !url.search && !url.hash) return { acknowledged: true, url: url.href };
  } catch { /* No link is safer than an invalid destination. */ }
  return { acknowledged: true };
}

/** Invalidates pending results when the saved subject or request changes. */
export class ReviewResponseGuard {
  private key = "";
  private generation = 0;
  select(key: string) { if (this.key !== key) { this.key = key; this.generation++; } }
  start() { return ++this.generation; }
  invalidate() { this.generation++; }
  matches(key: string, generation: number) { return this.key === key && this.generation === generation; }
}
