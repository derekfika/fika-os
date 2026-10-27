import { createECDH } from "node:crypto";

export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/**
 * VAPID identity for Web Push. The private key comes from the environment's secret (LOGISTICS_VAPID_PRIVATE_KEY); the public key is
 * derived from it, so the two can never disagree. Each environment has its own pair: a subscription made against one environment's
 * public key can only be sent to with that environment's private key. Returns undefined (push disabled) when not configured or invalid.
 */
export function vapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | undefined {
  const privateKey = env.LOGISTICS_VAPID_PRIVATE_KEY?.trim();
  if (!privateKey) return undefined;
  const subject = env.LOGISTICS_VAPID_SUBJECT?.trim() || "mailto:logistics@fikacatering.com";
  if (!/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) return undefined;
  try {
    const secret = Buffer.from(privateKey, "base64url");
    if (secret.length !== 32) return undefined;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(secret);
    return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey, subject };
  } catch {
    return undefined;
  }
}

const ALLOWED_PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/];

/** The server will POST to a subscriber-supplied URL, so only HTTPS endpoints of the real browser push services are accepted. */
export function allowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && ALLOWED_PUSH_HOSTS.some(pattern => pattern.test(url.hostname));
  } catch {
    return false;
  }
}
