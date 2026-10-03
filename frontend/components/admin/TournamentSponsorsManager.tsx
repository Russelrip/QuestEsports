"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminRequest } from "@/lib/admin";
import SponsorRow from "@/components/admin/SponsorRow";
import type { TournamentSponsor } from "@/lib/tournaments";

// Manages either a tournament's sponsors or a whole event's: the two share one
// row shape and differ only in the admin endpoint.
type SponsorOwner = { tournamentId: string; eventId?: never } | { eventId: string; tournamentId?: never };

export default function TournamentSponsorsManager({ tournamentId, eventId }: SponsorOwner) {
  const sponsorsPath = eventId ? `/api/admin/events/${eventId}/sponsors` : `/api/admin/tournaments/${tournamentId}/sponsors`;
  const [items, setItems] = useState<TournamentSponsor[]>([]);
  const [name, setName] = useState("");
  const [partnershipLabel, setPartnershipLabel] = useState("Official Sponsor");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [displayOrder, setDisplayOrder] = useState("100");
  const [logo, setLogo] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [promoting, setPromoting] = useState(false);
  const load = async () => setItems((await adminRequest<{ sponsors: TournamentSponsor[] }>(sponsorsPath)).sponsors);
  useEffect(() => { void adminRequest<{ sponsors: TournamentSponsor[] }>(sponsorsPath).then((data) => setItems(data.sponsors)).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load sponsors.")); }, [sponsorsPath]);
  // Most events run one sponsor lineup across every game. Pulling the child
  // rows up leaves one row per brand to maintain, and loses nothing: an event
  // sponsor already shows on each of its tournaments' pages.
  const promote = async () => {
    if (!confirm("Move every sponsor set on this event's tournaments onto the event itself? The tournament entries are removed, and event sponsors already show on every tournament page.")) return;
    setPromoting(true);
    try {
      const { message: result } = await adminRequest<{ message: string }>(`${sponsorsPath}/promote`, { method: "POST" });
      setMessage(result);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to move tournament sponsors."); }
    finally { setPromoting(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = new FormData();
    body.append("name", name); body.append("partnershipLabel", partnershipLabel); body.append("websiteUrl", websiteUrl); body.append("displayOrder", displayOrder);
    if (logo) body.append("logo", logo);
    try {
      await adminRequest(sponsorsPath, { method: "POST", body });
      setName(""); setPartnershipLabel("Official Sponsor"); setWebsiteUrl(""); setDisplayOrder("100"); setLogo(null); setMessage("Sponsor added."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add sponsor."); }
  };
  return <Card className="p-6 sm:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 className="text-2xl text-white">Sponsors</h3>
      {eventId ? <Button type="button" variant="secondary" disabled={promoting} onClick={promote}>{promoting ? "Moving…" : "Move tournament sponsors here"}</Button> : null}
    </div>
    <p className="mt-1 text-sm text-slate-400">{eventId ? "Event sponsors lead the sponsor belt on the public event page and show on every tournament under this event, ahead of any sponsors set on the tournament itself. " : "If this tournament belongs to an event, that event's sponsors already show on its page and do not need repeating here. "}Sponsors are displayed in ascending order with their partnership label, logo, and name.</p>
    <form onSubmit={submit} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Input required placeholder="Sponsor name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input required maxLength={80} placeholder="Official PC Partner" value={partnershipLabel} onChange={(event) => setPartnershipLabel(event.target.value)} />
      <Input type="url" placeholder="https://sponsor.example" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
      <Input type="number" min="0" value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} />
      <div>
        <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogo(event.target.files?.[0] || null)} />
        <p className="mt-2 text-xs text-slate-400">PNG, JPG, or WebP · Max 5 MB · Recommended 800 × 400 px with a transparent background.</p>
      </div>
      <Button type="submit">Add sponsor</Button>
    </form>
    {message ? <p className="mt-3 text-sm text-slate-300">{message}</p> : null}
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <SponsorRow key={item.id} sponsor={item} sponsorsPath={sponsorsPath} onChanged={load} onMessage={setMessage} />
      ))}
    </div>
  </Card>;
}
