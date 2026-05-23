import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/container";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
};

export default function PageHeader({ title, description, eyebrow = "Quest Esports" }: PageHeaderProps) {
  return (
    <section className="page-header">
      <Container className="relative z-10">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-8 sm:py-16">
          <Badge className="border-cyan-300/20 bg-cyan-400/10 text-cyan-100">{eyebrow}</Badge>
          <h1 className="mt-6 text-4xl leading-none text-white sm:text-5xl lg:text-6xl">{title}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm text-slate-300 sm:text-base">{description}</p>
        </div>
      </Container>
    </section>
  );
}
