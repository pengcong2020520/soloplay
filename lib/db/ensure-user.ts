// 兼容垫片：实现已迁移到 lib/auth/current-user.ts（引入登录态后）。
// 新代码请直接从 @/lib/auth/current-user 引入 resolveUserId / ensureLocalUser。
export { ensureLocalUser, resolveUserId } from "@/lib/auth/current-user";
