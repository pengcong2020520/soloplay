import type { GameEvent } from "@/types/game";

/**
 * 对 POST 接口发起请求并按 SSE 解析 data: 行，逐个回调 GameEvent。
 * 用于消费 message / next-phase / player-command / 等流式接口。
 */
export async function postSse(
  url: string,
  body: unknown,
  onEvent: (e: GameEvent) => void
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.body) {
    throw new Error("无响应流");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = rawEvent
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      try {
        onEvent(JSON.parse(json) as GameEvent);
      } catch {
        // 忽略解析失败的片段
      }
    }
  }
}
