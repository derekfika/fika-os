export async function readAccountActionResponse<T>(response: Response): Promise<{ account?: T; committed?: boolean; warning?: string }> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "AUTHMOD could not complete that request.");
  if (!body.account && !(body.committed === true && typeof body.warning === "string" && body.warning.length > 0)) throw new Error("AUTHMOD returned no account or committed-change confirmation. Refresh before making another change.");
  return body;
}
