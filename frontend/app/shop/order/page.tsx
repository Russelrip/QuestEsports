import PageLayout from "@/components/PageLayout";
import ShopOrderStatus from "@/components/shop/ShopOrderStatus";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = {
  ...buildNoIndexMetadata(
    "Order Status",
    "View your Quest merchandise order.",
    "/shop/order"
  ),
  referrer: "no-referrer" as const,
};

export default function ShopOrderPage() {
  return (
    <PageLayout title="Order Status" description="View your Quest merchandise order.">
      <section className="py-10">
        <Container>
          <ShopOrderStatus />
        </Container>
      </section>
    </PageLayout>
  );
}
