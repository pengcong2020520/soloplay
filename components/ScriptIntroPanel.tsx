"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DifficultyLabel, ScriptTypeLabel } from "@/lib/constants";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";
import { BookOpen, Check, Loader2, Sparkles, Users } from "lucide-react";

export interface ScriptIntroCharacter {
  id: string;
  name: string;
  gender?: string | null;
  occupation?: string | null;
  publicProfile: string;
  isPlayerSlot?: boolean;
  avatarUrl?: string;
}

export interface ScriptIntroData {
  id: string;
  title: string;
  scriptType: string;
  difficulty: string;
  characterCount: number;
  estimatedDuration: number;
  publicStory: string;
  characters?: ScriptIntroCharacter[];
}

export function ScriptIntroPanel({
  script,
  starting,
  onStart,
}: {
  script: ScriptIntroData;
  starting: boolean;
  onStart: (mode: "ROLE_PLAY" | "DETECTIVE", playerCharacterId?: string) => void;
}) {
  const playableCharacters = useMemo(
    () => (script.characters ?? []).filter((c) => c.publicProfile),
    [script.characters]
  );
  const defaultCharacterId =
    playableCharacters.find((c) => c.isPlayerSlot)?.id ?? playableCharacters[0]?.id;
  const [playerMode, setPlayerMode] = useState<"ROLE_PLAY" | "DETECTIVE">("ROLE_PLAY");
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>(defaultCharacterId);

  const selectedCharacter =
    playableCharacters.find((c) => c.id === selectedCharacterId) ?? playableCharacters[0];
  const theme = useMemo(
    () => getScriptTheme(script.scriptType, script.title),
    [script.scriptType, script.title]
  );

  return (
    <div className="script-art-soft mt-4 space-y-4 rounded-md border border-primary/30 p-4" style={scriptThemeStyle(theme)}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={theme.badgeClass}>{theme.label}</Badge>
        <Badge variant="secondary">
          {ScriptTypeLabel[script.scriptType as keyof typeof ScriptTypeLabel] ?? script.scriptType}
        </Badge>
        <Badge variant="outline">
          {DifficultyLabel[script.difficulty as keyof typeof DifficultyLabel] ?? script.difficulty}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {script.characterCount} 人 · 约 {script.estimatedDuration} 分钟
        </span>
      </div>

      <div className="rounded-md border border-border/70 bg-background/55 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
          <BookOpen className="h-4 w-4 text-primary" />
          剧本初步介绍
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {script.publicStory}
        </p>
      </div>

      <div className="rounded-md border border-border/70 bg-background/55 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          选择玩家模式
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setPlayerMode("ROLE_PLAY")}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-all",
              playerMode === "ROLE_PLAY"
                ? "border-primary bg-primary/15 text-primary"
                : "border-border bg-background/70 hover:-translate-y-0.5 hover:bg-secondary"
            )}
          >
            <div className="flex items-center justify-between gap-2 font-medium">
              角色扮演模式
              {playerMode === "ROLE_PLAY" && <Check className="h-4 w-4" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              选择一个角色入局，持有秘密和胜利条件。
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPlayerMode("DETECTIVE")}
            className={cn(
              "rounded-md border px-3 py-2 text-left text-sm transition-all",
              playerMode === "DETECTIVE"
                ? "border-primary/50 bg-secondary text-foreground"
                : "border-border bg-background/70 hover:-translate-y-0.5 hover:bg-secondary"
            )}
          >
            <div className="font-medium">侦探模式</div>
            <p className="mt-1 text-xs text-muted-foreground">
              不占用角色身份，从外部视角审讯所有人。
            </p>
          </button>
        </div>
      </div>

      {playerMode === "ROLE_PLAY" && playableCharacters.length > 0 && (
        <div className="rounded-md border border-border/70 bg-background/55 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Users className="h-4 w-4 text-primary" />
            选择你的角色
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {playableCharacters.map((character) => (
              <button
                key={character.id}
                type="button"
                onClick={() => setSelectedCharacterId(character.id)}
                className={cn(
                  "flex min-h-[92px] gap-3 rounded-md border p-3 text-left transition-all",
                  selectedCharacter?.id === character.id
                    ? "border-primary bg-background/90"
                    : "border-border bg-background/70 hover:-translate-y-0.5 hover:bg-secondary"
                )}
              >
                <Avatar src={character.avatarUrl} name={character.name} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {character.name}
                    {character.isPlayerSlot && <Badge variant="secondary">默认</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {character.gender ? `${character.gender} · ` : ""}
                    {character.occupation ?? "身份待揭晓"}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {character.publicProfile}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={starting}
          onClick={() =>
            onStart(playerMode, playerMode === "ROLE_PLAY" ? selectedCharacter?.id : undefined)
          }
        >
          {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          开始游戏
        </Button>
        <span className="self-center text-xs text-muted-foreground">
          开局后 DM 会先介绍剧本背景与在场人物。
        </span>
      </div>
    </div>
  );
}

function Avatar({ src, name }: { src?: string; name: string }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-secondary text-xs font-semibold">
      {src ? (
        <img src={src} alt={`${name}头像`} className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1)
      )}
    </div>
  );
}
