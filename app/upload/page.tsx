"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScriptTypeLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { Loader2, Upload, FileText, AlertTriangle } from "lucide-react";

const SCRIPT_TYPES = Object.entries(ScriptTypeLabel);

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [scriptType, setScriptType] = useState("DEDUCTION");
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerMode, setPlayerMode] = useState<"ROLE_PLAY" | "DETECTIVE">("ROLE_PLAY");
  const [starting, setStarting] = useState(false);
  const theme = getScriptTheme(scriptType, result?.title);

  async function handleParse() {
    if (!file) return;
    setParsing(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scriptType", scriptType);
      const res = await fetch("/api/script/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "解析失败");
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function handleStart() {
    if (!result?.scriptId) return;
    setStarting(true);
    try {
      const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: result.scriptId, playerMode }),
      });
      const { sessionId } = await res.json();
      router.push(`/game/${sessionId}`);
    } catch {
      setStarting(false);
    }
  }

  return (
    <main className="case-page px-6 py-10" style={scriptThemeStyle(theme)}>
      <div className="mx-auto max-w-2xl">
      <div className="case-panel mb-6 flex items-center justify-between rounded-lg p-5">
        <div>
          <h1 className="case-serif text-2xl font-bold">上传剧本</h1>
          <p className="mt-1 text-sm text-muted-foreground">把已有文本整理成可开局的案卷。</p>
        </div>
        <Button variant="ghost" onClick={() => router.push("/")}>← 大厅</Button>
      </div>

      {!result && (
        <Card className="script-art-soft border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">选择剧本文件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-background/45 p-8 text-center transition-all hover:-translate-y-0.5 hover:bg-secondary/40",
                file && "border-primary/50 bg-primary/5"
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              {file ? (
                <span className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4" /> {file.name}
                </span>
              ) : (
                <>
                  <span className="text-sm">点击选择文件</span>
                  <span className="text-xs text-muted-foreground">支持 TXT / Markdown（PDF/DOCX 需安装可选依赖）</span>
                </>
              )}
              <input
                type="file"
                accept=".txt,.md,.markdown,.pdf,.docx,text/plain"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div>
              <div className="mb-2 text-sm font-medium">剧本类型</div>
              <div className="grid grid-cols-3 gap-2">
                {SCRIPT_TYPES.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setScriptType(k)}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm transition-colors",
                      scriptType === k ? "border-primary bg-primary/15 text-primary" : "border-border bg-background/35 hover:bg-secondary"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button onClick={handleParse} disabled={!file || parsing} className="w-full" size="lg">
              {parsing ? <><Loader2 className="h-4 w-4 animate-spin" /> 正在解析剧本…</> : "解析剧本"}
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card className="script-art-soft border-primary/25">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {result.title}
                <Badge className={theme.badgeClass}>{theme.label}</Badge>
                <Badge variant="secondary">{result.characterCount} 角色</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{result.publicStory}</p>
              <div className="space-y-1.5">
                {result.characters.map((c: any) => (
                  <div key={c.name} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                    <span className="font-medium">{c.name}</span>
                    {c.isMurderer && <Badge variant="destructive">凶手</Badge>}
                    {c.isVictim && <Badge variant="outline">受害者</Badge>}
                    <span className="text-xs text-muted-foreground">{c.occupation}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {result.warnings?.length > 0 && (
            <Card className="border-amber-500/40">
              <CardContent className="space-y-1 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
                  <AlertTriangle className="h-4 w-4" /> 解析提示（已自动兜底，可进入游戏后正常体验）
                </div>
                <ul className="ml-6 list-disc text-xs text-muted-foreground">
                  {result.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="border-primary/20">
            <CardHeader><CardTitle className="text-sm">选择玩家模式</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(["ROLE_PLAY", "DETECTIVE"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPlayerMode(m)}
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left text-sm",
                    playerMode === m ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/35 hover:bg-secondary"
                  )}
                >
                  {m === "ROLE_PLAY" ? "角色扮演模式" : "侦探模式"}
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setResult(null)}>重新上传</Button>
            <Button className="flex-1" onClick={handleStart} disabled={starting} size="lg">
              {starting ? <><Loader2 className="h-4 w-4 animate-spin" /> 进入游戏…</> : "开始游戏"}
            </Button>
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
