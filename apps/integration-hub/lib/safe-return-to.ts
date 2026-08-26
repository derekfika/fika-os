export function validateReturnTo(value: string | null | undefined, allowedOrigins = (process.env.FIKA_ALLOWED_APP_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean)) {
  if (!value) return "/";
  if (value.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001f\\]/.test(value)) return value;
  try {
    const target = new URL(value);
    if (allowedOrigins.includes(target.origin)) return `${target.pathname}${target.search}${target.hash}`;
  } catch { /* invalid destinations are rejected below */ }
  throw Object.assign(new Error("The requested return destination is not allowed."), { status: 400, code: "FIKA_RETURN_TO_INVALID" });
}
