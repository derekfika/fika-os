export type ResponseErrorDetails = { message: string; code?: string; requestId?: string; status: number };

export class LogisticsResponseError extends Error {
  constructor(public details: ResponseErrorDetails) {
    super(details.message);
  }
}

export function responseErrorDetails(body: unknown, status: number, fallback: string): ResponseErrorDetails {
  const root = body as { error?: unknown; requestId?: unknown } | null;
  const error = root?.error;
  const requestId = typeof root?.requestId === "string" ? root.requestId : undefined;
  if (typeof error === "string") return { message: status === 401 ? "Your FIKA OS session is no longer valid. Sign in again." : error, status, requestId };
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; code?: unknown; requestId?: unknown };
    return {
      message: status === 401 ? "Your FIKA OS session is no longer valid. Sign in again." : typeof value.message === "string" ? value.message : fallback,
      code: typeof value.code === "string" ? value.code : undefined,
      requestId: typeof value.requestId === "string" ? value.requestId : undefined,
      status,
    };
  }
  return { message: fallback, status };
}

export async function requireSuccessfulResponse(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LogisticsResponseError(responseErrorDetails(body, response.status, fallback));
  return body as Record<string, unknown>;
}

export function clientErrorDetails(error: unknown, fallback: string): ResponseErrorDetails {
  if (error instanceof LogisticsResponseError) return error.details;
  return { message: error instanceof Error ? error.message : fallback, status: 0 };
}
