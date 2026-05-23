import { cn } from "@/lib/utils";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-200">
        {label}
        {required ? <span className="ml-1 text-cyan-300">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
