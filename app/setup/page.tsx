import { Suspense } from "react";
import SetupWizard from "./SetupWizard";

export default function SetupPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted-foreground">加载中…</div>}>
      <SetupWizard />
    </Suspense>
  );
}
