"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DifficultyLabel, ScriptTypeLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { Clock, Library, Loader2, Users, Wand2 } from "lucide-react";
import type { GenerationParams } from "@/types/game";
import { ScriptIntroPanel, type ScriptIntroCharacter } from "@/components/ScriptIntroPanel";

type Choice = { value: string; label: string };

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

const SCRIPT_TYPES: Choice[] = [
  { value: "DEDUCTION", label: "推理本" },
  { value: "HARDCORE", label: "硬核本" },
  { value: "EMOTIONAL", label: "情感本" },
  { value: "COMEDY", label: "欢乐本" },
  { value: "HORROR", label: "恐怖本" },
  { value: "RESTORATION", label: "还原本" },
];
const ERAS = ["古代", "民国", "现代", "近未来", "架空奇幻", "赛博朋克", "末世"];
const LOCATIONS = ["密室", "庄园", "邮轮", "学校", "医院", "古镇", "太空站", "荒岛"];
const DIFFICULTIES: Choice[] = [
  { value: "BEGINNER", label: "新手友好" },
  { value: "INTERMEDIATE", label: "进阶" },
  { value: "HARDCORE", label: "硬核烧脑" },
];
const THEMES = ["家庭伦理", "商业阴谋", "爱恨情仇", "校园青春", "职场争斗", "历史改编", "政治权谋"];
const PLAYER_ROLES = ["随机分配", "我是凶手", "我是受害者家属", "我是侦探/目击者"];
const TONES = ["轻松欢乐", "严肃烧脑", "催泪悲情", "惊悚恐怖", "浪漫唯美"];
const ELEMENTS = ["超自然", "失忆", "双重身份", "连环案", "穿越"];

