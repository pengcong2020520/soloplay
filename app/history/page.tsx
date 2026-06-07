"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScriptTypeLabel, PlayerModeLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";

const STATUS_LABEL: Record<string, string> = {
  SETUP: "未开始",
  IN_PROGRESS: "进行中",
  PAUSED: "已暂停",
  COMPLETED: "已完成",
};

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/game/list")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="case-page px-6 py-10">
      <div className="mx-auto max-w-4xl">
      <div className="case-panel mb-6 flex items-center justify-between rounded-lg p-5">
        <div>
          <h1 className="case-serif text-2xl font-bold">历史游戏</h1>
          <p className="mt-1 text-sm text-muted-foreground">继续未完的局，或打开旧案复盘。</p>
        </div>
        <Button variant="ghost" onClick={() => router.push("/")}>← 大厅</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">加载中…</p>
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            还没有任何游戏记录。<Link href="/setup" className="text-primary hover:underline">去开一局 →</Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const theme = getScriptTheme(s.scriptType, s.title);
            return (
            <Card key={s.id} className="script-art-soft case-card-hover" style={scriptThemeStyle(theme)}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {s.title}
                    <Badge className={theme.badgeClass}>{theme.label}</Badge>
                    <Badge variant="secondary">{ScriptTypeLabel[s.scriptType as keyof typeof ScriptTypeLabel] ?? s.scriptType}</Badge>
                    <Badge variant="outline">{PlayerModeLabel[s.playerMode as keyof typeof PlayerModeLabel] ?? s.playerMode}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {STATUS_LABEL[s.status] ?? s.status} · {new Date(s.createdAt).toLocaleString("zh-CN")}
                  </div>
                </div>
                <div className="flex gap-2">
                  {s.status === "COMPLETED" ? (
                    <Button size="sm" onClick={() => router.push(`/replay/${s.id}`)}>复盘</Button>
                  ) : (
                    <Button size="sm" onClick={() => router.push(`/game/${s.id}`)}>继续</Button>
                  )}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
      </div>
    </main>
  );
}
