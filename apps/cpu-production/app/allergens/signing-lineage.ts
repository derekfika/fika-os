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

export function captureSigningLineage(
  orderIds: string[],
  serviceDate: string,
  statuses: SigningLineageStatus[],
) {
  const expectedIds = [...new Set(orderIds)];
  const statusByOrderId = new Map(statuses.map(status => [status.orderId, status]));
  if (statuses.length !== expectedIds.length || expectedIds.some(orderId => !statusByOrderId.has(orderId))) {
    throw new Error("The current Menu publication lineage is unavailable for one or more OPLOCs. Reload the review before signing.");
  }

  const lineageByOrderId: Record<string, MatrixLineage> = {};
  for (const orderId of expectedIds) {
    const lineage = statusByOrderId.get(orderId)?.sourceLineage;
    if (!lineage || lineage.productionOrderId !== orderId || lineage.serviceDate !== serviceDate || !lineage.sourceDayId || !lineage.sourcePublicationDayId || !Number.isInteger(lineage.sourceVersion) || lineage.sourceVersion < 1 || !lineage.sourceContentHash || !lineage.matrixContentHash) {
      throw new Error("The current Menu publication lineage is unavailable for one or more OPLOCs. Reload the review before signing.");
    }
    lineageByOrderId[orderId] = lineage;
  }
  return lineageByOrderId;
}
