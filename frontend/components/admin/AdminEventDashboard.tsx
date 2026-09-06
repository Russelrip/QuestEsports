"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AdminTableSkeleton } from "@/components/ui/skeleton";
import AdminRegistrationsManager from "@/components/admin/AdminRegistrationsManager";
import { useAdminEvents, useAdminTournamentOptions } from "@/hooks/api/useAdmin";
import { adminEventActionLabels, adminRequest, applyAdminEventMediaSelection, buildAdminEventFormData, getAdminEventArchiveLabel, initialAdminEventFormValues, type AdminEventFormValues } from "@/lib/admin";
import { useToastStore } from "@/hooks/useToastStore";
import { isoToSriLankaDateTimeLocal } from "@/lib/date-time";

const tabs = ["Overview", "Tournaments", "Registrations", "Settings"] as const;
type Tab = typeof tabs[number];

const mapEventToForm = (event: NonNullable<ReturnType<typeof useAdminEvents>["data"]>["events"][number]): AdminEventFormValues => ({
  ...initialAdminEventFormValues,
  slug: event.slug, title: event.title, description: event.description, shortName: event.shortName || "", subtitle: event.subtitle || "", shortDescription: event.shortDescription || "", displayOrder: event.displayOrder, isPublished: event.isPublished, featured: Boolean(event.featured), startDate: event.startDate ? isoToSriLankaDateTimeLocal(event.startDate) : "", endDate: event.endDate ? isoToSriLankaDateTimeLocal(event.endDate) : "", registrationOpenAt: event.registrationOpenAt ? isoToSriLankaDateTimeLocal(event.registrationOpenAt) : "", registrationCloseAt: event.registrationCloseAt ? isoToSriLankaDateTimeLocal(event.registrationCloseAt) : "", venue: event.venue || "", location: event.location || "", country: event.country || "", organizer: event.organizer || "", websiteUrl: event.websiteUrl || "", discordUrl: event.discordUrl || "", registrationStatusOverride: event.registrationStatusOverride || "", heroImage: null, bannerImage: null, removeHeroImage: false, removeBannerImage: false,
});