function OptionGrid({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: Choice[] | string[];
  value: string;
  onChange: (v: string) => void;
  cols?: number;
}) {
  const norm = (options as any[]).map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  ) as Choice[];
  return (
    <div className={cn("grid gap-2", cols === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {norm.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md border px-3 py-2 text-sm transition-all",
            value === o.value
              ? "border-primary bg-primary/15 text-primary"
              : "border-border bg-background/25 hover:-translate-y-0.5 hover:bg-secondary"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function SetupWizard() {
  const router = useRouter();
  const sp = useSearchParams();
  const intent = sp.get("intent") ?? "DEDUCTION";

  const [params, setParams] = useState<GenerationParams>({
    scriptType: (["DEDUCTION", "HARDCORE", "EMOTIONAL", "COMEDY", "HORROR", "RESTORATION"].includes(
      intent
    )
      ? intent
      : "DEDUCTION") as any,
    era: "民国",
    location: "庄园",
    characterCount: 5,
    duration: "中（~2h）",
    difficulty: "INTERMEDIATE" as any,
    clueDensity: "适中",
    narrativeStructure: "线性单线",
    writingStyle: "现代白话",
    emotionalTone: "严肃烧脑",
    theme: "商业阴谋",
    specialElements: [],
    twistType: "单次大翻转",
    endingType: "唯一真相",
    playerRoleType: "随机分配",
    relationshipComplexity: "适中",
    customCharacterRequirements: "",
    specialMechanics: [],
    contentRestrictions: [],
  });

  const [playerMode, setPlayerMode] = useState<"ROLE_PLAY" | "DETECTIVE">("ROLE_PLAY");
  const [step, setStep] = useState(0);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [scripts, setScripts] = useState<BuiltinScript[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(true);
  const [startingScriptId, setStartingScriptId] = useState<string | null>(null);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoadingScripts(true);
    fetch("/api/script/builtin")
      .then((r) => r.json())
      .then((d) => {
        if (alive) setScripts(d.scripts ?? []);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message || "剧本库加载失败");
      })
      .finally(() => {
        if (alive) setLoadingScripts(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const sortedScripts = useMemo(() => {
    return [...scripts].sort((a, b) => {
      const aMatch = a.scriptType === intent ? 0 : 1;
      const bMatch = b.scriptType === intent ? 0 : 1;
      return aMatch - bMatch;
    });
  }, [intent, scripts]);

  const set = (patch: Partial<GenerationParams>) => setParams((p) => ({ ...p, ...patch }));
  const toggleElement = (el: string) =>
    setParams((p) => ({
      ...p,
      specialElements: p.specialElements.includes(el)
        ? p.specialElements.filter((x) => x !== el)
        : [...p.specialElements, el],
    }));

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const genRes = await fetch("/api/script/generate/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!genRes.ok) throw new Error((await genRes.json()).error ?? "生成失败");
      const { scriptId } = await genRes.json();

      const createRes = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, playerMode }),
      });
      if (!createRes.ok) throw new Error((await createRes.json()).error ?? "创建会话失败");
      const { sessionId } = await createRes.json();

      router.push(`/game/${sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setGenerating(false);
    }
  }

  async function startBuiltinGame(
    scriptId: string,
    mode: "ROLE_PLAY" | "DETECTIVE",
    playerCharacterId?: string
  ) {
    setStartingScriptId(scriptId);
    setError(null);
    try {
      const createRes = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId, playerMode: mode, playerCharacterId }),
      });
      const data = await createRes.json();
      if (!createRes.ok || !data.sessionId) {
        throw new Error(data.error ?? "创建会话失败");
      }
      router.push(`/game/${data.sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setStartingScriptId(null);
    }
  }

  const steps = [
    {
      title: "第一步 · 基础框架",
      body: (
        <div className="space-y-5">
          <Field label="剧本类型">
            <OptionGrid options={SCRIPT_TYPES} value={params.scriptType} onChange={(v) => set({ scriptType: v as any })} />
          </Field>
          <Field label="时代背景">
            <OptionGrid options={ERAS} value={params.era} onChange={(v) => set({ era: v })} />
          </Field>
          <Field label="地点场景">
            <OptionGrid options={LOCATIONS} value={params.location} onChange={(v) => set({ location: v })} />
          </Field>
          <Field label="角色数量（含你自己）">
            <OptionGrid
              options={["3", "4", "5", "6", "7", "8"]}
              value={String(params.characterCount)}
              onChange={(v) => set({ characterCount: Number(v) })}
            />
          </Field>
        </div>
      ),
    },
    {
      title: "第二步 · 叙事与风格",
      body: (
        <div className="space-y-5">
          <Field label="难度">
            <OptionGrid options={DIFFICULTIES} value={params.difficulty} onChange={(v) => set({ difficulty: v as any })} />
          </Field>
          <Field label="线索密度">
            <OptionGrid options={["稀疏（强推理）", "适中", "密集（信息量大）"]} value={params.clueDensity} onChange={(v) => set({ clueDensity: v })} />
          </Field>
          <Field label="叙事结构">
            <OptionGrid options={["线性单线", "多线并行", "回忆录式"]} value={params.narrativeStructure} onChange={(v) => set({ narrativeStructure: v })} />
          </Field>
          <Field label="情感基调">
            <OptionGrid options={TONES} value={params.emotionalTone} onChange={(v) => set({ emotionalTone: v })} />
          </Field>
        </div>
      ),
    },
    {
      title: "第三步 · 主题与角色",
      body: (
        <div className="space-y-5">
          <Field label="主题类型">
            <OptionGrid options={THEMES} value={params.theme} onChange={(v) => set({ theme: v })} />
          </Field>
          <Field label="翻转设计">
            <OptionGrid options={["无翻转", "单次大翻转", "多次小翻转"]} value={params.twistType} onChange={(v) => set({ twistType: v })} />
          </Field>
          <Field label="你的角色身份">
            <OptionGrid options={PLAYER_ROLES} value={params.playerRoleType} onChange={(v) => set({ playerRoleType: v })} />
          </Field>
          <Field label="特殊元素（可多选）">
            <div className="flex flex-wrap gap-2">
              {ELEMENTS.map((el) => (
                <button
                  key={el}
                  type="button"
                  onClick={() => toggleElement(el)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    params.specialElements.includes(el)
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border hover:bg-secondary"
                  )}
                >
                  {el}
                </button>
              ))}
            </div>
          </Field>
          <Field label="特定角色要求（可选）">
            <Input
              value={params.customCharacterRequirements}
              onChange={(e) => set({ customCharacterRequirements: e.target.value })}
              placeholder="如：有一个角色是我的前任 / 有一对姐妹"
            />
          </Field>
        </div>
      ),
    },
    {
      title: "第四步 · 选择玩家模式",
      body: (
        <div className="space-y-3">
          <ModeCard
            active={playerMode === "ROLE_PLAY"}
            onClick={() => setPlayerMode("ROLE_PLAY")}
            title="角色扮演模式"
            desc="持有完整角色剧本，有秘密要守护、有胜利条件要达成。AI 角色把你当作同场竞技的对手。"
            tag="推荐：想深度代入"
          />
          <ModeCard
            active={playerMode === "DETECTIVE"}
            onClick={() => setPlayerMode("DETECTIVE")}
            title="侦探模式"
            desc="以外来侦探身份进入，自由审讯任何角色，不受身份约束，专注破案。"
            tag="推荐：专注找真相"
          />
        </div>
      ),
    },
  ];

  if (!showCustomForm) {
    return (
      <ScriptSelection
        intent={intent}
        scripts={sortedScripts}
        loading={loadingScripts}
        startingScriptId={startingScriptId}
        selectedScriptId={selectedScriptId}
        error={error}
        onBack={() => router.push("/")}
        onStart={startBuiltinGame}
        onSelect={(scriptId) => setSelectedScriptId((current) => (current === scriptId ? null : scriptId))}
        onCustom={() => {
          setError(null);
          setShowCustomForm(true);
        }}
      />
    );
  }

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Wrapper>
      <div className="mb-4 flex items-center justify-between">
        <Badge variant="secondary">
          {step + 1} / {steps.length}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => router.push("/")}>
          返回
        </Button>
      </div>
      <Card className="border-primary/25">
        <CardHeader>
          <CardTitle>{current.title}</CardTitle>
        </CardHeader>
        <CardContent>{current.body}</CardContent>
      </Card>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="mt-5 flex justify-between gap-3">
        <Button
          variant="outline"
          disabled={generating}
          onClick={() => {
            if (step === 0) {
              setShowCustomForm(false);
              return;
            }
            setStep((s) => s - 1);
          }}
        >
          {step === 0 ? "返回剧本选择" : "上一步"}
        </Button>
        {isLast ? (
          <Button onClick={handleGenerate} disabled={generating} size="lg">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> 正在生成剧本…</> : "生成剧本并开始"}
          </Button>
        ) : (
          <Button onClick={() => setStep((s) => s + 1)} disabled={generating}>
            下一步
          </Button>
        )}
      </div>
    </Wrapper>
  );
}

