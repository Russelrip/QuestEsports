import { Card } from "@/components/ui/card";

export function LoadingState({
  title = "Loading",
  description = "Please wait while we fetch the latest data.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto mb-5 size-10 animate-spin rounded-full border-2 border-white/10 border-t-cyan-300" />
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </Card>
  );
}
