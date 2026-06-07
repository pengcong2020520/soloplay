import type { PhaseConfig, GeneratedPhase } from "@/types/game";
import type { ScriptType } from "@/lib/constants";
import { DEDUCTION_PHASES } from "./deduction";
import { HARDCORE_PHASES } from "./hardcore";
import { EMOTIONAL_PHASES } from "./emotional";
import { COMEDY_PHASES } from "./comedy";
import { HORROR_PHASES } from "./horror";
import { RESTORATION_PHASES } from "./restoration";

/** 各剧本类型的内置阶段模板（6 种全部实现差异化阶段结构）。 */
const TEMPLATES: Record<ScriptType, PhaseConfig[]> = {
  DEDUCTION: DEDUCTION_PHASES,
  HARDCORE: HARDCORE_PHASES,
  EMOTIONAL: EMOTIONAL_PHASES,
  COMEDY: COMEDY_PHASES,
  HORROR: HORROR_PHASES,
  RESTORATION: RESTORATION_PHASES,
};

export function getPhaseTemplate(scriptType: ScriptType): PhaseConfig[] {
  return TEMPLATES[scriptType] ?? DEDUCTION_PHASES;
}

/**
 * 解析运行时阶段配置。
 *
 * 阶段结构（名称/流程/权限/机制）由【剧本类型模板】决定，这是 PRD §5 的规则——
 * 模板名称与该阶段的 permissions/dmTriggers 一一对应，是机制的"锚点"，必须权威。
 * AI 生成的 phaseConfig 只用作时长提示（estimatedMinutes），其阶段名称仅在
 * 与模板"语义同位"（同索引且模板未声明特殊机制）时作为补充，避免跨类型串味
 * （例如恐怖本被生成器的"投票指凶"名称覆盖，丢失"逃脱判定"语义）。
 */
export function resolvePhaseConfig(
  scriptType: ScriptType,
  generated?: GeneratedPhase[] | null
): PhaseConfig[] {
  const template = getPhaseTemplate(scriptType);
  if (!generated || generated.length === 0) return template;

  return template.map((tpl, i) => {
    const g = generated[i];
    if (!g) return tpl;
    // 仅采纳时长提示；名称/描述以模板为准，确保与机制一致、不跨类型串味
    return {
      ...tpl,
      estimatedMinutes: g.estimatedMinutes || tpl.estimatedMinutes,
    };
  });
}
