import { notFound } from "next/navigation";
import DynamicRulebookContent from "@/components/rulebook/DynamicRulebookContent";
import PageLayout from "@/components/PageLayout";
import { fetchRulebookBySlug, type Rulebook } from "@/lib/rulebooks";
import { buildPageMetadata } from "@/lib/site";

type RulebookPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: RulebookPageProps) {
  try {
    const { slug } = await params;
    const rulebook = await fetchRulebookBySlug(slug);
    return buildPageMetadata({
      title: rulebook.title,
      description: `${rulebook.game} tournament rules for Quest Esports events.`,
      path: `/rulebooks/${rulebook.slug}`,
    });
  } catch {
    return {};
  }
}

export default async function RulebookPage({ params }: RulebookPageProps) {
  let rulebook: Rulebook;

  try {
    const { slug } = await params;
    rulebook = await fetchRulebookBySlug(slug);
  } catch {
    notFound();
  }

  return (
    <PageLayout
      title={rulebook.title}
      description={`${rulebook.game} tournament rules and competitive guidelines.`}
      eyebrow="Tournament Rulebook"
    >
      <DynamicRulebookContent rulebook={rulebook} />
    </PageLayout>
  );
}
