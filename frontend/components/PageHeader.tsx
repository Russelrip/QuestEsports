import { Container } from "@/components/ui/container";

type PageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  showEyebrow?: boolean;
};

export default function PageHeader({
  title,
  description,
  eyebrow = "Quest Esports",
  showEyebrow = true,
}: PageHeaderProps) {
  return (
    <section className="page-header">
      <Container className="relative z-10">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-8 sm:py-16">
          {showEyebrow ? (
            <p className="text-xs font-medium uppercase tracking-[0.3em] text-cyan-100/70">
              {eyebrow}
            </p>
          ) : null}
          <h1 className={`${showEyebrow ? "mt-6" : ""} text-4xl leading-none text-white sm:text-5xl lg:text-6xl`}>
            {title}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm text-slate-300 sm:text-base">{description}</p>
        </div>
      </Container>
    </section>
  );
}
