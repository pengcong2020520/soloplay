import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export function PhaseIndicator({
  phases,
  current,
}: {
  phases: { id: number; name: string }[];
  current: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {phases.map((p) => {
        const done = p.id < current;
        const active = p.id === current;
        return (
          <div
            key={p.id}
            className={cn(
              "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs transition-colors",
              active && "border-primary/30 bg-primary/15 text-primary shadow-[0_0_22px_rgba(var(--case-gold-rgb),0.08)]",
              done && "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-emerald-500/50 text-emerald-400",
                !active && !done && "border-border text-muted-foreground"
              )}
            >
              {done ? <Check className="h-3 w-3" /> : p.id}
            </span>
            <span className={cn(active && "font-medium")}>{p.name}</span>
          </div>
        );
      })}
    </div>
  );
}
