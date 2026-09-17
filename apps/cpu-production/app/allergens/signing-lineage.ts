export type MatrixLineage = {
  productionOrderId: string;
  serviceDate: string;
  sourceDayId: string;
  sourcePublicationId?: string;
  sourcePublicationDayId: string;
  sourceVersion: number;
  sourceContentHash: string;
  matrixContentHash: string;
};

export type SigningLineageStatus = {
  orderId: string;
  sourceLineage?: MatrixLineage;
};

export function signingLineageUnavailableMessage(orderIds: string[], labels: Readonly<Record<string, string>> = {}, unavailableIds = orderIds) {
  const affected = [...new Set(unavailableIds)].map(orderId => {
    const label = labels[orderId]?.trim();
    return label && label !== orderId ? `${label} (${orderId})` : orderId;
  });
  return `The current source lineage is unavailable for ${affected.join(", ") || "one or more OPLOCs"}. Reload the review before signing.`;
}

export function captureSigningLineage(
  orderIds: string[],
  serviceDate: string,
  statuses: SigningLineageStatus[],
  labels: Readonly<Record<string, string>> = {},
) {
  const expectedIds = [...new Set(orderIds)];
  const statusByOrderId = new Map(statuses.map(status => [status.orderId, status]));
  const unavailableIds = expectedIds.filter(orderId => !statusByOrderId.has(orderId));
  if (unavailableIds.length || statuses.length !== expectedIds.length) {
    throw new Error(signingLineageUnavailableMessage(expectedIds, labels, unavailableIds.length ? unavailableIds : expectedIds));
  }

  const lineageByOrderId: Record<string, MatrixLineage> = {};
  for (const orderId of expectedIds) {
    const lineage = statusByOrderId.get(orderId)?.sourceLineage;
    if (!lineage || lineage.productionOrderId !== orderId || lineage.serviceDate !== serviceDate || !lineage.sourceDayId || !lineage.sourcePublicationDayId || !Number.isInteger(lineage.sourceVersion) || lineage.sourceVersion < 1 || !lineage.sourceContentHash || !lineage.matrixContentHash) {
      throw new Error(signingLineageUnavailableMessage(expectedIds, labels, [orderId]));
    }
    lineageByOrderId[orderId] = lineage;
  }
  return lineageByOrderId;
}
