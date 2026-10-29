export async function readAccountActionResponse<T>(response: Response): Promise<{ account: T; committed?: boolean; warning?: string }> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "AUTHMOD could not complete that request.");
  return body;
}
