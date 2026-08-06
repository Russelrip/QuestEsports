import PageLayout from "@/components/PageLayout";
import TicketEventsList from "@/components/tickets/TicketEventsList";
import { Container } from "@/components/ui/container";
import { fetchTicketedEvents } from "@/lib/tickets";
import { buildPageMetadata } from "@/lib/site";

export const metadata = buildPageMetadata({
  title: "Event Tickets",
  description: "Buy official Quest E-sports entrance tickets.",
  path: "/tickets",
});

export default async function TicketsPage() {
  const events = await fetchTicketedEvents();
  return (
    <PageLayout
      title="Event Tickets"
      description="Official Quest event entrance tickets."
    >
      <section className="py-10">
        <Container>
          <TicketEventsList events={events} />
        </Container>
      </section>
    </PageLayout>
  );
}
