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
        <div className="grid gap-6 lg:grid-cols-[0.78fr_1.22fr]">
          <Card className="flex flex-col justify-between p-6 sm:p-8">
            <div>
              <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">{eyebrow}</Badge>
              <h2 className="mt-5 text-3xl text-white sm:text-4xl">{title}</h2>
              <p className="mt-4 max-w-md text-sm leading-7 text-slate-300">{description}</p>
            </div>
            <div className="mt-8 grid gap-4">
              <div className="rounded-[24px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Why it matters</p>
                <p className="mt-3 text-sm text-slate-300">
                  Registrations, team invites, and account recovery all rely on the same session and verification layer.
                </p>
              </div>
              {aside}
            </div>
          </Card>
          <Card className="p-6 sm:p-8">{children}</Card>
        </div>
      </Container>
    </section>
  );
}
