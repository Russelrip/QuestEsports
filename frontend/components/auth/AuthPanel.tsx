import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Badge } from "@/components/ui/badge";

export default function AuthPanel({
  title,
  description,
  children,
  eyebrow = "Account Access",
  aside,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  eyebrow?: string;
  aside?: React.ReactNode;
}) {
  return (
    <section className="py-8 sm:py-12">
      <Container>
        <div className="mx-auto max-w-xl">
          <Card className="relative overflow-hidden border-slate-800/90 bg-[linear-gradient(180deg,rgba(9,14,29,0.98),rgba(5,8,18,0.99))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)] sm:p-8">
            <div className="pointer-events-none absolute inset-x-8 top-0 h-32 rounded-full bg-red-500/8 blur-3xl" />
            <div className="relative">
              <div className="flex flex-col items-center text-center">
                <Badge className="border-red-400/20 bg-red-500/10 text-red-100">{eyebrow}</Badge>
                <h2 className="mt-5 text-3xl text-white sm:text-4xl">{title}</h2>
                <p className="mt-3 max-w-md text-sm leading-7 text-slate-400">{description}</p>
              </div>

              <div className="mt-8">{children}</div>

              {aside ? <div className="mt-6">{aside}</div> : null}
            </div>
          </Card>
        </div>
      </Container>
    </section>
  );
}
