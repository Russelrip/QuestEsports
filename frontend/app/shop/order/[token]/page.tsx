import { redirect } from "next/navigation";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = {
  ...buildNoIndexMetadata(
    "Order Status",
    "View your Quest merchandise order.",
    "/shop/order"
  ),
  referrer: "no-referrer" as const,
};

export default async function LegacyShopOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/shop/order#token=${encodeURIComponent(token)}`);
}
