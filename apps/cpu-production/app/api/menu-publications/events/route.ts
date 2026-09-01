import { NextRequest } from "next/server";
import { publicationEventStream, subscribeToPublicationChanges } from "../../../../lib/publication-events";
import { requireCpuActor } from "../../../../lib/cpu-access-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  await requireCpuActor(request);
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: string) => controller.enqueue(encoder.encode(value));
      send(": connected\n\n");
      unsubscribe = subscribeToPublicationChanges(event => send(publicationEventStream(event)));
      heartbeat = setInterval(() => send(": heartbeat\n\n"), 25000);
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try { controller.close(); } catch { /* The client already closed the stream. */ }
      }, { once: true });
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, { headers: { "cache-control": "no-cache, no-transform", connection: "keep-alive", "content-type": "text/event-stream" } });
}