export default function AdminEventDashboard({ eventId, initialTab }: { eventId: string; initialTab?: Tab }) {
  const router = useRouter();
  const { data, loading, error, refetch } = useAdminEvents();
  const { data: tournamentOptions } = useAdminTournamentOptions();
  const event = data?.events.find((item) => item.id === eventId);
  const isNew = eventId === "new";
  const [tab, setTab] = useState<Tab>(initialTab || (isNew ? "Settings" : "Overview"));
  const [form, setForm] = useState<AdminEventFormValues>(() => event ? mapEventToForm(event) : initialAdminEventFormValues);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attachId, setAttachId] = useState("");
  const showToast = useToastStore((state) => state.showToast);

  useEffect(() => {
    if (!event) return;
    setForm(mapEventToForm(event));
  }, [event]);

  const update = <K extends keyof AdminEventFormValues>(key: K, value: AdminEventFormValues[K]) => setForm((current) => ({ ...current, [key]: value }));
  const save = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault(); setSaving(true);
    try {
      const response = await adminRequest<{ event: { id: string } }>(isNew ? "/api/admin/events" : `/api/admin/events/${eventId}`, { method: isNew ? "POST" : "PATCH", body: buildAdminEventFormData(form) });
      showToast({ tone: "success", title: isNew ? "Event created" : form.isPublished ? "Event published" : "Event updated" });
      router.push(`/admin/events/${response.event.id}`);
    } catch (nextError) {
      showToast({ tone: "error", title: "Unable to save event", description: nextError instanceof Error ? nextError.message : "Request failed." });
    } finally { setSaving(false); }
  };
  const archive = async () => {
    if (!event || !window.confirm(`${getAdminEventArchiveLabel(event.title)}? It will be hidden, but child tournaments remain available.`)) return;
    setBusy(true);
    try { await adminRequest(`/api/admin/events/${event.id}/archive`, { method: "POST" }); showToast({ tone: "success", title: "Event archived" }); await refetch(); }
    catch (nextError) { showToast({ tone: "error", title: "Unable to archive event", description: nextError instanceof Error ? nextError.message : "Request failed." }); }
    finally { setBusy(false); }
  };
  const attach = async () => {
    if (!event || !attachId) return; setBusy(true);
    try { const body = new FormData(); body.append("tournamentId", attachId); await adminRequest(`/api/admin/events/${event.id}/tournaments`, { method: "POST", body }); setAttachId(""); showToast({ tone: "success", title: "Tournament attached" }); await refetch(); }
    catch (nextError) { showToast({ tone: "error", title: "Unable to attach tournament", description: nextError instanceof Error ? nextError.message : "Request failed." }); }
    finally { setBusy(false); }
  };

  if (!isNew && loading) return <AdminShell title="Event dashboard" description="Loading event workspace."><AdminTableSkeleton rows={5} /></AdminShell>;
  if (!isNew && (error || !event)) return <AdminShell title="Event dashboard" description="The event could not be loaded."><EmptyState description={error || "Event not found."} /></AdminShell>;
  const title = event?.title || "New Event";
  return <AdminShell title={title} description={isNew ? "Create a public-ready event identity, then hand off its tournaments." : "Manage this event identity, child tournaments, and registration pulse."} actions={<div className="flex flex-wrap gap-2"><Link href="/admin/events" className={buttonClassName({ variant: "secondary" })}>All events</Link>{event ? <Link href={`/tournaments/events/${event.slug}`} target="_blank" className={buttonClassName({ variant: "secondary" })}>View public event</Link> : null}</div>}>
    {!isNew && event ? <><div className="grid grid-cols-2 gap-2 border-b border-white/10 sm:flex sm:flex-wrap">{tabs.map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)} className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${tab === item ? "border-purple-300 text-white" : "border-transparent text-slate-500 hover:text-white"}`}>{item}</button>)}</div>
      {tab === "Overview" ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Games", event.aggregate.games], ["Teams", event.aggregate.teamsRegistered], ["Players", event.aggregate.playersRegistered], ["Open slots", event.aggregate.availableSlots]].map(([label, value]) => <Card key={label} className="p-5"><p className="text-xs uppercase tracking-[.18em] text-slate-500">{label}</p><p className="mt-3 text-3xl text-white">{value}</p></Card>)}</div> : null}
      {tab === "Tournaments" ? <Card className="p-6 sm:p-8"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-2xl text-white">Child tournaments</h3><p className="text-sm text-slate-400">Keep each game’s rules in the normal tournament editor.</p></div><Link href={`/admin/tournaments/new?seriesId=${event.id}`} className={buttonClassName({})}>Add tournament</Link></div><div className="mb-6 flex flex-col gap-2 sm:flex-row"><Select aria-label="Existing tournament" value={attachId} onChange={(e) => setAttachId(e.target.value)}><option value="">Attach existing tournament...</option>{(tournamentOptions || []).map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</Select><Button type="button" variant="secondary" disabled={!attachId || busy} onClick={() => void attach()}>Attach existing</Button></div><div className="grid gap-3">{event.tournaments.map((tournament) => <div key={tournament.id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-white">{tournament.title}</p><p className="text-sm text-slate-400">{tournament.game} · {tournament.registrationCount}/{tournament.maxTeams} registrations · {tournament.status}</p></div><Link href={`/admin/tournaments/${tournament.id}/edit`} className={buttonClassName({ variant: "secondary" })}>Edit tournament</Link></div>)}</div></Card> : null}
      {tab === "Registrations" ? <AdminRegistrationsManager eventId={event.id} eventTitle={event.title} /> : null}</> : null}
    {(isNew || tab === "Settings") ? <Card className="p-6 sm:p-8"><form onSubmit={save} className="grid gap-5 md:grid-cols-2"><FormField label="Title" htmlFor="event-title" required><Input id="event-title" value={form.title} onChange={(e) => update("title", e.target.value)} required /></FormField><FormField label="Slug" htmlFor="event-slug" required><Input id="event-slug" value={form.slug} onChange={(e) => update("slug", e.target.value)} required /></FormField><FormField label="Short name" htmlFor="event-short-name"><Input id="event-short-name" value={form.shortName || ""} onChange={(e) => update("shortName", e.target.value)} /></FormField><FormField label="Subtitle" htmlFor="event-subtitle"><Input id="event-subtitle" value={form.subtitle || ""} onChange={(e) => update("subtitle", e.target.value)} /></FormField><FormField label="Description" htmlFor="event-description" required className="md:col-span-2"><Textarea id="event-description" value={form.description} onChange={(e) => update("description", e.target.value)} required rows={5} /></FormField><FormField label="Start date" htmlFor="event-start"><Input id="event-start" type="datetime-local" value={form.startDate || ""} onChange={(e) => update("startDate", e.target.value)} /></FormField><FormField label="End date" htmlFor="event-end"><Input id="event-end" type="datetime-local" value={form.endDate || ""} onChange={(e) => update("endDate", e.target.value)} /></FormField><FormField label="Venue" htmlFor="event-venue"><Input id="event-venue" value={form.venue || ""} onChange={(e) => update("venue", e.target.value)} /></FormField><FormField label="Location" htmlFor="event-location"><Input id="event-location" value={form.location || ""} onChange={(e) => update("location", e.target.value)} /></FormField><FormField label="Public website" htmlFor="event-website"><Input id="event-website" type="url" value={form.websiteUrl || ""} onChange={(e) => update("websiteUrl", e.target.value)} /></FormField><FormField label="Discord" htmlFor="event-discord"><Input id="event-discord" type="url" value={form.discordUrl || ""} onChange={(e) => update("discordUrl", e.target.value)} /></FormField>
      <FormField label="Hero image" htmlFor="event-hero" hint="PNG, JPG, or WebP · Max 10 MB."><div className="grid gap-2"><Input id="event-hero" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setForm((current) => applyAdminEventMediaSelection(current, "heroImage", e.target.files?.[0] || null))} />{event?.heroUrl || form.heroImage ? <Button type="button" variant="ghost" onClick={() => update("removeHeroImage", !form.removeHeroImage)}>{form.removeHeroImage ? "Keep hero image" : "Remove current hero image"}</Button> : null}</div></FormField>
      <FormField label="Banner image" htmlFor="event-banner" hint="PNG, JPG, or WebP · Max 10 MB."><div className="grid gap-2"><Input id="event-banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setForm((current) => applyAdminEventMediaSelection(current, "bannerImage", e.target.files?.[0] || null))} />{event?.bannerUrl || form.bannerImage ? <Button type="button" variant="ghost" onClick={() => update("removeBannerImage", !form.removeBannerImage)}>{form.removeBannerImage ? "Keep banner image" : "Remove banner image"}</Button> : null}</div></FormField>
      <div className="flex flex-wrap gap-5 text-sm text-slate-300 md:col-span-2"><label className="flex items-center gap-2"><input type="checkbox" checked={form.isPublished} onChange={(e) => update("isPublished", e.target.checked)} /> {form.isPublished ? adminEventActionLabels.unpublish : adminEventActionLabels.publish}</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.featured} onChange={(e) => update("featured", e.target.checked)} /> Featured</label></div><div className="flex flex-wrap gap-3 md:col-span-2"><Button type="submit" disabled={saving}>{saving ? "Saving event..." : isNew ? adminEventActionLabels.create : adminEventActionLabels.save}</Button>{!isNew ? <Button type="button" variant="danger" disabled={busy || saving} onClick={() => void archive()}>Archive event</Button> : null}</div></form></Card> : null}
  </AdminShell>;
}
