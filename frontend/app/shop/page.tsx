import PageLayout from "@/components/PageLayout";
import ShopContent from "@/components/shop/ShopContent";
import { fetchProducts } from "@/lib/shop";
import { buildPageMetadata, defaultPageDescriptions } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Shop",
  description: defaultPageDescriptions.shop,
  path: "/shop",
  keywords: [
    "Quest E-sports merch",
    "e-sports T-shirts Sri Lanka",
    "gaming apparel Sri Lanka",
  ],
});

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  const products = await fetchProducts();
  return (
    <PageLayout
      title="Quest Shop"
      description={defaultPageDescriptions.shop}
      eyebrow="Official Merchandise"
    >
      <ShopContent products={products} />
    </PageLayout>
  );
}
