import { driveAccessToken, resolveDriveOwner } from "@fika/server-shared/drive-owner";
import { createHash } from "node:crypto";
import { renderPdfToBuffer } from "@fika/server-shared/pdf-renderer";
import { hospitalityGroupQuoteHtml } from "./hospitality-group-quote-document";
import type { GroupQuoteArtifact, HospitalityGroupQuote } from "./hospitality-group-quote-workflow";

const base = "https://www.googleapis.com/drive/v3/files";
type FileMetadata = { id: string; mimeType: string; size?: string; md5Checksum?: string; trashed?: boolean; parents?: string[]; appProperties?: Record<string, string>; webViewLink?: string };
async function headers(oplocId: string) {
  return { Authorization: `Bearer ${await driveAccessToken(resolveDriveOwner({ type: "oploc-workspace", oplocId }))}` };
}
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Group quote Drive request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

/** Pre-generated binary-file IDs make creation replay-safe even when a successful upload response is lost.
 * https://developers.google.com/workspace/drive/api/guides/manage-uploads#use_a_pre-generated_id_to_upload_files
 */
export function groupQuoteDriveArtifact(fetcher = fetch, render = renderPdfToBuffer, authHeaders = headers): GroupQuoteArtifact {
  const request = (url: string, init: RequestInit) => fetcher(url, { ...init, signal: AbortSignal.timeout(60_000), cache: "no-store" });
  return {
    reserve: async oplocId => {
      const result = await readJson<{ ids: string[] }>(await request(`${base}/generateIds?count=1&space=drive&type=files`, { headers: await authHeaders(oplocId) }));
      if (!result.ids?.[0]) throw new Error("Drive did not reserve a group quote artifact ID.");
      return result.ids[0];
    },
    ensure: async (q: HospitalityGroupQuote, persistDigest) => {
      const id = q.artifact.fileId;
      if (!id) throw new Error("The group quote artifact ID must be persisted before upload.");
      const auth = await authHeaders(q.artifact.oplocId);
      const url = `${base}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,mimeType,size,md5Checksum,trashed,parents,appProperties,webViewLink`;
      const lookup = () => request(url, { headers: auth });
      const verified = async (response: Response) => {
        const file = await readJson<FileMetadata>(response);
        if (file.id !== id || file.mimeType !== "application/pdf" || file.trashed || !(Number(file.size) > 0) || !q.artifact.pdfMd5 || file.md5Checksum !== q.artifact.pdfMd5 || !file.parents?.includes(q.artifact.folderId) || file.appProperties?.fikaGroupQuoteSource !== q.sourceHash) throw Object.assign(new Error("Group quote artifact integrity verification failed. The existing file was not overwritten."), { integrityFailed: true });
        return { fileId: id, driveUrl: file.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` };
      };
      const existing = await lookup();
      if (existing.ok) return verified(existing);
      if (existing.status !== 404) throw new Error(`Group quote artifact lookup failed (${existing.status}).`);
      const folder = await readJson<{ mimeType: string; trashed?: boolean }>(await request(`${base}/${encodeURIComponent(q.artifact.folderId)}?supportsAllDrives=true&fields=mimeType,trashed`, { headers: auth }));
      if (folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed) throw new Error("The group quote destination is not an active Drive folder.");
      const pdf = await render(hospitalityGroupQuoteHtml(q));
      if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid group quote PDF.");
      if (!persistDigest) throw new Error("A durable PDF digest checkpoint is required before upload.");
      const pdfMd5 = createHash("md5").update(pdf).digest("hex");
      await persistDigest(pdfMd5);
      q = { ...q, artifact: { ...q.artifact, pdfMd5 } };
      const boundary = `fika_group_${q.sourceHash}`;
      const metadata = { id, name: `Quote_${q.bookingGroupId}_r${q.revision}.pdf`, mimeType: "application/pdf", parents: [q.artifact.folderId], appProperties: { fikaGroupQuoteSource: q.sourceHash } };
      const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdf.toString("base64")}\r\n--${boundary}--\r\n`]);
      const uploaded = await request("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { ...auth, "content-type": `multipart/related; boundary=${boundary}` }, body });
      if (!uploaded.ok && uploaded.status !== 409) throw new Error(`Group quote upload failed (${uploaded.status}).`);
      return verified(await lookup());
    },
  };
}
