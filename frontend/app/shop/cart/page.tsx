import CartCheckout from "@/components/shop/CartCheckout";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";

export default function CartPage() {
  return <PageLayout title="Shopping Cart" description="Review merchandise and complete checkout."><section className="py-10"><Container><CartCheckout /></Container></section></PageLayout>;
}
