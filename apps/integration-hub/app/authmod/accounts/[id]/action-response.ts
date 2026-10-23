export type ActionResult<A> = { account: A; warning?: string };

/** Parse an AUTHMOD action response. Throws with the server message when the save was rejected. */
export async function readActionResponse<A>(response: Response): Promise<ActionResult<A>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "AUTHMOD could not complete that request.");
  return { account: body.account as A, ...(typeof body.warning === "string" ? { warning: body.warning } : {}) };
}

/** Where a command's failure should be shown. */
export const errorSectionFor = (command: { action?: unknown }): "apps" | "page" => command.action === "app" ? "apps" : "page";
