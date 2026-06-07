import type { GameEvent } from "@/types/game";

/**
 * 创建一个 SSE 流响应。传入一个 producer 回调，回调用 send() 推送事件，
 * 完成后 resolve。返回标准 Response。
 */
export function sseResponse(
  producer: (send: (event: GameEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: GameEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await producer(send);
      } catch (err) {
        send({ type: "ERROR", message: (err as Error)?.message ?? "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
