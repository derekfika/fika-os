export type OperationCounts = {
  attemptedReads: number;
  missingDocuments: number;
  returnedDocuments: number;
  transactionReads: number;
  writes: number;
  deletes: number;
  retries: number;
  queueCandidates: number;
  predecessorReads: number;
};

export class OperationBudget {
  readonly counts: OperationCounts = {
    attemptedReads: 0,
    missingDocuments: 0,
    returnedDocuments: 0,
    transactionReads: 0,
    writes: 0,
    deletes: 0,
    retries: 0,
    queueCandidates: 0,
    predecessorReads: 0,
  };

  read(documents = 1, kind: "document" | "transaction" | "query" | "predecessor" = "document") {
    this.counts.attemptedReads += documents;
    if (kind === "transaction") this.counts.transactionReads += documents;
    if (kind === "query") this.counts.returnedDocuments += documents;
    if (kind === "predecessor") this.counts.predecessorReads += documents;
    return documents;
  }

  documentRead(exists: boolean, kind: "document" | "transaction" | "predecessor" = "document") {
    this.read(1, kind);
    if (!exists) this.counts.missingDocuments += 1;
    return exists;
  }

  queryReturned(documents: number) {
    this.counts.queueCandidates += documents;
    return this.read(documents, "query");
  }

  write(documents = 1) {
    this.counts.writes += documents;
    return documents;
  }

  delete(documents = 1) {
    this.counts.deletes += documents;
    return documents;
  }

  retry(attempts = 1) {
    this.counts.retries += attempts;
    return attempts;
  }

  snapshot(): OperationCounts {
    return { ...this.counts };
  }
}

export function assertOperationBudget(
  label: string,
  actual: number,
  ceiling: number,
  dimension: string,
) {
  if (actual > ceiling) {
    throw new Error(`${label} exceeded ${dimension} budget: expected <= ${ceiling}, got ${actual}`);
  }
}

export function assertSameOperationShape(label: string, left: OperationCounts, right: OperationCounts) {
  for (const key of Object.keys(left) as Array<keyof OperationCounts>) {
    assertOperationBudget(label, right[key], left[key], key);
    assertOperationBudget(label, left[key], right[key], key);
  }
}
