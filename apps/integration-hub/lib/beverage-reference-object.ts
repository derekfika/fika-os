import type { Readable } from "node:stream";

export async function collectBoundedBeverageObject(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("Beverage reference object exceeds its byte limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function readBoundedBeverageObject(stream: Readable, maxBytes: number) {
  const timer = setTimeout(() => stream.destroy(new Error("Beverage reference object read timed out.")), 8000);
  try { return await collectBoundedBeverageObject(stream, maxBytes); }
  finally { clearTimeout(timer); }
}
