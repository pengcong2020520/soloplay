"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScriptTypeLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { Loader2 } from "lucide-react";

interface ReplayData {
  title: string;
  scriptType: string;
  publicStory: string;
  murderSummary: string | null;
  playerMode: string;
  characters: any[];
  clueCards: any[];
  messages: any[];
  votes: any[];
  consistencyIssues?: {
    senderName: string;
    phase: number;
    content: string;
    detail: string;
    against: string;
    severity: number;
  }[];
}

type Section = "truth" | "characters" | "transcript" | "votes" | "consistency" | "feedback";

const FAV_ELEMENTS = [
  { key: "DEDUCTION", label: "推理过程" },
  { key: "CHARACTER_DEPTH", label: "角色互动" },
  { key: "PLOT_TWIST", label: "剧情反转" },
  { key: "ATMOSPHERE", label: "沉浸氛围" },
];
const DIFF_FEEL = [
  { key: "TOO_EASY", label: "太简单" },
  { key: "JUST_RIGHT", label: "刚好" },
  { key: "BIT_HARD", label: "有点难" },
  { key: "TOO_HARD", label: "太难" },
];

export default function ReplayClient({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReplayData | null>(null);
  const [section, setSection] = useState<Section>("truth");

  // 反馈表单状态
  const [rating, setRating] = useState(0);
  const [favs, setFavs] = useState<string[]>([]);
  const [diffFeel, setDiffFeel] = useState<string>("");
  const [wantMore, setWantMore] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [rec, setRec] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/game/${sessionId}/replay`)
      .then((r) => r.json())
      .then(setData);
  }, [sessionId]);

  async function submitFeedback() {
    await fetch(`/api/game/${sessionId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: rating || undefined,
        favoriteElements: favs,
        difficultyFeel: diffFeel || undefined,
        wantMore: wantMore ?? undefined,
        comment: comment || undefined,
      }),
    });
    const r = await fetch(`/api/game/${sessionId}/recommend`).then((x) => x.json());
    setRec(r);
    setSubmitted(true);
  }

  const toggleFav = (k: string) =>
    setFavs((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 正在揭开真相…
      </div>
    );
  }

  const channelLabel = (key: string, type: string) => {
    if (type !== "PRIVATE") return "公共大厅";
    return key === "public" ? "公共" : `私聊 · ${key}`;
  };
  const theme = getScriptTheme(data.scriptType, data.title);

  return (
    <main className="case-page px-6 py-10" style={scriptThemeStyle(theme)}>
      <div className="mx-auto max-w-4xl">
      <div className="case-panel mb-6 flex items-center justify-between rounded-lg p-5">
        <div>
          <h1 className="case-serif flex items-center gap-2 text-2xl font-bold">
            复盘揭秘
            <Badge className={theme.badgeClass}>{theme.label}</Badge>
            <Badge variant="secondary">{ScriptTypeLabel[data.scriptType as keyof typeof ScriptTypeLabel] ?? data.scriptType}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{data.title}</p>
        </div>
        <Button variant="ghost" onClick={() => router.push("/")}>← 大厅</Button>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto">
        <SecBtn active={section === "truth"} onClick={() => setSection("truth")}>真相揭示</SecBtn>
        <SecBtn active={section === "characters"} onClick={() => setSection("characters")}>全角色剧本</SecBtn>
        <SecBtn active={section === "transcript"} onClick={() => setSection("transcript")}>对话回放</SecBtn>
        <SecBtn active={section === "votes"} onClick={() => setSection("votes")}>投票记录</SecBtn>
        {(data.consistencyIssues?.length ?? 0) > 0 && (
          <SecBtn active={section === "consistency"} onClick={() => setSection("consistency")}>
            穿帮检测 ({data.consistencyIssues!.length})
          </SecBtn>
        )}
        <SecBtn active={section === "feedback"} onClick={() => setSection("feedback")}>体验反馈</SecBtn>
      </div>

      {section === "truth" && (
        <div className="space-y-4">
          <Card className="script-art-soft border-primary/40">
            <CardHeader><CardTitle>案情真相</CardTitle></CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{data.murderSummary ?? "（无真相记录）"}</p>
            </CardContent>
          </Card>
          <Card className="border-primary/20">
            <CardHeader><CardTitle className="text-sm">胜负分析</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.characters.map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.isMurderer && <Badge variant="destructive">凶手</Badge>}
                    {c.assignedTo === "PLAYER" && <Badge variant="success">你</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.victoryAchieved === true && <Badge variant="success">胜利</Badge>}
                    {c.victoryAchieved === false && <Badge variant="outline">失败</Badge>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {section === "characters" && (
        <div className="space-y-3">
          {data.characters.map((c) => (
            <Card key={c.name} className="border-primary/20">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  {c.name}
                  {c.isMurderer && <Badge variant="destructive">凶手</Badge>}
                  {c.assignedTo === "PLAYER" && <Badge variant="success">你</Badge>}
                  <span className="text-xs font-normal text-muted-foreground">{c.occupation}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Field label="私密背景" body={c.privateStory} />
                <Field label="秘密" body={c.secrets} />
                <Field label="隐藏目标" body={c.hiddenGoal} />
                <Field label="胜利条件" body={c.victoryCondition} />
                {c.victoryReason && <Field label="结果" body={c.victoryReason} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {section === "transcript" && (
        <Card className="script-art-soft border-primary/25">
          <CardContent className="space-y-1.5 p-4">
            {data.messages.map((m) => (
              <div key={m.id} className="case-transcript-row rounded-md px-3 py-2 text-sm">
                <span className="text-[11px] text-muted-foreground">[{channelLabel(m.channelKey, m.channelType)}] </span>
                <span className="font-medium">{m.senderName}：</span>
                <span className="text-muted-foreground">{m.content}</span>
                {m.consistency?.contradicts && (
                  <span
                    className="ml-1 cursor-help text-[11px] text-amber-600 dark:text-amber-400"
                    title={`穿帮（${m.consistency.against === "SCRIPT" ? "与私密剧本设定" : "与之前发言"}矛盾）：${m.consistency.detail}`}
                  >
                    ⚠️穿帮
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {section === "votes" && (
        <Card className="border-primary/20">
          <CardContent className="space-y-2 p-4">
            {data.votes.length === 0 ? (
              <p className="text-sm text-muted-foreground">本局没有投票记录。</p>
            ) : (
              data.votes.map((v, i) => (
                <div key={i} className="rounded-md border border-border p-2 text-sm">
                  <span className="font-medium">{v.voterName}</span> → 投给 <span className="font-medium text-primary">{v.targetName}</span>
                  <p className="text-[11px] text-muted-foreground">{v.reason}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {section === "consistency" && (
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">角色穿帮检测</CardTitle>
            <p className="text-xs text-muted-foreground">
              AI 自动标注的、角色发言与其私密剧本设定或自己先前公开发言相矛盾之处（策略性说谎不计入）。
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {(data.consistencyIssues?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">本局未检测到角色穿帮。</p>
            ) : (
              data.consistencyIssues!.map((issue, i) => (
                <div key={i} className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{issue.senderName}</span>
                    <Badge variant="outline">阶段 {issue.phase}</Badge>
                    <Badge variant="secondary">
                      {issue.against === "SCRIPT" ? "与剧本设定矛盾" : "与前言矛盾"}
                    </Badge>
                    {issue.severity >= 3 && <Badge variant="destructive">严重</Badge>}
                  </div>
                  <p className="mt-1 text-muted-foreground">「{issue.content}」</p>
                  <p className="mt-1 text-amber-700 dark:text-amber-400">⚠️ {issue.detail}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {section === "feedback" && (
        <div className="space-y-4">
          {!submitted ? (
            <Card className="border-primary/20">
              <CardHeader><CardTitle>本局体验如何？</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="mb-2 text-sm font-medium">整体体验评分</div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? "opacity-100" : "opacity-30"}`}>⭐</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">最喜欢的环节（可多选）</div>
                  <div className="flex flex-wrap gap-2">
                    {FAV_ELEMENTS.map((e) => (
                      <button key={e.key} onClick={() => toggleFav(e.key)} className={`rounded-full border px-3 py-1 text-xs ${favs.includes(e.key) ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-secondary"}`}>{e.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">难度感受</div>
                  <div className="flex flex-wrap gap-2">
                    {DIFF_FEEL.map((d) => (
                      <button key={d.key} onClick={() => setDiffFeel(d.key)} className={`rounded-md border px-3 py-1.5 text-sm ${diffFeel === d.key ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-secondary"}`}>{d.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">还想再玩同类剧本吗？</div>
                  <div className="flex gap-2">
                    <button onClick={() => setWantMore(true)} className={`rounded-md border px-4 py-1.5 text-sm ${wantMore === true ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-secondary"}`}>想</button>
                    <button onClick={() => setWantMore(false)} className={`rounded-md border px-4 py-1.5 text-sm ${wantMore === false ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-secondary"}`}>换换口味</button>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-sm font-medium">留言（可选）</div>
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="说点什么…" />
                </div>
                <Button className="w-full" onClick={submitFeedback}>提交反馈</Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="script-art-soft border-primary/40">
              <CardHeader><CardTitle>感谢反馈！为你推荐下一局</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {rec?.experienceSummary && <p className="text-muted-foreground">你的剧本杀品味：{rec.experienceSummary}</p>}
                <p>下次推荐：<span className="font-semibold text-primary">{rec?.recommendedTypeLabel}</span></p>
                <p className="text-muted-foreground">{rec?.reason}</p>
                {rec?.exploreSuggestion && (
                  <p className="text-muted-foreground">你可能也会喜欢 <span className="text-primary">{rec.exploreSuggestion.label}</span>，不妨拓展一下体验边界。</p>
                )}
                <div className="flex gap-2 pt-2">
                  <Button onClick={() => router.push(`/setup?intent=${rec?.recommendedType ?? "DEDUCTION"}`)}>开始推荐剧本</Button>
                  <Button variant="outline" onClick={() => router.push("/")}>返回大厅</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      </div>
    </main>
  );
}

function SecBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">{label}：</span>
      <span className="whitespace-pre-wrap leading-relaxed">{body}</span>
    </div>
  );
}
