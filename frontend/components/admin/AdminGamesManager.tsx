"use client";

import { FormEvent, useEffect, useState, type SyntheticEvent } from "react";
import Image from "next/image";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminRequest } from "@/lib/admin";
import { resolveImageUrl } from "@/lib/media";
import type { GameCategory } from "@/lib/tournaments";

const empty = { displayName: "", slug: "", displayOrder: "100", isPublished: false };
const handlePreviewError = (event: SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied === "true") image.style.display = "none";
  else {
    image.dataset.fallbackApplied = "true";
    image.src = "/images/logo.png";
  }
};

export default function AdminGamesManager() {
  const [items, setItems] = useState<GameCategory[]>([]); const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null); const [artwork, setArtwork] = useState<File | null>(null); const [logo, setLogo] = useState<File | null>(null); const [message, setMessage] = useState("");
  const load = async () => setItems((await adminRequest<{ categories: GameCategory[] }>("/api/admin/game-categories")).categories);
  useEffect(() => { void adminRequest<{ categories: GameCategory[] }>("/api/admin/game-categories").then((data) => setItems(data.categories)).catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load games.")); }, []);
  const submit = async (event: FormEvent) => { event.preventDefault(); const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.append(key, String(value))); if (artwork) body.append("artwork", artwork); if (logo) body.append("logo", logo); try { await adminRequest(editing ? `/api/admin/game-categories/${editing}` : "/api/admin/game-categories", { method: editing ? "PATCH" : "POST", body }); setForm(empty); setEditing(null); setArtwork(null); setLogo(null); setMessage("Game saved."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save game."); } };
  return <AdminShell title="Games" description="Manage the category strip artwork and detail-page game logos."><div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]"><Card className="p-6"><form onSubmit={submit} className="grid gap-4"><Input required placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /><Input required placeholder="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /><Input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} /><label className="text-sm text-slate-300">Category artwork<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setArtwork(e.target.files?.[0] || null)} /><span className="mt-2 block text-xs text-slate-400">PNG, JPG, or WebP · Max 10 MB · Recommended 1200 × 900 px (4:3).</span></label><label className="text-sm text-slate-300">Game logo<Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setLogo(e.target.files?.[0] || null)} /><span className="mt-2 block text-xs text-slate-400">PNG, JPG, or WebP · Max 10 MB · Recommended 800 × 450 px with a transparent background.</span></label><label className="flex gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />Published</label><div className="flex gap-2"><Button type="submit">Save game</Button>{editing ? <Button variant="ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</Button> : null}</div>{message ? <p className="text-sm text-slate-300">{message}</p> : null}</form></Card><div className="grid gap-4 sm:grid-cols-2">{items.map((item) => { const artworkUrl = resolveImageUrl(item.artworkUrl); const logoUrl = resolveImageUrl(item.logoUrl); return <Card key={item.id} className="overflow-hidden"><div className="relative aspect-[4/3] bg-black/30">{artworkUrl ? <Image src={artworkUrl} alt="" fill unoptimized className="object-contain" onError={handlePreviewError} /> : null}</div><div className="p-4"><div className="flex items-center gap-3">{logoUrl ? <Image src={logoUrl} alt="" width={48} height={40} unoptimized className="h-10 w-12 object-contain" onError={handlePreviewError} /> : null}<div><h3 className="text-lg text-white">{item.displayName}</h3><p className="text-xs text-slate-500">{item.tournamentCount || 0} tournaments · {item.isPublished ? "Published" : "Draft"}</p></div></div><div className="mt-4 flex gap-2"><Button variant="secondary" onClick={() => { setEditing(item.id); setForm({ displayName: item.displayName, slug: item.slug, displayOrder: String(item.displayOrder || 100), isPublished: Boolean(item.isPublished) }); }}>Edit</Button><Button variant="danger" onClick={async () => { if (!confirm(`Delete ${item.displayName}? Existing tournaments will keep their game text.`)) return; await adminRequest(`/api/admin/game-categories/${item.id}`, { method: "DELETE" }); await load(); }}>Delete</Button></div></div></Card>; })}</div></div></AdminShell>;
}
