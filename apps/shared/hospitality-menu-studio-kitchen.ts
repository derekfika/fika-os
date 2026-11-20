/** Kitchen-only evidence copied from the accepted booking by the canonical Hub handoff. */
export type StudioKitchenSpec = {
  version: 1;
  bookingId: string;
  bookingLineId: string;
  selections: StudioKitchenSelection[];
};

type StudioKitchenSelection = {
  selectionId: string;
  subject: { dishId: string; revision: number; sourceHash: string };
  publication: { publicationId: string; publicationRevision: number; contentHash: string };
  release: { releaseId: string; matrixHash: string };
  name: string;
  kitchenDescription: string;
  assortment: StudioKitchenAssortment | null;
};

export type StudioKitchenAssortment = {
  boxCount: number;
  unit: string;
  expectedTotal: number;
  components: { id: string; name: string; quantity: number }[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit && value.trim().length > 0;
}

function id(value: unknown): value is string {
  return text(value, 256) && value === value.trim();
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readAssortment(value: unknown): StudioKitchenAssortment | null | undefined {
  if (value === null) return null;
  const assortment = record(value);
  if (!assortment) return undefined;
  const { boxCount, unit, expectedTotal, components } = assortment;
  if (!positiveInteger(boxCount) || !text(unit, 48) || !positiveInteger(expectedTotal) ||
      !Number.isSafeInteger(boxCount * expectedTotal) || !Array.isArray(components)) return undefined;

  const distinct = new Set<string>();
  const accepted: StudioKitchenAssortment["components"] = [];
  let sum = 0;
  for (const value of components) {
    const component = record(value);
    if (!component) return undefined;
    const { id: componentId, name, quantity } = component;
    if (!id(componentId) || distinct.has(componentId) || !text(name, 200) ||
        !positiveInteger(quantity) || quantity > expectedTotal - sum) return undefined;
    distinct.add(componentId);
    sum += quantity;
    accepted.push({ id: componentId, name, quantity });
  }
  if (sum !== expectedTotal) return undefined;
  return { boxCount, unit, expectedTotal, components: accepted };
}

/** Validates a trusted handoff payload's binding and quantities and projects only kitchen fields.
 * Publication/release authenticity is established at booking acceptance before canonical handoff.
 */
export function readStudioKitchenSpec(
  value: unknown,
  bookingId: unknown,
  bookingLineId: unknown,
): StudioKitchenSpec | undefined {
  const spec = record(value);
  if (!id(bookingId) || !id(bookingLineId) || spec?.version !== 1 || spec.bookingId !== bookingId ||
      spec.bookingLineId !== bookingLineId || !Array.isArray(spec.selections) || !spec.selections.length) return undefined;

  const distinct = new Set<string>();
  const selections: StudioKitchenSelection[] = [];
  for (const value of spec.selections) {
    const selection = record(value);
    if (!selection) return undefined;
    const { selectionId, name, kitchenDescription } = selection;
    const subject = record(selection.subject);
    const publication = record(selection.publication);
    const release = record(selection.release);
    const assortment = readAssortment(selection.assortment);
    if (!id(selectionId) || distinct.has(selectionId) || !text(name, 200) || !text(kitchenDescription, 12000) ||
        !subject || !id(subject.dishId) || !positiveInteger(subject.revision) || !hash(subject.sourceHash) ||
        !publication || !id(publication.publicationId) || !positiveInteger(publication.publicationRevision) || !hash(publication.contentHash) ||
        !release || !id(release.releaseId) || !hash(release.matrixHash) || assortment === undefined) return undefined;
    distinct.add(selectionId);
    selections.push({
      selectionId,
      subject: { dishId: subject.dishId, revision: subject.revision, sourceHash: subject.sourceHash },
      publication: { publicationId: publication.publicationId, publicationRevision: publication.publicationRevision, contentHash: publication.contentHash },
      release: { releaseId: release.releaseId, matrixHash: release.matrixHash },
      name,
      kitchenDescription,
      assortment,
    });
  }
  return { version: 1, bookingId, bookingLineId, selections };
}
