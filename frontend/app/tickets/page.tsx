import { permanentRedirect } from "next/navigation";

export default async function TicketsPage() {
  permanentRedirect("/tournaments");
}
