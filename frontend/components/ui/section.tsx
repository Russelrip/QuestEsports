import { cn } from "@/lib/utils";
import { Container } from "@/components/ui/container";

export function Section({
  className,
  children,
  containerClassName,
}: {
  className?: string;
  children: React.ReactNode;
  containerClassName?: string;
}) {
  return (
    <section className={cn("py-16 sm:py-20", className)}>
      <Container className={containerClassName}>{children}</Container>
    </section>
  );
}
