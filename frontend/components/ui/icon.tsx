import { navIconPaths, type NavIconKey } from "@/lib/icons";
import { cn } from "@/lib/utils";

export const Icon = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg
    viewBox="0 0 20 20"
    className={cn("size-4 shrink-0", className)}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const NavIcon = ({ icon, className }: { icon: NavIconKey; className?: string }) => (
  <Icon className={className}>
    <path d={navIconPaths[icon]} />
  </Icon>
);
