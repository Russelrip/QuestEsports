"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminRequest } from "@/lib/admin";
import type { Rulebook } from "@/lib/rulebooks";

const emptyForm = { id: "", title: "", slug: "", game: "", variant: "Standard", content: "" };

export default function AdminRulebooksManager() {
  const [rulebooks, setRulebooks] = useState<Rulebook[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await adminRequest<{ rulebooks: Rulebook[] }>("/api/rulebooks");
    setRulebooks(data.rulebooks);
  };

  useEffect(() => {
    void load().catch((nextError) => setError(nextError instanceof Error ? nextError.message : "Unable to load rulebooks."));
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await adminRequest(form.id ? `/api/admin/rulebooks/${form.id}` : "/api/admin/rulebooks", {
        method: form.id ? "PATCH" : "POST",
        json: form,
      });
      setForm(emptyForm);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save rulebook.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rulebook: Rulebook) => {
    if (!window.confirm(`Delete "${rulebook.title}"? Attached tournaments will keep running without a rulebook.`)) return;
    await adminRequest(`/api/admin/rulebooks/${rulebook.id}`, { method: "DELETE" });
    if (form.id === rulebook.id) setForm(emptyForm);
    await load();
  };

  return (
    <AdminShell title="Rulebooks" description="Create reusable game rulebooks and attach them to tournaments.">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">{form.id ? "Edit Rulebook" : "Create Rulebook"}</h3>
          <form className="mt-6 grid gap-5" onSubmit={submit}>
            <FormField label="Title" required>
              <Input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </FormField>
            <FormField label="Slug" hint="Leave blank to generate it from the title.">
              <Input value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} />
            </FormField>
            <FormField label="Game" required>
              <Input required placeholder="VALORANT" value={form.game} onChange={(event) => setForm((current) => ({ ...current, game: event.target.value }))} />
            </FormField>
            <FormField label="Rule Set / Variant" required hint="Use Skirmish for Valorant Skirmish rules.">
              <Input required placeholder="Standard or Skirmish" value={form.variant} onChange={(event) => setForm((current) => ({ ...current, variant: event.target.value }))} />
            </FormField>
            <FormField label="Rulebook Content" required>
              <Textarea required rows={18} value={form.content} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} />
            </FormField>
            {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save Rulebook"}</Button>
              {form.id ? <Button type="button" variant="secondary" onClick={() => setForm(emptyForm)}>Cancel</Button> : null}
            </div>
          </form>
        </Card>

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">Rulebook Library</h3>
          <div className="mt-6 grid gap-4">
            {rulebooks.length === 0 ? <EmptyState description="No rulebooks created yet." /> : rulebooks.map((rulebook) => (
              <div key={rulebook.id} className="rounded-[22px] border border-white/8 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">{rulebook.game} / {rulebook.variant}</p>
                <h4 className="mt-2 text-xl text-white">{rulebook.title}</h4>
                <p className="mt-2 text-sm text-slate-400">{rulebook.tournamentCount || 0} attached tournaments</p>
                <div className="mt-4 flex gap-3">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setForm({ id: rulebook.id, title: rulebook.title, slug: rulebook.slug, game: rulebook.game, variant: rulebook.variant, content: rulebook.content })}>Edit</Button>
                  <Button type="button" variant="danger" size="sm" onClick={() => void remove(rulebook)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AdminShell>
  );
}
