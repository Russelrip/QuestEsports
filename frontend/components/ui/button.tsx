import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border border-fuchsia-300/35 bg-[linear-gradient(135deg,rgba(139,92,246,0.98),rgba(59,130,246,0.9))] text-white shadow-[0_20px_50px_rgba(91,33,182,0.32),0_0_0_1px_rgba(255,255,255,0.04)_inset] hover:brightness-110 hover:shadow-[0_24px_60px_rgba(91,33,182,0.42)]",
  secondary:
    "border border-white/14 bg-white/[0.035] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-fuchsia-300/30 hover:bg-white/[0.07]",
  ghost:
    "border border-transparent bg-transparent text-slate-200 hover:border-white/10 hover:bg-white/6 hover:text-white",
  danger:
    "border border-red-400/25 bg-red-500/12 text-red-100 hover:bg-red-500/20",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-10 rounded-xl px-4 text-sm",
  md: "h-11 rounded-2xl px-5 text-sm",
  lg: "h-12 rounded-2xl px-6 text-sm",
};

export const buttonClassName = ({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) =>
  cn(
    "inline-flex items-center justify-center gap-2 font-semibold tracking-[0.01em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-60",
    variantClasses[variant],
    sizeClasses[size],
    className
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref
) {
  return <button ref={ref} className={buttonClassName({ variant, size, className })} {...props} />;
});
