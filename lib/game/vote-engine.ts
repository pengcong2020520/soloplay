import type { Vote } from "@prisma/client";
import type { VoteResultRow } from "@/types/game";

/**
 * 汇总投票：按被投目标分组计数，得票最多者为"众矢之的"。
 * 平票时返回多个并列。
 */
export function tallyVotes(votes: Pick<Vote, "targetId" | "targetName" | "voterName" | "reason">[]): {
  results: VoteResultRow[];
  topTargetIds: string[];
  topTargetName: string | null;
} {
  const map = new Map<string, VoteResultRow>();

  for (const v of votes) {
    if (!v.targetId) continue;
    let row = map.get(v.targetId);
    if (!row) {
      row = { targetId: v.targetId, targetName: v.targetName, count: 0, voters: [] };
      map.set(v.targetId, row);
    }
    row.count += 1;
    row.voters.push({ name: v.voterName, reason: v.reason });
  }

  const results = Array.from(map.values()).sort((a, b) => b.count - a.count);
  const maxCount = results[0]?.count ?? 0;
  const top = results.filter((r) => r.count === maxCount && maxCount > 0);

  return {
    results,
    topTargetIds: top.map((r) => r.targetId),
    topTargetName: top.length === 1 ? top[0].targetName : null,
  };
}
