import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HAS_API_KEY } from "@/lib/anthropic";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { Brain, Clock3, HeartHandshake, History, Library, PartyPopper, Search, Skull, Sparkles, Upload, Wand2 } from "lucide-react";
import { RecommendBanner } from "@/components/RecommendBanner";
import { AuthWidget } from "@/components/AuthWidget";

const INTENTS = [
  { key: "DEDUCTION", icon: Brain, label: "烧脑推理", desc: "雨夜庄园，享受解谜的快感" },
  { key: "EMOTIONAL", icon: HeartHandshake, label: "情感共鸣", desc: "灯塔来信，沉浸故事与告别" },
  { key: "COMEDY", icon: PartyPopper, label: "轻松欢乐", desc: "年会翻车，制造混乱与笑点" },
  { key: "HORROR", icon: Skull, label: "惊悚刺激", desc: "祠堂红绳，肾上腺素拉满" },
  { key: "RESTORATION", icon: Clock3, label: "还原真相", desc: "列车旧票，重建时间线" },
];

export default function Home() {
  return (
    <main className="case-page px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="case-kicker px-4 py-1.5 text-sm">
            <Sparkles className="h-4 w-4" />
            AI 剧本杀大厅
          </div>
          <AuthWidget />
        </div>

        <section className="case-rise mb-8 grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="case-panel rounded-lg p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge>今晚开局</Badge>
              {!HAS_API_KEY && <Badge variant="outline">Mock 模式可玩</Badge>}
            </div>
            <h1 className="case-hero-title text-4xl font-black leading-tight sm:text-5xl">
              选一个感觉，直接入局。
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              DM 会推进阶段，AI 角色会试探、隐瞒、争辩。你只需要决定今晚想要哪种剧本杀体验。
            </p>
            {!HAS_API_KEY && (
              <p className="mt-3 text-xs text-amber-300/85">
                当前未配置模型密钥，会使用内置样例剧本和 mock 角色发言跑完整流程。
              </p>
            )}
          </div>

          <div className="script-art rounded-lg border border-primary/25 p-5">
            <div className="text-sm font-semibold text-primary">案桌提示</div>
            <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
              <div className="rounded-md border border-border bg-background/55 p-3">先从剧本库开局最稳，所有内置剧本都有主题背景。</div>
              <div className="rounded-md border border-border bg-background/55 p-3">想定制则进入测试剧本选择后点「临时定制」。</div>
              <div className="rounded-md border border-border bg-background/55 p-3">游戏中公共大厅、私聊、复盘都会沿用当前剧本视觉。</div>
            </div>
          </div>
        </section>

        <RecommendBanner />

        <section className="mb-8">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="case-serif text-xl font-bold">你今天想要什么体验？</h2>
              <p className="mt-1 text-sm text-muted-foreground">选择后会优先展示同类型剧本。</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {INTENTS.map((i) => {
              const Icon = i.icon;
              const theme = getScriptTheme(i.key);
              return (
                <Link key={i.key} href={`/setup?intent=${i.key}`}>
                  <Card className="script-card case-card-hover h-full min-h-[172px] cursor-pointer" style={scriptThemeStyle(theme)}>
                    <CardContent className="flex h-full flex-col justify-between p-4">
                      <div className="flex items-center justify-between">
                        <span className="flex h-10 w-10 items-center justify-center rounded-md border border-primary/35 bg-background/60">
                          <Icon className="h-5 w-5 text-primary" />
                        </span>
                        <Badge className={theme.badgeClass}>{theme.label}</Badge>
                      </div>
                      <div>
                        <div className="text-base font-semibold">{i.label}</div>
                        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{i.desc}</div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="case-serif mb-3 text-xl font-bold">开局入口</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link href="/library">
              <Card className="case-card-hover h-full cursor-pointer">
                <CardHeader>
                  <Library className="mb-1 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">内置剧本库</CardTitle>
                  <CardDescription>精选预置剧本，无需生成，挑一个直接开玩。</CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/setup">
              <Card className="case-card-hover h-full cursor-pointer">
                <CardHeader>
                  <Wand2 className="mb-1 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">测试剧本选择</CardTitle>
                  <CardDescription>从 6 个预置测试剧本里挑一个，也可临时定制。</CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/setup?intent=DEDUCTION">
              <Card className="case-card-hover h-full cursor-pointer">
                <CardHeader>
                  <Search className="mb-1 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">推理本开局</CardTitle>
                  <CardDescription>优先展示推理测试本，适合快速验证完整流程。</CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/upload">
              <Card className="case-card-hover h-full cursor-pointer">
                <CardHeader>
                  <Upload className="mb-1 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">上传剧本</CardTitle>
                  <CardDescription>已有剧本？上传 TXT/MD，AI 自动解析。</CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Link href="/history">
              <Card className="case-card-hover h-full cursor-pointer">
                <CardHeader>
                  <History className="mb-1 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">历史游戏</CardTitle>
                  <CardDescription>回到过往的局，或查看复盘揭秘。</CardDescription>
                </CardHeader>
              </Card>
            </Link>
            <Card className="case-panel h-full">
              <CardHeader>
                <Sparkles className="mb-1 h-5 w-5 text-primary" />
                <CardTitle className="text-base">视觉规则已启用</CardTitle>
                <CardDescription>每类剧本都绑定本地背景图，对话区会自动换景。</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
