import { cn } from "@/lib/utils";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  errorId?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // `content-start` keeps the label and control packed at the top of the
    // cell. Without it the auto rows absorb whatever extra height a side-by-side
    // sibling gives the row, so a field carrying a hint or an error silently
    // pushes its neighbour's input out of alignment.
    <div className={cn("grid min-w-0 content-start gap-2", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-200">
        {label}
        {required ? <span className="ml-1 text-purple-300">*</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
      {error ? <p id={errorId} role="alert" className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
