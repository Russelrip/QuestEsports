import { PageTransition } from "@/components/ui/page-transition";
import PageHeader from "@/components/PageHeader";

type PageLayoutProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  eyebrow?: string;
  showEyebrow?: boolean;
};

export default function PageLayout({
  title,
  children,
}: PageLayoutProps) {
  return (
    <PageTransition>
      <PageHeader title={title} />
      {children}
    </PageTransition>
  );
}
