"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminRequest } from "@/lib/admin";
import type { TournamentSponsor } from "@/lib/tournaments";
import { resolveImageUrl } from "@/lib/media";

const logoFallback = (event: React.SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied === "true") image.style.display = "none";
  else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; }
};

// One sponsor, either shown or being edited. Editing in place is the point: the
// PATCH route already existed, but with add-and-remove as the only controls,
// correcting a partnership label meant deleting the row -- which also deletes
// the logo file -- and re-entering every field with a fresh upload.
export default function SponsorRow({
  sponsor,
  sponsorsPath,
  onChanged,
  onMessage,
}: {
  sponsor: TournamentSponsor;
  sponsorsPath: string;
  onChanged: () => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(sponsor.name);
  const [partnershipLabel, setPartnershipLabel] = useState(sponsor.partnershipLabel || "Official Sponsor");
  const [websiteUrl, setWebsiteUrl] = useState(sponsor.websiteUrl || "");
  const [displayOrder, setDisplayOrder] = useState(String(sponsor.displayOrder));
  const [logo, setLogo] = useState<File | null>(null);
  const [dropLogo, setDropLogo] = useState(false);
  const logoUrl = resolveImageUrl(sponsor.logoUrl);

  // Always from the row as it currently stands, so reopening the form after a
  // save or a cancel shows what is stored rather than the last thing typed.
  const startEditing = () => {
    setName(sponsor.name);
    setPartnershipLabel(sponsor.partnershipLabel || "Official Sponsor");
    setWebsiteUrl(sponsor.websiteUrl || "");
    setDisplayOrder(String(sponsor.displayOrder));
    setLogo(null);
    setDropLogo(false);
    setEditing(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const body = new FormData();
    body.append("name", name);
    body.append("partnershipLabel", partnershipLabel);
    body.append("websiteUrl", websiteUrl);
    body.append("displayOrder", displayOrder);
    if (logo) body.append("logo", logo);
    // A replacement upload already supersedes the old file, so only ask for a
    // removal when no new logo is coming.
    else if (dropLogo) body.append("removeLogo", "true");
    setBusy(true);
    try {
      await adminRequest(`${sponsorsPath}/${sponsor.id}`, { method: "PATCH", body });
      setEditing(false);
      onMessage(`${name} updated.`);
      await onChanged();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to update sponsor.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove ${sponsor.name}? Its logo file is deleted too.`)) return;
    setBusy(true);
    try {
      await adminRequest(`${sponsorsPath}/${sponsor.id}`, { method: "DELETE" });
      onMessage(`${sponsor.name} removed.`);
      await onChanged();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Unable to remove sponsor.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
        {logoUrl
          ? <Image src={logoUrl} alt="" width={64} height={48} unoptimized className="h-12 w-16 object-contain" onError={logoFallback} />
          : <div className="h-12 w-16 rounded-lg bg-white/5" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-white">{sponsor.name}</p>
          <p className="truncate text-xs text-purple-200/75">{sponsor.partnershipLabel || "Official Sponsor"}</p>
          <p className="text-xs text-slate-500">Order {sponsor.displayOrder}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={startEditing}>Edit</Button>
          <Button type="button" size="sm" variant="danger" disabled={busy} onClick={remove}>Remove</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="grid gap-3 rounded-2xl border border-purple-300/30 bg-white/5 p-3">
      <Input required placeholder="Sponsor name" value={name} onChange={(event) => setName(event.target.value)} />
      <Input required maxLength={80} placeholder="Official PC Partner" value={partnershipLabel} onChange={(event) => setPartnershipLabel(event.target.value)} />
      <Input type="url" placeholder="https://sponsor.example" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
      <Input type="number" min="0" value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} />
      <div>
        <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setLogo(event.target.files?.[0] || null); setDropLogo(false); }} />
        <p className="mt-2 text-xs text-slate-400">
          {logo ? "Replaces the current logo." : "Leave empty to keep the current logo."} PNG, JPG, or WebP · Max 5 MB.
        </p>
        {logoUrl && !logo ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={dropLogo} onChange={(event) => setDropLogo(event.target.checked)} />
            Remove the current logo, showing the sponsor&apos;s initials instead
          </label>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </form>
  );
}
