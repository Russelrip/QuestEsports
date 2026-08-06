import PageLayout from "@/components/PageLayout";
import TicketOrderStatus from "@/components/tickets/TicketOrderStatus";
import { Container } from "@/components/ui/container";
import { buildNoIndexMetadata } from "@/lib/site";

export const metadata = {
  ...buildNoIndexMetadata(
    "Your Tickets",
    "View your private Quest QR tickets.",
    "/tickets/order",
  ),
  referrer: "no-referrer" as const,
};
export default function TicketOrderPage() {
  return (
    <PageLayout title="Your Tickets" description="View your Quest QR tickets.">
      <section className="py-10">
        <Container>
          <TicketOrderStatus />
        </Container>
      </section>
    </PageLayout>
  );
}
