"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getScriptTheme, scriptThemeStyle } from "@/lib/script-themes";

interface Rec {
  recommendedType: string;
  recommendedTypeLabel: string;
  reason: string;
  experienceSummary: string | null;
  exploreSuggestion: { type: string; label: string } | null;
}

/** 首页个性化推荐横幅：仅当有历史偏好时显示。 */
export function RecommendBanner() {
  const [rec, setRec] = useState<Rec | null>(null);

  useEffect(() => {
    fetch("/api/user/recommend")
      .then((r) => r.json())
      .then((d) => {
        // 只有真正形成了偏好摘要才展示，避免首次进入空泛提示
        if (d?.experienceSummary) setRec(d);
      })
      .catch(() => {});
  }, []);

  if (!rec) return null;
  const theme = getScriptTheme(rec.recommendedType);

  return (
    <Link href={`/setup?intent=${rec.recommendedType}`}>
      <div className="script-art-soft mb-6 flex items-start gap-3 rounded-lg border border-primary/30 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/60" style={scriptThemeStyle(theme)}>
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="text-sm">
          <div className="font-medium text-primary">
            为你推荐：{rec.recommendedTypeLabel}
          </div>
          <p className="mt-0.5 text-muted-foreground">{rec.reason}</p>
          {rec.exploreSuggestion && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              也可以试试 {rec.exploreSuggestion.label}，拓展体验边界。
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
