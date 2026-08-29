import crypto from "node:crypto";

export function stableDocumentId(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
