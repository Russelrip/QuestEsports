type PageHeaderProps = {
  title: string;
  description: string;
};

export default function PageHeader({
  title,
  description,
}: PageHeaderProps) {
  return (
    // Shared hero-style heading for inner pages so titles and descriptions stay consistent.
    <section className="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
