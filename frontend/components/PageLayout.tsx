import PageHeader from "@/components/PageHeader";

type PageLayoutProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

export default function PageLayout({
  title,
  description,
  children,
}: PageLayoutProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      {children}
    </>
  );
}
