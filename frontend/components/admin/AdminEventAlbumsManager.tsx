"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import PostersContent from "@/components/posters/PostersContent";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest, type Pagination, type TournamentOption } from "@/lib/admin";
import type { EventAlbum } from "@/lib/event-albums";
import { fetchPosters, resolveImageAssetUrl, resolveMediaUrl, type Poster } from "@/lib/media";
import { ADMIN_UPLOAD_MAX_FILE_SIZE, assertFileWithinUploadLimit } from "@/lib/upload-limits";

type AlbumForm = {
  title: string;
  slug: string;
  description: string;
  location: string;
  eventDate: string;
  tournamentId: string;
  isPublished: boolean;
  allowDownloads: boolean;
};

const emptyForm: AlbumForm = {
  title: "",
  slug: "",
  description: "",
  location: "",
  eventDate: "",
  tournamentId: "",
  isPublished: false,
  allowDownloads: true,
};

const toForm = (album: EventAlbum): AlbumForm => ({
  title: album.title,
  slug: album.slug,
  description: album.description || "",
  location: album.location || "",
  eventDate: album.eventDate?.slice(0, 10) || "",
  tournamentId: album.tournament?.id || "",
  isPublished: album.isPublished,
  allowDownloads: album.allowDownloads,
});

export default function AdminEventAlbumsManager() {
  const showToast = useToastStore((state) => state.showToast);
  const [albums, setAlbums] = useState<EventAlbum[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 24, total: 0, totalPages: 1 });
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [posters, setPosters] = useState<Poster[]>([]);
  const [selected, setSelected] = useState<EventAlbum | null>(null);
  const [form, setForm] = useState<AlbumForm>(emptyForm);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const loadAlbums = useCallback(async () => {
    const data = await adminRequest<{ albums: EventAlbum[]; pagination: Pagination }>(
      "/api/admin/event-albums?page=1&pageSize=24",
    );
    setAlbums(data.albums);
    setPagination(data.pagination);
    return data.albums;
  }, []);

  const loadSupportData = useCallback(async () => {
    const [tournamentData, posterData] = await Promise.all([
      adminRequest<{ tournaments: TournamentOption[] }>("/api/admin/tournaments?page=1&pageSize=50"),
      fetchPosters(new URLSearchParams({ page: "1", pageSize: "60" })),
    ]);
    setTournaments(tournamentData.tournaments);
    setPosters(posterData.posters);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadAlbums(), loadSupportData()])
      .catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load event albums."))
      .finally(() => setLoading(false));
  }, [loadAlbums, loadSupportData]);

  const selectAlbum = async (album: EventAlbum) => {
    setMessage("");
    try {
      const data = await adminRequest<{ album: EventAlbum }>(`/api/admin/event-albums/${album.id}`);
      setSelected(data.album);
      setForm(toForm(data.album));
      setFiles([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open this album.");
    }
  };

  const startNew = () => {
    setSelected(null);
    setForm(emptyForm);
    setFiles([]);
    setMessage("");
  };

  const saveAlbum = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const path = selected ? `/api/admin/event-albums/${selected.id}` : "/api/admin/event-albums";
      const data = await adminRequest<{ album: EventAlbum }>(path, {
        method: selected ? "PATCH" : "POST",
        json: form,
      });
      setSelected(data.album);
      setForm(toForm(data.album));
      await loadAlbums();
      showToast({ tone: "success", title: selected ? "Album updated" : "Album created" });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Unable to save this album.";
      setMessage(nextMessage);
      showToast({ tone: "error", title: "Album not saved", description: nextMessage });
    } finally {
      setSaving(false);
    }
  };

  const uploadPhotos = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || files.length === 0) return;
    setUploading(true);
    setMessage("");
    try {
      files.forEach((file) => assertFileWithinUploadLimit(file, ADMIN_UPLOAD_MAX_FILE_SIZE, file.name));
      const body = new FormData();
      body.append("title", selected.title);
      files.forEach((file) => body.append("photos", file));
      const data = await adminRequest<{ album: EventAlbum }>(`/api/admin/event-albums/${selected.id}/photos`, {
        method: "POST",
        body,
        timeoutMs: 120_000,
      });
      setSelected(data.album);
      setFiles([]);
      await loadAlbums();
      showToast({ tone: "success", title: "Photos uploaded", description: `${files.length} photos added to ${selected.title}.` });
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Unable to upload album photos.";
      setMessage(nextMessage);
      showToast({ tone: "error", title: "Upload failed", description: nextMessage });
    } finally {
      setUploading(false);
    }
  };

  const movePhoto = async (photoId: string, direction: -1 | 1) => {
    if (!selected) return;
    const currentIndex = selected.photos.findIndex((photo) => photo.id === photoId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= selected.photos.length) return;
    const nextPhotos = [...selected.photos];
    [nextPhotos[currentIndex], nextPhotos[nextIndex]] = [nextPhotos[nextIndex], nextPhotos[currentIndex]];
    setSelected({ ...selected, photos: nextPhotos });
    try {
      const data = await adminRequest<{ album: EventAlbum }>(`/api/admin/event-albums/${selected.id}/photos/reorder`, {
        method: "PATCH",
        json: { photoIds: nextPhotos.map((photo) => photo.id) },
      });
      setSelected(data.album);
      await loadAlbums();
    } catch (error) {
      setSelected(selected);
      setMessage(error instanceof Error ? error.message : "Unable to reorder photos.");
    }
  };

  const removePhoto = async (photoId: string) => {
    if (!selected || !window.confirm("Remove this photo? If it is not used elsewhere, its stored file will also be deleted.")) return;
    try {
      await adminRequest(`/api/admin/event-albums/${selected.id}/photos/${photoId}`, { method: "DELETE" });
      const data = await adminRequest<{ album: EventAlbum }>(`/api/admin/event-albums/${selected.id}`);
      setSelected(data.album);
      await loadAlbums();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this photo.");
    }
  };

  const removeAlbum = async () => {
    if (!selected || !window.confirm(`Delete “${selected.title}”? Photos not used elsewhere will also be deleted from storage.`)) return;
    try {
      await adminRequest(`/api/admin/event-albums/${selected.id}`, { method: "DELETE" });
      startNew();
      await loadAlbums();
      showToast({ tone: "success", title: "Album deleted" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete this album.");
    }
  };

  const assignPoster = async (poster: Poster, tournamentId: string) => {
    try {
      const data = await adminRequest<{ poster: Poster }>(`/api/posters/${poster.id}`, {
        method: "PATCH",
        json: { tournamentId: tournamentId || null },
      });
      setPosters((current) => current.map((item) => item.id === poster.id ? data.poster : item));
      showToast({ tone: "success", title: tournamentId ? "Artwork moved to tournament" : "Tournament link removed" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update tournament artwork.");
    }
  };

  return (
    <AdminShell title="Event Albums" description="Publish event photography albums and move promotional artwork into its tournament page.">
      {message ? <p className="border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{message}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-2xl text-white">Albums</h2><p className="mt-1 text-xs text-slate-500">{pagination.total} total</p></div>
            <Button type="button" size="sm" onClick={startNew}>New album</Button>
          </div>
          <div className="mt-5 grid gap-3">
            {loading ? <p className="text-sm text-slate-400">Loading albums…</p> : albums.length ? albums.map((album) => (
              <button key={album.id} type="button" onClick={() => void selectAlbum(album)} className={`flex items-center gap-3 border p-3 text-left transition ${selected?.id === album.id ? "border-purple-300/50 bg-purple-400/10" : "border-white/10 bg-black/20 hover:border-white/20"}`}>
                <div className="relative size-16 shrink-0 overflow-hidden bg-black">
                  {album.photos[0] ? <Image src={resolveMediaUrl(album.photos[0].imageAsset.imageUrl)} alt="" fill sizes="64px" className="object-cover" /> : null}
                </div>
                <div className="min-w-0 flex-1"><p className="truncate font-semibold text-white">{album.title}</p><p className="mt-1 text-xs text-slate-500">{album.photoCount} photos · {album.isPublished ? "Published" : "Draft"}</p></div>
              </button>
            )) : <EmptyState description="Create your first event album." />}
          </div>
        </Card>

        <div className="grid gap-6">
          <Card className="p-5 sm:p-6">
            <form className="grid gap-4" onSubmit={saveAlbum}>
              <h2 className="text-2xl text-white">{selected ? "Edit album" : "Create album"}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Album title" htmlFor="albumTitle"><Input id="albumTitle" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></FormField>
                <FormField label="URL slug" htmlFor="albumSlug" hint="Leave blank to generate it from the title."><Input id="albumSlug" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="womens-cyber-games-2026" /></FormField>
                <FormField label="Location" htmlFor="albumLocation"><Input id="albumLocation" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Havelock City Mall" /></FormField>
                <FormField label="Event date" htmlFor="albumDate"><Input id="albumDate" type="date" value={form.eventDate} onChange={(event) => setForm({ ...form, eventDate: event.target.value })} /></FormField>
              </div>
              <FormField label="Related tournament" htmlFor="albumTournament" hint="Optional for expos and community events."><Select id="albumTournament" value={form.tournamentId} onChange={(event) => setForm({ ...form, tournamentId: event.target.value })}><option value="">Standalone event</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.title}</option>)}</Select></FormField>
              <FormField label="Description" htmlFor="albumDescription"><Textarea id="albumDescription" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></FormField>
              <div className="flex flex-wrap gap-5 text-sm text-slate-300">
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.isPublished} onChange={(event) => setForm({ ...form, isPublished: event.target.checked })} /> Published</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowDownloads} onChange={(event) => setForm({ ...form, allowDownloads: event.target.checked })} /> Allow downloads</label>
              </div>
              <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving}>{saving ? "Saving…" : selected ? "Save album" : "Create album"}</Button>{selected ? <Button type="button" variant="danger" onClick={() => void removeAlbum()}>Delete album</Button> : null}</div>
            </form>
          </Card>

          {selected ? (
            <Card className="p-5 sm:p-6">
              <form className="grid gap-4" onSubmit={uploadPhotos}>
                <div><h2 className="text-2xl text-white">Album photos</h2><p className="mt-1 text-sm text-slate-400">Upload up to 10 JPG, PNG, or WebP photos per batch, then move the cover photos into your preferred order.</p></div>
                <Input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))} required />
                {files.length ? <p className="text-xs text-slate-400">{files.length} photo{files.length === 1 ? "" : "s"} selected</p> : null}
                <Button type="submit" disabled={uploading || files.length === 0}>{uploading ? "Uploading…" : "Upload photos"}</Button>
              </form>
              {selected.photos.length ? <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{selected.photos.map((photo, index) => (
                <div key={photo.id} className="overflow-hidden border border-white/10 bg-black/20">
                  <div className="relative aspect-square"><Image src={resolveImageAssetUrl(photo.imageAsset)} alt={photo.caption || photo.imageAsset.title} fill sizes="200px" className="object-cover" /></div>
                  <div className="grid grid-cols-3 gap-1 p-2"><Button type="button" size="sm" variant="ghost" disabled={index === 0} onClick={() => void movePhoto(photo.id, -1)} aria-label="Move photo earlier">←</Button><Button type="button" size="sm" variant="ghost" disabled={index === selected.photos.length - 1} onClick={() => void movePhoto(photo.id, 1)} aria-label="Move photo later">→</Button><Button type="button" size="sm" variant="danger" onClick={() => void removePhoto(photo.id)} aria-label="Delete photo">×</Button></div>
                </div>
              ))}</div> : null}
            </Card>
          ) : null}
        </div>
      </div>

      <Card className="p-5 sm:p-6">
        <div><h2 className="text-2xl text-white">Existing promotional artwork</h2><p className="mt-2 text-sm text-slate-400">Assign each existing poster or graphic to a tournament. It will then appear in that tournament’s Event Media section instead of the public photo gallery.</p></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {posters.map((poster) => (
            <div key={poster.id} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border border-white/10 bg-black/20 p-3">
              <div className="relative aspect-[4/5] overflow-hidden bg-black"><Image src={resolveImageAssetUrl(poster.imageAsset)} alt={poster.title} fill sizes="88px" className="object-contain" /></div>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{poster.title}</p><Select className="mt-3 h-10 rounded-none text-xs" value={poster.tournament?.id || ""} onChange={(event) => void assignPoster(poster, event.target.value)}><option value="">Not assigned</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.title}</option>)}</Select></div>
            </div>
          ))}
        </div>
      </Card>

      <PostersContent adminOnly />
    </AdminShell>
  );
}
