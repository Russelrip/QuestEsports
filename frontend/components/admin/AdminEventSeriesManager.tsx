"use client";

import { FormEvent, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminRequest } from "@/lib/admin";
import type { EventSeries } from "@/lib/tournaments";

const empty = { title: "", slug: "", description: "", displayOrder: "100", isPublished: false };

export default function AdminEventSeriesManager() {
  const [items, setItems] = useState<EventSeries[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [hero, setHero] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const load = async () => setItems((await adminRequest<{ series: EventSeries[] }>("/api/admin/event-series")).series);
  useEffect(() => { const initialLoad = async () => { try { setItems((await adminRequest<{ series: EventSeries[] }>("/api/admin/event-series")).series); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load series."); } }; void initialLoad(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    try {
      const body = new FormData(); Object.entries(form).forEach(([key, value]) => body.append(key, String(value))); if (hero) body.append("heroImage", hero);
      await adminRequest(editing ? `/api/admin/event-series/${editing}` : "/api/admin/event-series", { method: editing ? "PATCH" : "POST", body });
      setForm(empty); setEditing(null); setHero(null); setMessage("Event series saved."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save event series."); }
  };
  return <AdminShell title="Event Series" description="Group related tournaments beneath a published event identity and hero.">
    <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <Card className="p-6"><h3 className="text-2xl text-white">{editing ? "Edit series" : "New series"}</h3><form onSubmit={submit} className="mt-5 grid gap-4">
        <Input required placeholder="Quest Ascension" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input required placeholder="quest-ascension" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <Textarea required placeholder="Series description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} />
        <FormField label="Series hero artwork" hint="PNG, JPG, or WebP · Max 10 MB · Recommended 1600 × 600 px (8:3).">
          <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setHero(e.target.files?.[0] || null)} />
        </FormField>
        <label className="flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} /> Published</label>
        {message ? <p className="text-sm text-slate-300">{message}</p> : null}<div className="flex gap-2"><Button type="submit">Save series</Button>{editing ? <Button type="button" variant="ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</Button> : null}</div>
      </form></Card>
      <div className="grid gap-4">{items.map((item) => <Card key={item.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">{item.isPublished ? "Published" : "Draft"}</p><h3 className="mt-2 text-xl text-white">{item.title}</h3><p className="mt-2 text-sm text-slate-400">/{item.slug} · {item.tournaments.length} tournaments</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => { setEditing(item.id); setForm({ title: item.title, slug: item.slug, description: item.description, displayOrder: String(item.displayOrder), isPublished: item.isPublished }); }}>Edit</Button><Button variant="danger" onClick={async () => { if (!confirm(`Delete ${item.title}?`)) return; try { await adminRequest(`/api/admin/event-series/${item.id}`, { method: "DELETE" }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete event series."); } }}>Delete</Button></div></div></Card>)}</div>
    </div>
  </AdminShell>;
}
