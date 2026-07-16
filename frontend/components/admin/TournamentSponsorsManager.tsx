"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminRequest } from "@/lib/admin";
import type { TournamentSponsor } from "@/lib/tournaments";
import { buildApiUrl } from "@/lib/api";

export default function TournamentSponsorsManager({ tournamentId }: { tournamentId: string }) {
  const [items, setItems] = useState<TournamentSponsor[]>([]);
  const [name, setName] = useState("");
  const [partnershipLabel, setPartnershipLabel] = useState("Official Sponsor");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [displayOrder, setDisplayOrder] = useState("100");
  const [logo, setLogo] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => setItems((await adminRequest<{ sponsors: TournamentSponsor[] }>(`/api/admin/tournaments/${tournamentId}/sponsors`)).sponsors);
  useEffect(() => { void adminRequest<{ sponsors: TournamentSponsor[] }>(`/api/admin/tournaments/${tournamentId}/sponsors`).then((data) => setItems(data.sponsors)).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load sponsors.")); }, [tournamentId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = new FormData();
    body.append("name", name); body.append("partnershipLabel", partnershipLabel); body.append("websiteUrl", websiteUrl); body.append("displayOrder", displayOrder);
    if (logo) body.append("logo", logo);
    try {
      await adminRequest(`/api/admin/tournaments/${tournamentId}/sponsors`, { method: "POST", body });
      setName(""); setPartnershipLabel("Official Sponsor"); setWebsiteUrl(""); setDisplayOrder("100"); setLogo(null); setMessage("Sponsor added."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add sponsor."); }
  };
  return <Card className="p-6 sm:p-8">
    <h3 className="text-2xl text-white">Sponsors</h3>
    <p className="mt-1 text-sm text-slate-400">Sponsors are displayed in ascending order with their partnership label, logo, and name.</p>
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
      {items.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        {item.logoUrl ? <Image src={buildApiUrl(item.logoUrl)} alt="" width={64} height={48} className="h-12 w-16 object-contain" /> : <div className="h-12 w-16 rounded-lg bg-white/5" />}
        <div className="min-w-0 flex-1"><p className="truncate text-white">{item.name}</p><p className="truncate text-xs text-cyan-200/75">{item.partnershipLabel || "Official Sponsor"}</p><p className="text-xs text-slate-500">Order {item.displayOrder}</p></div>
        <Button variant="danger" onClick={async () => { if (!confirm(`Remove ${item.name}?`)) return; await adminRequest(`/api/admin/tournaments/${tournamentId}/sponsors/${item.id}`, { method: "DELETE" }); await load(); }}>Remove</Button>
      </div>)}
    </div>
  </Card>;
}
