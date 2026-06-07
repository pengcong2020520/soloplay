"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScriptTypeLabel, DifficultyLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { Loader2, Users, Clock } from "lucide-react";
import { ScriptIntroPanel, type ScriptIntroCharacter } from "@/components/ScriptIntroPanel";

interface BuiltinScript {
  id: string;
  title: string;
  scriptType: string;
  difficulty: string;
  characterCount: number;
  estimatedDuration: number;
  publicStory: string;
  characters?: ScriptIntroCharacter[];
}

export default function LibraryPage() {
  const router = useRouter();
  const [scripts, setScripts] = useState<BuiltinScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/script/builtin")
      .then((r) => r.json())
      .then((d) => setScripts(d.scripts ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function startGame(
    scriptId: string,
    playerMode: "ROLE_PLAY" | "DETECTIVE",
    playerCharacterId?: string
  ) {
    setStarting(scriptId);
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, playerMode, playerCharacterId }),
      });
      const data = await res.json();
      if (data.sessionId) {
        router.push(`/game/${data.sessionId}`);
      } else {
        alert(data.error ?? "开局失败");
        setStarting(null);
      }
    } catch {
      setStarting(null);
    }
  }

  return (
    <main className="case-page px-6 py-10">
      <div className="mx-auto max-w-5xl">
      <div className="case-panel mb-6 flex items-center justify-between rounded-lg p-5">
        <div>
          <h1 className="case-serif text-2xl font-bold">内置剧本库</h1>
          <p className="mt-1 text-sm text-muted-foreground">精选预置剧本，无需生成，挑一个直接开玩。</p>
        </div>
        <Button variant="ghost" onClick={() => router.push("/")}>← 大厅</Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> 正在载入剧本库…
        </div>
      ) : scripts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">剧本库暂时为空。</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {scripts.map((s) => {
            const theme = getScriptTheme(s.scriptType, s.title);
            return (
            <Card key={s.id} className="script-card case-card-hover min-h-[260px]" style={scriptThemeStyle(theme)}>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {s.title}
                  <Badge className={theme.badgeClass}>{theme.label}</Badge>
                  <Badge variant="secondary">{ScriptTypeLabel[s.scriptType as keyof typeof ScriptTypeLabel] ?? s.scriptType}</Badge>
                  <Badge variant="outline">{DifficultyLabel[s.difficulty as keyof typeof DifficultyLabel] ?? s.difficulty}</Badge>
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Users className="h-3 w-3" />{s.characterCount} 人
                  </span>
                  <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <Clock className="h-3 w-3" />约 {s.estimatedDuration} 分钟
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{s.publicStory}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={selectedScriptId === s.id ? "secondary" : "default"}
                    disabled={Boolean(starting)}
                    onClick={() => setSelectedScriptId((current) => (current === s.id ? null : s.id))}
                  >
                    {starting === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {selectedScriptId === s.id ? "收起介绍" : "查看简介与选角"}
                  </Button>
                </div>
                {selectedScriptId === s.id && (
                  <ScriptIntroPanel
                    script={s}
                    starting={starting === s.id}
                    onStart={(mode, playerCharacterId) => startGame(s.id, mode, playerCharacterId)}
                  />
                )}
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
