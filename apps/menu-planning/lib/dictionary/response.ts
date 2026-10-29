import meta from "../../dictionary/en-GB-3.0.0-culinary-1.meta.json";

/** Transport the original gzip bytes without Content-Encoding/automatic decompression. */
export function dictionaryHandler(readBytes: () => Promise<Uint8Array>) {
  return async (request: Request) => {
    if (new URL(request.url).searchParams.get("version") !== meta.version) return Response.json({ error: "Dictionary version not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    try {
      const bytes = await readBytes();
      return new Response(new Uint8Array(bytes), { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      } });
    } catch {
      return Response.json({ error: "Dictionary unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
