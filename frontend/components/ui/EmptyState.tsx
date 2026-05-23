import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
};

export default function EmptyState({
  title = "Nothing here yet",
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("p-10 text-center", className)}>
      {children}
      {title ? <h2 className="text-2xl font-semibold text-white">{title}</h2> : null}
      {description ? <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400">{description}</p> : null}
    </Card>
  );
}
