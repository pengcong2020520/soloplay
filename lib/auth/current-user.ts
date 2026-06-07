import { cookies } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { LOCAL_USER } from "@/lib/constants";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

/** 运行时确保游客账号存在（local-user，免登录默认） */
export async function ensureLocalUser(): Promise<string> {
  await prisma.user.upsert({
    where: { id: LOCAL_USER.id },
    update: {},
    create: {
      id: LOCAL_USER.id,
      email: LOCAL_USER.email,
      name: LOCAL_USER.name,
    },
  });
  return LOCAL_USER.id;
}

/**
 * 解析签名 cookie 并对账 DB，返回已登录用户（含 id/email/name）或 null。
 * 吊销在此生效：cookie 里的 tokenVersion 与 DB 中 User.tokenVersion 不一致 → 视为失效。
 */
async function resolveSessionUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const parsed = verifySessionToken(token);
  if (!parsed) return null;
  const user = await prisma.user.findUnique({
    where: { id: parsed.uid },
    select: { id: true, email: true, name: true, tokenVersion: true },
  });
  if (!user) return null; // 用户已被删除
  if (user.tokenVersion !== parsed.tv) return null; // 会话已被吊销（登出所有设备）
  return user;
}

/**
 * 解析当前请求的用户 id：
 * 1. 有有效签名 cookie、用户存在、tokenVersion 匹配 → 返回该 userId；
 * 2. 否则回退到游客账号 local-user（保持免登录可玩、旧数据不丢）。
 *
 * 平滑过渡的核心：已登录走自己的数据，未登录访客仍走 local-user。
 */
export async function resolveUserId(): Promise<string> {
  const user = await resolveSessionUser();
  if (user) return user.id;
  return ensureLocalUser();
}

/**
 * 校验某游戏会话是否属于当前用户。
 * 返回 { ok, userId, session }。用于不经 loadSession 的路由（start/replay/recommend/feedback/messages）。
 */
export async function assertSessionOwner(sessionId: string) {
  const userId = await resolveUserId();
  const session = await prisma.gameSession.findUnique({ where: { id: sessionId } });
  if (!session) return { ok: false as const, userId, session: null, reason: "未找到会话" };
  if (session.userId !== userId)
    return { ok: false as const, userId, session: null, reason: "无权访问该会话" };
  return { ok: true as const, userId, session };
}

/** 是否为已登录（非游客）用户。返回 { id, email, name } 或 null。 */
export async function getCurrentUser() {
  const user = await resolveSessionUser();
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name };
}
