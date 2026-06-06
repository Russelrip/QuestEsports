import PageLayout from "@/components/PageLayout";
import ShopContent from "@/components/shop/ShopContent";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Shop",
  description: defaultPageDescriptions.shop,
  path: "/shop",
  keywords: [
    "Quest Esports merch",
    "esports T-shirts Sri Lanka",
    "gaming apparel Sri Lanka",
  ],
});

export default function ShopPage() {
  return (
    <PageLayout
      title="Quest Shop"
      description={defaultPageDescriptions.shop}
      eyebrow="Official Merchandise"
    >
      <ShopContent />
    </PageLayout>
  );
}
