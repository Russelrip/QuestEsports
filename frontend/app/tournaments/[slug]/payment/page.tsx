import { notFound } from "next/navigation";
import PaymentStatusCard from "@/components/payments/PaymentStatusCard";
import PageLayout from "@/components/PageLayout";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = buildNoIndexMetadata(
  "Tournament Payment",
  "Confirm your tournament payment status.",
  "/tournaments/payment"
);

export default async function TournamentPaymentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ order?: string }> }) {
  const { slug } = await params;
  const { order } = await searchParams;
  if (!order) notFound();
  return <PageLayout title="Tournament Payment" description="Confirming your tournament payment."><section className="py-10"><Container><PaymentStatusCard orderId={order} returnHref={`/tournaments/${slug}`} /></Container></section></PageLayout>;
}
