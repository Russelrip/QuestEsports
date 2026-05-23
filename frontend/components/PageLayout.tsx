import { PageTransition } from "@/components/ui/page-transition";
import PageHeader from "@/components/PageHeader";

type PageLayoutProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  eyebrow?: string;
};

export default function PageLayout({ title, description, children, eyebrow }: PageLayoutProps) {
  return (
    <PageTransition>
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      {children}
    </PageTransition>
  );
}
