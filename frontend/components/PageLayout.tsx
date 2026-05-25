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
  description,
  children,
  eyebrow,
  showEyebrow = true,
}: PageLayoutProps) {
  return (
    <PageTransition>
      <PageHeader
        title={title}
        description={description}
        eyebrow={eyebrow}
        showEyebrow={showEyebrow}
      />
      {children}
    </PageTransition>
  );
}