function ScriptSelection({
  intent,
  scripts,
  loading,
  startingScriptId,
  selectedScriptId,
  error,
  onBack,
  onStart,
  onSelect,
  onCustom,
}: {
  intent: string;
  scripts: BuiltinScript[];
  loading: boolean;
  startingScriptId: string | null;
  selectedScriptId: string | null;
  error: string | null;
  onBack: () => void;
  onStart: (scriptId: string, mode: "ROLE_PLAY" | "DETECTIVE", playerCharacterId?: string) => void;
  onSelect: (scriptId: string) => void;
  onCustom: () => void;
}) {
  return (
    <main className="case-page px-6 py-10">
      <div className="mx-auto max-w-5xl">
      <div className="case-panel mb-6 flex flex-col gap-4 rounded-lg p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="case-kicker mb-2 px-3 py-1 text-xs">
            <Library className="h-3.5 w-3.5" />
            测试剧本库
          </div>
          <h1 className="case-serif text-2xl font-bold">先选择一个剧本</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            这些剧本已提前写入本地库，开局不会触发实时生成。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCustom}>
            <Wand2 className="h-4 w-4" />
            临时定制
          </Button>
          <Button variant="ghost" onClick={onBack}>
            返回大厅
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> 正在载入测试剧本…
        </div>
      ) : scripts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            测试剧本库暂时为空。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {scripts.map((script) => {
            const isStarting = startingScriptId === script.id;
            const recommended = script.scriptType === intent;
            const theme = getScriptTheme(script.scriptType, script.title);
            return (
              <Card key={script.id} className="script-card case-card-hover min-h-[276px]" style={scriptThemeStyle(theme)}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {script.title}
                    {recommended && <Badge>推荐</Badge>}
                    <Badge className={theme.badgeClass}>{theme.label}</Badge>
                    <Badge variant="secondary">
                      {ScriptTypeLabel[script.scriptType as keyof typeof ScriptTypeLabel] ?? script.scriptType}
                    </Badge>
                    <Badge variant="outline">
                      {DifficultyLabel[script.difficulty as keyof typeof DifficultyLabel] ?? script.difficulty}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {script.characterCount} 人
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      约 {script.estimatedDuration} 分钟
                    </span>
                  </div>
                  <p className="mb-4 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                    {script.publicStory}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={selectedScriptId === script.id ? "secondary" : "default"}
                      disabled={Boolean(startingScriptId)}
                      onClick={() => onSelect(script.id)}
                    >
                      {isStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      {selectedScriptId === script.id ? "收起介绍" : "查看简介与选角"}
                    </Button>
                  </div>
                  {selectedScriptId === script.id && (
                    <ScriptIntroPanel
                      script={script}
                      starting={isStarting}
                      onStart={(mode, playerCharacterId) => onStart(script.id, mode, playerCharacterId)}
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

function Wrapper({ children }: { children: React.ReactNode }) {
  return <main className="case-page px-6 py-12"><div className="mx-auto max-w-2xl">{children}</div></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  desc,
  tag,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  tag: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-4 text-left transition-all",
        active ? "border-primary bg-primary/10" : "border-border bg-background/25 hover:-translate-y-0.5 hover:bg-secondary"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{title}</span>
        {tag && <Badge variant="default">{tag}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </button>
  );
}
