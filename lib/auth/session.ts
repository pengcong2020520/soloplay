import { createHmac, timingSafeEqual } from "crypto";

/**
 * 无状态签名 cookie 会话：cookie 值 = base64url(payload) + "." + hmac。
 * payload = { uid, exp }。验证 HMAC + 过期即可，无需服务端会话表（最轻）。
 *
 * 签名密钥来自 AUTH_SECRET；未配置时退回一个仅用于本地开发的固定弱密钥（生产务必设置）。
 */
const SECRET =
  process.env.AUTH_SECRET?.trim() ||
  "aidm-local-dev-secret-please-set-AUTH_SECRET-in-production";

export const SESSION_COOKIE = "aidm_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 天

interface SessionPayload {
  uid: string;
  exp: number; // epoch seconds
  tv: number; // tokenVersion，用于吊销：与 DB 中 User.tokenVersion 不一致即失效
}

/** 解析后的会话信息（验签 + 未过期后返回，tokenVersion 仍需调用方与 DB 比对） */
export interface ParsedSession {
  uid: string;
  tv: number;
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function sign(data: string): string {
  return createHmac("sha256", SECRET).update(data).digest("base64url");
}

/** 生成签名 cookie 值（嵌入 tokenVersion 以支持吊销） */
export function createSessionToken(userId: string, tokenVersion: number): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = b64urlEncode(
    JSON.stringify({ uid: userId, exp, tv: tokenVersion } as SessionPayload)
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * 校验 cookie 值（验签 + 未过期），返回 { uid, tv }；无效/过期返回 null。
 * 注意：这里只验签和过期；tokenVersion 是否仍然有效需调用方拿 tv 与 DB 中 User.tokenVersion 比对。
 */
export function verifySessionToken(token: string | undefined): ParsedSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(payload);
  // 恒定时间比较签名
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(b64urlDecode(payload)) as SessionPayload;
    if (!parsed.uid || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    const tv = typeof parsed.tv === "number" ? parsed.tv : 0;
    return { uid: parsed.uid, tv };
  } catch {
    return null;
  }
}

/** 设置会话 cookie 的标准属性 */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SEC,
    secure: process.env.NODE_ENV === "production",
  };
}
