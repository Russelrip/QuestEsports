import CartCheckout from "@/components/shop/CartCheckout";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Shopping Cart",
  "Review merchandise and complete checkout.",
  "/shop/cart"
);

export default function CartPage() {
  return <PageLayout title="Shopping Cart" description="Review merchandise and complete checkout."><section className="py-10"><Container><CartCheckout /></Container></section></PageLayout>;
}
