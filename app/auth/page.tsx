"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

type Mode = "login" | "register";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 注册后若有可认领的游客数据，展示认领提示
  const [claimable, setClaimable] = useState<{ scripts: number; sessions: number } | null>(null);

  async function submit() {
    setError("");
    if (!email || !password) {
      setError("请输入邮箱和密码");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register" ? { email, password, name } : { email, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "操作失败");
        return;
      }
      // 注册后检查是否有可认领的游客数据；有则停下来询问，否则直接回大厅
      if (mode === "register") {
        const g = await fetch("/api/auth/claim-guest").then((r) => r.json());
        if ((g.scripts ?? 0) > 0 || (g.sessions ?? 0) > 0) {
          setClaimable({ scripts: g.scripts, sessions: g.sessions });
          return;
        }
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function claim(yes: boolean) {
    setBusy(true);
    try {
      if (yes) {
        await fetch("/api/auth/claim-guest", { method: "POST" });
      }
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // 认领提示界面（注册后若检测到游客数据）
  if (claimable) {
    return (
      <main className="case-page flex min-h-screen flex-col justify-center px-6">
        <Card className="mx-auto w-full max-w-md border-primary/25">
          <CardHeader>
            <CardTitle className="case-serif">把游客数据归到你的账号？</CardTitle>
            <p className="text-sm text-muted-foreground">
              检测到本机游客模式下已有
              {claimable.scripts > 0 && <span className="text-foreground"> {claimable.scripts} 个剧本</span>}
              {claimable.scripts > 0 && claimable.sessions > 0 && "、"}
              {claimable.sessions > 0 && <span className="text-foreground"> {claimable.sessions} 局游戏</span>}
              。是否将它们认领到你刚注册的账号？
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={() => claim(true)} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              认领这些数据
            </Button>
            <Button variant="outline" className="w-full" onClick={() => claim(false)} disabled={busy}>
              不用，从空白账号开始
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="case-page flex min-h-screen flex-col justify-center px-6">
      <Card className="mx-auto w-full max-w-md border-primary/25">
        <CardHeader>
          <CardTitle className="case-serif">{mode === "login" ? "登录" : "注册"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            登录后你的剧本与游戏记录将与你的账号绑定、互相隔离。不登录也可以游客身份直接游玩。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">邮箱</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {mode === "register" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">昵称（可选）</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的昵称" />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">密码（至少 6 位）</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="••••••"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {mode === "login" ? "登录" : "注册并登录"}
          </Button>

          <div className="flex items-center justify-between pt-1 text-xs">
            <button
              className="text-primary hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
              }}
            >
              {mode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
            <button className="text-muted-foreground hover:underline" onClick={() => router.push("/")}>
              以游客身份继续 →
            </button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
