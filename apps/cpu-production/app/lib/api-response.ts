export async function readApiResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "The CPU service returned an unreadable response. Please refresh and try again."
        : "The CPU service is unavailable. Please refresh and try again.",
    );
  }
}
