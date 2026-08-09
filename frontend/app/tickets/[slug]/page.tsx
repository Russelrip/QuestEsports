import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import PageLayout from "@/components/PageLayout";
import StructuredData from "@/components/StructuredData";
import TicketCheckout from "@/components/tickets/TicketCheckout";
import { Container } from "@/components/ui/container";
import { ApiRequestError } from "@/lib/api";
import {
  buildBreadcrumbStructuredData,
  buildNoIndexMetadata,
  buildPageMetadata,
  buildTicketEventStructuredData,
} from "@/lib/site";
import { fetchTicketedEvent } from "@/lib/tickets";

const getTicketedEvent = cache(fetchTicketedEvent);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  try {
    const event = await getTicketedEvent(slug);
    return buildPageMetadata({
      title: event.title,
      description: event.description,
      path: `/tickets/${event.slug}`,
      type: "article",
      keywords: [
        event.title,
        `${event.title} tickets`,
        "Quest E-sports event tickets",
        "gaming events Sri Lanka",
      ],
    });
  } catch {
    return buildNoIndexMetadata(
      "Event Not Found",
      "This ticketed event could not be found.",
      `/tickets/${slug}`,
    );
  }
}

export default async function TicketEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let event;
  try {
    event = await getTicketedEvent(slug);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }
  return (
    <>
      <StructuredData data={buildTicketEventStructuredData(event)} />
      <StructuredData
        data={buildBreadcrumbStructuredData([
          { name: "Home", path: "/" },
          { name: "Tickets", path: "/tickets" },
          { name: event.title, path: `/tickets/${event.slug}` },
        ])}
      />
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
    </>
  );
}
