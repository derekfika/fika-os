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

/** Timestamp metadata is trusted only for the exact retained payload. */
export function retainedTimestamp(
  raw: string | null,
  metadata: string | null,
): string | null {
  if (!raw || !metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { value?: string; at?: string };
    return parsed.value === raw &&
      typeof parsed.at === "string" &&
      Number.isFinite(Date.parse(parsed.at))
      ? parsed.at
      : null;
  } catch {
    return null;
  }
}

export function retainedMetadataKey(key: string): string {
  return `fika-studio-time:${key}`;
}

export function formatRetainedTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function retainedDraftText(
  item: import("../lib/contract").Menu | import("../lib/contract").Dish,
  dishes: import("../lib/contract").Dish[],
): string {
  if ("customerDescription" in item) {
    const lines = [
      `Dish: ${item.name || "Untitled"}`,
      `Category: ${item.category}`,
      `Temperature: ${item.temperature || "Not specified"}`,
      `Customer description: ${item.customerDescription || "Not entered"}`,
      `Kitchen description: ${item.kitchenDescription || "Not entered"}`,
    ];
    if (item.assortment)
      lines.push(
        `Assortment: ${item.assortment.expectedTotal} ${item.assortment.unit}`,
        ...item.assortment.components.map((c) => `- ${c.name}: ${c.quantity}`),
      );
    return lines.join("\n");
  }
  const names = (ids: string[]) =>
    ids
      .map(
        (id) =>
          dishes.find((d) => d.id === id)?.name || "Dish name unavailable",
      )
      .join(", ") || "None";
  return [
    `Menu: ${item.name || "Untitled"}`,
    `Type: ${item.kind}`,
    `Dates: ${item.startDate || "Not entered"} to ${item.endDate || "Not entered"}`,
    `Rotation starts: ${item.anchorMonday || "Not entered"}`,
    ...item.sections.flatMap((section) => [
      `Section: ${section.name || "Untitled"}`,
      ...(section.mode === "static"
        ? [`Dishes: ${names(section.staticDishIds)}`]
        : section.weeks.map(
            (week, index) => `Week ${index + 1}: ${names(week)}`,
          )),
    ]),
  ].join("\n");
}
