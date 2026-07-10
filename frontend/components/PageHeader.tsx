import { Container } from "@/components/ui/container";

type PageHeaderProps = {
  title: string;
};

export default function PageHeader({ title }: PageHeaderProps) {
  return (
    <section className="page-header">
      <Container className="relative z-10">
        <div className="mx-auto max-w-4xl px-2 py-2 text-center sm:px-8 sm:py-3">
          <h1 className="text-4xl leading-none text-white sm:text-5xl lg:text-6xl">
            {title}
          </h1>
        </div>
      </Container>
    </section>
  );
}
