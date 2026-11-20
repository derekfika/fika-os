import { studioPublicationAudience, studioReviewAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";

const metadataIdentity = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export async function boundedPeerText(response: Response) {
  const maximumBytes = 8192;
  if (!response.body || Number(response.headers.get("content-length")) > maximumBytes) throw new Error("Studio peer response is too large.");
  const reader = response.body.getReader();
  const bytes: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(bytes, size).toString("utf8");
      size += value.byteLength;
      if (size > maximumBytes) throw new Error("Studio peer response is too large.");
      bytes.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function studioPeerToken(audience: typeof studioReviewAudience | typeof studioPublicationAudience, fetcher: typeof fetch) {
  const url = new URL(metadataIdentity);
  url.searchParams.set("audience", audience);
  url.searchParams.set("format", "full");
  const response = await fetcher(url, {
    headers: { "Metadata-Flavor": "Google" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3000),
  });
  if (!response.ok || response.headers.get("Metadata-Flavor") !== "Google") throw new Error("Studio runtime identity is unavailable.");
  const token = (await boundedPeerText(response)).trim();
  if (!jwt.test(token)) throw new Error("Studio runtime identity is unavailable.");
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const { email, subject } = studioReviewStaging.studioIdentity;
  if (claims.email !== email || claims.sub !== subject || claims.email_verified !== true ||
      claims.aud !== audience || claims.iss !== "https://accounts.google.com" ||
      !Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() / 1000) throw new Error("Studio runtime identity is unavailable.");
  return token;
}
