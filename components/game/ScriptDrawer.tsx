"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RichMessageText } from "@/components/game/RichMessageText";
import { cn } from "@/lib/utils";
import { BookOpen, X } from "lucide-react";

export type ScriptReaderSection = "overview" | "profile" | "private" | "secret" | "goal" | "story";

export function ScriptDrawer({
  open,
  onClose,
  activeSection,
  onSectionChange,
  scriptTitle,
  publicStory,
  playerCharacter,
}: {
  open: boolean;
  onClose: () => void;
  activeSection: ScriptReaderSection;
  onSectionChange: (section: ScriptReaderSection) => void;
  scriptTitle: string;
  publicStory: string;
  playerCharacter: {
    name: string;
    gender: string | null;
    occupation: string | null;
    publicProfile: string;
    privateStory: string;
    secrets: string;
    hiddenGoal: string;
    victoryCondition: string;
  } | null;
}) {
  if (!open) return null;
  const sections = getReaderSections(Boolean(playerCharacter));
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <aside className="case-panel pointer-events-auto absolute bottom-[13rem] left-3 right-3 top-16 flex flex-col overflow-hidden rounded-lg shadow-2xl sm:left-auto sm:w-[460px] xl:right-[19rem]">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-primary" />
              剧本随身册
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{scriptTitle}</div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} title="关闭剧本">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionChange(section.id)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-xs transition-colors",
                activeSection === section.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {section.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {renderSection(activeSection, playerCharacter, publicStory)}
        </div>
      </aside>
    </div>
  );
}

function getReaderSections(hasPlayerCharacter: boolean): { id: ScriptReaderSection; label: string }[] {
  if (!hasPlayerCharacter) {
    return [
      { id: "overview", label: "全部" },
      { id: "story", label: "案情" },
      { id: "goal", label: "目标" },
    ];
  }
  return [
    { id: "overview", label: "全部" },
    { id: "profile", label: "身份" },
    { id: "private", label: "背景" },
    { id: "secret", label: "秘密" },
    { id: "goal", label: "目标" },
    { id: "story", label: "案情" },
  ];
}

function renderSection(
  section: ScriptReaderSection,
  playerCharacter: {
    name: string;
    gender: string | null;
    occupation: string | null;
    publicProfile: string;
    privateStory: string;
    secrets: string;
    hiddenGoal: string;
    victoryCondition: string;
  } | null,
  publicStory: string
) {
  if (!playerCharacter) {
    if (section === "goal") {
      return <ScriptBlock title="侦探目标" body="查明真相，并在投票阶段做出判断。" highlight />;
    }
    if (section === "story") {
      return <ScriptBlock title="公共故事" body={publicStory} />;
    }
    return (
      <>
        <section className="rounded-md border border-primary/25 bg-primary/5 p-3">
          <div className="text-sm font-semibold">侦探模式</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            你没有固定角色身份，可自由审讯、展示线索并提交最终判断。
          </p>
        </section>
        <ScriptBlock title="侦探目标" body="查明真相，并在投票阶段做出判断。" highlight />
        <ScriptBlock title="公共故事" body={publicStory} />
      </>
    );
  }

  const identityHeader = (
    <section className="rounded-md border border-primary/25 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-base font-semibold">{playerCharacter.name}</div>
        {playerCharacter.gender && <Badge variant="secondary">{playerCharacter.gender}</Badge>}
        {playerCharacter.occupation && <Badge variant="outline">{playerCharacter.occupation}</Badge>}
      </div>
    </section>
  );

  switch (section) {
    case "profile":
      return (
        <>
          {identityHeader}
          <ScriptBlock title="公开身份" body={playerCharacter.publicProfile} />
        </>
      );
    case "private":
      return <ScriptBlock title="私密背景" body={playerCharacter.privateStory} />;
    case "secret":
      return <ScriptBlock title="你的秘密" body={playerCharacter.secrets} warning />;
    case "goal":
      return (
        <>
          <ScriptBlock title="隐藏目标" body={playerCharacter.hiddenGoal} />
          <ScriptBlock title="胜利条件" body={playerCharacter.victoryCondition} highlight />
        </>
      );
    case "story":
      return <ScriptBlock title="公共故事" body={publicStory} />;
    default:
      return (
        <>
          {identityHeader}
          <ScriptBlock title="公开身份" body={playerCharacter.publicProfile} />
          <ScriptBlock title="私密背景" body={playerCharacter.privateStory} />
          <ScriptBlock title="你的秘密" body={playerCharacter.secrets} warning />
          <ScriptBlock title="隐藏目标" body={playerCharacter.hiddenGoal} />
          <ScriptBlock title="胜利条件" body={playerCharacter.victoryCondition} highlight />
          <ScriptBlock title="公共故事" body={publicStory} />
        </>
      );
  }
}

function ScriptBlock({
  title,
  body,
  highlight,
  warning,
}: {
  title: string;
  body: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <section className="rounded-md border border-border bg-background/35 p-3">
      <div className={highlight ? "text-sm font-semibold text-primary" : warning ? "text-sm font-semibold text-amber-400" : "text-sm font-semibold"}>
        {title}
      </div>
      <RichMessageText text={body} className="mt-2 text-sm leading-relaxed text-muted-foreground" />
    </section>
  );
}
