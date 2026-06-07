import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 安全解析 JSON 字符串列字段，失败时返回兜底值 */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** 私聊频道 key：按 ID 字母序排列，确保双向一致 */
export function getPrivateChannelKey(id1: string, id2: string): string {
  return [id1, id2].sort().join("-");
}
