import { notFound } from "next/navigation";
import PageLayout from "@/components/PageLayout";
import TicketCheckout from "@/components/tickets/TicketCheckout";
import { Container } from "@/components/ui/container";
import { ApiRequestError } from "@/lib/api";
import { fetchTicketedEvent } from "@/lib/tickets";

export default async function TicketEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let event;
  try {
    event = await fetchTicketedEvent(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }
  return (
    <PageLayout title={event.title} description={event.description}>
      <section className="py-10">
        <Container>
          <div className="mb-8 max-w-3xl">
            <p className="text-sm leading-7 text-slate-300">
              {event.description}
            </p>
            <p className="mt-3 text-sm text-purple-100">
              {event.venue} ·{" "}
              {new Date(event.startsAt).toLocaleString("en-LK", {
                timeZone: "Asia/Colombo",
              })}
            </p>
          </div>
          <TicketCheckout event={event} />
        </Container>
      </section>
    </PageLayout>
  );
}
