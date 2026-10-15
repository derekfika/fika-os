/** Hub-owned, server-resolved destination. Never accepted from a browser command. */
export type HospitalityMatrixStorageContext =
  | { kind: "cpu-default" }
  | { kind: "hospitality-site"; oplocId: string; googleMatrixFolderId?: string };
