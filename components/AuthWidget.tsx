"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User as UserIcon, Loader2 } from "lucide-react";

interface Me {
  id: string;
  email: string;
  name: string | null;
}

/** 首页右上角登录态：未登录显示"登录/注册"，已登录显示昵称 + 登出。游客（local-user）视为未登录态。 */
export function AuthWidget() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    router.refresh();
  }

  async function logoutAll() {
    if (!confirm("将登出你在所有设备上的登录，确定吗？")) return;
    await fetch("/api/auth/logout-all", { method: "POST" });
    setMe(null);
    router.refresh();
  }

  if (loading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  if (me) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <UserIcon className="h-3.5 w-3.5" />
          {me.name || me.email}
        </span>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="h-3.5 w-3.5" /> 登出
        </Button>
        <button
          className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          onClick={logoutAll}
          title="使所有设备上的登录失效"
        >
          登出全部
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">游客模式</span>
      <Button variant="outline" size="sm" onClick={() => router.push("/auth")}>
        <LogIn className="h-3.5 w-3.5" /> 登录 / 注册
      </Button>
    </div>
  );
}
