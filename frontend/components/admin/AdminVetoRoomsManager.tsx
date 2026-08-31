"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import VetoRoomView from "@/components/veto/VetoRoomView";
import EmptyState from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adminRequest } from "@/lib/admin";
import { buildVetoShareUrl, type IssuedTokens, type VetoCatalog, type VetoRoom, type VetoStep, vetoRequest } from "@/lib/veto";

type TournamentOption = { id: string; title: string; game: string; status: string };
type MatchOption = { id: string; identifier: string; status: string; game?: string; participants: Array<{ displayName: string; logoUrl?: string | null; seed?: number | null }> };
const initialForm = {
  format: "bo3" as VetoRoom["format"],
  templateId: "",
  mapPoolId: "",
  rulePresetId: "",
  tournamentId: "",
  matchId: "",
  title: "",
  team1: "Team One",
  team2: "Team Two",
  seed1: "1",
  seed2: "2",
  controlMode: "captain_or_link",
  teamOrderMethod: "toss",
  tossMethod: "digital",
  tossCallerSlot: "2",
  turnSeconds: "60",
  viewerEnabled: true,
  publishResult: true,
};

const formatLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function AdminVetoRoomsManager() {
  const searchParams = useSearchParams();
  const queryMatchId = searchParams.get("matchId") || "";
  const queryTournamentId = searchParams.get("tournamentId") || "";
  const queryRoomId = searchParams.get("roomId") || "";
  const [rooms, setRooms] = useState<VetoRoom[]>([]);
  const [catalog, setCatalog] = useState<VetoCatalog | null>(null);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(initialForm);
  const [wizardStep, setWizardStep] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [issued, setIssued] = useState<IssuedTokens | null>(null);
  const [existingRoomId, setExistingRoomId] = useState<string | null>(null);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const contextApplied = useRef(false);
  const [mapForm, setMapForm] = useState({ name: "", accentColor: "#8b5cf6" });
  const [poolName, setPoolName] = useState("");
  const [poolMapIds, setPoolMapIds] = useState<string[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetFormat, setPresetFormat] = useState<VetoRoom["format"]>("bo3");
  const [presetSteps, setPresetSteps] = useState<VetoStep[]>([]);
  const selected = rooms.find((room) => room.id === selectedId) || null;
  const syncSelectedRoom = useCallback((next: VetoRoom) => {
    setRooms((current) => current.map((room) => room.id === next.id ? next : room));
  }, []);

  const load = useCallback(async () => {
    try {
      const [nextRooms, nextCatalog, tournamentData] = await Promise.all([
        vetoRequest<VetoRoom[]>("/api/v1/admin/veto-rooms"),
        vetoRequest<VetoCatalog>(`/api/v1/admin/veto/catalog${form.tournamentId ? `?tournamentId=${encodeURIComponent(form.tournamentId)}` : ""}`),
        adminRequest<{ tournaments: TournamentOption[] }>("/api/admin/tournaments?pageSize=100"),
      ]);
      setRooms(nextRooms);
      setCatalog(nextCatalog);
      setTournaments(tournamentData.tournaments || []);
      if (!form.mapPoolId && nextCatalog.pools[0]) setForm((current) => ({ ...current, mapPoolId: nextCatalog.pools[0].id, rulePresetId: nextCatalog.presets.find((entry) => entry.format === current.format)?.id || "" }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load veto administration."); }
    finally { setRoomsLoaded(true); }
  }, [form.mapPoolId, form.tournamentId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!roomsLoaded || contextApplied.current) return;
    contextApplied.current = true;
    if (queryRoomId) { setSelectedId(queryRoomId); setShowCreate(false); return; }
    if (queryMatchId) {
      const linkedRoom = rooms.find((room) => room.match?.id === queryMatchId);
      if (linkedRoom) { setSelectedId(linkedRoom.id); setShowCreate(false); return; }
      setForm((current) => ({ ...current, matchId: queryMatchId, tournamentId: queryTournamentId }));
      setShowCreate(true);
      setWizardStep(1);
    }
  }, [queryMatchId, queryRoomId, queryTournamentId, rooms, roomsLoaded]);
  useEffect(() => {
    if (!form.tournamentId) { setMatches([]); return; }
    vetoRequest<MatchOption[]>(`/api/v1/admin/tournaments/${form.tournamentId}/matches`).then(setMatches).catch(() => setMatches([]));
  }, [form.tournamentId]);

  const compatiblePresets = useMemo(() => catalog?.presets.filter((entry) => entry.format === form.format || entry.format === "custom") || [], [catalog, form.format]);
  const compatibleTemplates = useMemo(() => catalog?.templates.filter((entry) => entry.format === form.format) || [], [catalog, form.format]);
  const chosenPool = catalog?.pools.find((entry) => entry.id === form.mapPoolId);
  const chosenPreset = catalog?.presets.find((entry) => entry.id === form.rulePresetId);
  const selectedMatch = matches.find((match) => match.id === form.matchId);
  const linkedFormat = (format: VetoRoom["format"]) => !form.matchId || ["bo1", "bo3", "bo5"].includes(format);
  const matchEligible = (match: MatchOption) => match.participants.length === 2 && (match.game || tournaments.find((item) => item.id === form.tournamentId)?.game)?.toLowerCase() === "valorant";

  const chooseFormat = (format: VetoRoom["format"]) => {
    if (!linkedFormat(format)) return;
    const preset = catalog?.presets.find((entry) => entry.format === format);
    setForm((current) => ({ ...current, format, templateId: "", rulePresetId: preset?.id || "" }));
    setWizardStep(2);
  };

  const chooseTemplate = (templateId: string) => {
    const template = catalog?.templates.find((entry) => entry.id === templateId);
    if (!template) { setForm((current) => ({ ...current, templateId: "" })); return; }
    const settings = template.settings as Partial<typeof initialForm>;
    setForm((current) => ({ ...current, ...settings, templateId, mapPoolId: template.mapPoolId, rulePresetId: template.rulePresetId }));
  };

  const createRoom = async () => {
    if (form.matchId && (!linkedFormat(form.format) || !selectedMatch || !matchEligible(selectedMatch))) {
      setMessage("Select an eligible Valorant match with exactly two participants and a BO1, BO3, or BO5 format.");
      return;
    }
    setBusy("create"); setMessage("");
    try {
      const result = await vetoRequest<{ room: VetoRoom; issuedTokens: IssuedTokens }>("/api/v1/admin/veto-rooms", { method: "POST", json: {
        ...form,
        tournamentId: form.tournamentId || null,
        matchId: form.matchId || null,
        turnSeconds: form.turnSeconds ? Number(form.turnSeconds) : null,
        tossCallerSlot: Number(form.tossCallerSlot),
        participants: form.matchId ? undefined : [
          { displayName: form.team1, seed: Number(form.seed1), accentColor: "#22d3ee" },
          { displayName: form.team2, seed: Number(form.seed2), accentColor: "#fb7185" },
        ],
      } });
      setRooms((current) => [result.room, ...current]);
      setSelectedId(result.room.id);
      setIssued(result.issuedTokens);
      setShowCreate(false);
      setWizardStep(1);
      setMessage("Room created. Share or rotate the private links before opening it.");
    } catch (error) {
      if (error instanceof Error && (error as Error & { status?: number }).status === 409 && form.matchId) {
        const refreshed = await vetoRequest<VetoRoom[]>("/api/v1/admin/veto-rooms");
        const existing = refreshed.find((room) => room.match?.id === form.matchId);
        setRooms(refreshed);
        if (existing) {
          setSelectedId(existing.id); setExistingRoomId(existing.id); setIssued(null); setShowCreate(false);
          setMessage("This match already has a veto room. The existing room is selected below.");
          return;
        }
      }
      setMessage(error instanceof Error ? error.message : "Could not create room.");
    }
    finally { setBusy(""); }
  };

  const saveTemplate = async () => {
    const name = window.prompt("Template name", `${form.format.toUpperCase()} ${chosenPool?.name || "Veto"}`)?.trim();
    if (!name) return;
    setBusy("template");
    try {
      await vetoRequest("/api/v1/admin/veto/templates", { method: "POST", json: {
        name, format: form.format, tournamentId: form.tournamentId || null, mapPoolId: form.mapPoolId, rulePresetId: form.rulePresetId,
        settings: {
          controlMode: form.controlMode, teamOrderMethod: form.teamOrderMethod, tossMethod: form.tossMethod,
          tossCallerSlot: Number(form.tossCallerSlot), turnSeconds: form.turnSeconds ? Number(form.turnSeconds) : null,
          viewerEnabled: form.viewerEnabled, publishResult: form.publishResult,
        },
      } });
      setMessage("Reusable room template saved.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save template."); }
    finally { setBusy(""); }
  };

  const createMap = async () => {
    if (!mapForm.name.trim()) return;
    setBusy("map");
    try { await vetoRequest("/api/v1/admin/veto/maps", { method: "POST", json: mapForm }); setMapForm({ name: "", accentColor: "#8b5cf6" }); await load(); setMessage("Map added to the catalog."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create map."); }
    finally { setBusy(""); }
  };

  const toggleMapAvailability = async (map: VetoCatalog["maps"][number]) => {
    if (!map.id) return;
    const nextActive = map.isActive === false;
    setBusy(`map:${map.id}`); setMessage("");
    try {
      await vetoRequest(`/api/v1/admin/veto/maps/${map.id}`, { method: "PATCH", json: { isActive: nextActive } });
      await load();
      setMessage(`${map.name} ${nextActive ? "enabled" : "disabled"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update map availability."); }
    finally { setBusy(""); }
  };

  const createPool = async () => {
    if (!poolName.trim() || !poolMapIds.length) return;
    setBusy("pool");
    try { await vetoRequest("/api/v1/admin/veto/pools", { method: "POST", json: { name: poolName, mapIds: poolMapIds, tournamentId: form.tournamentId || null } }); setPoolName(""); setPoolMapIds([]); await load(); setMessage("Versioned map pool saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create pool."); }
    finally { setBusy(""); }
  };

  const selectPresetBase = (format: VetoRoom["format"]) => {
    setPresetFormat(format);
    const base = catalog?.presets.find((entry) => entry.format === format);
    setPresetSteps(base?.steps.map((step) => ({ ...step })) || [{ kind: "ban", actor: "A", seriesIndex: null }]);
  };

  const createPreset = async () => {
    if (!presetName.trim() || !presetSteps.length) return;
    setBusy("preset");
    try { await vetoRequest("/api/v1/admin/veto/presets", { method: "POST", json: { name: presetName, format: presetFormat, steps: presetSteps, mapCount: catalog?.pools.find((entry) => entry.id === form.mapPoolId)?.maps.length || 7, tournamentId: form.tournamentId || null } }); setPresetName(""); await load(); setMessage("Versioned veto rule preset saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create preset."); }
    finally { setBusy(""); }
  };

  const command = async (name: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusy(name); setMessage("");
    try {
      const latest = await vetoRequest<VetoRoom>(`/api/v1/admin/veto-rooms/${selected.id}`);
      const next = await vetoRequest<VetoRoom>(`/api/v1/admin/veto-rooms/${selected.id}/${name}`, { method: "POST", json: { expectedRevision: latest.revision, ...extra } });
      setRooms((current) => current.map((room) => room.id === next.id ? next : room));
      setMessage(`${formatLabel(name)} completed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Room action failed."); }
    finally { setBusy(""); }
  };

  const recordPhysicalToss = async () => {
    if (!selected) return;
    const call = window.prompt("Caller chose Heads or Tails", "heads")?.trim().toLowerCase();
    if (!call || !["heads", "tails"].includes(call)) return;
    const result = window.prompt("Physical toss result", call === "heads" ? "tails" : "heads")?.trim().toLowerCase();
    if (!result || !["heads", "tails"].includes(result)) return;
    await command("manual-toss", { call, result });
  };

  const rotate = async (role: "team_1" | "team_2" | "viewer" | "caster") => {
    if (!selected) return;
    setBusy(role);
    try {
      const data = await vetoRequest<{ role: string; token: string }>(`/api/v1/admin/veto-rooms/${selected.id}/rotate-link`, { method: "POST", json: { role } });
      setIssued((current) => ({
        team1: role === "team_1" ? data.token : current?.team1 || "",
        team2: role === "team_2" ? data.token : current?.team2 || "",
        viewer: role === "viewer" ? data.token : current?.viewer || null,
        caster: role === "caster" ? data.token : current?.caster || "",
      }));
      setMessage(`${formatLabel(role)} link rotated. Older links no longer work.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not rotate link."); }
    finally { setBusy(""); }
  };

  const shareUrl = (token: string) => selected ? buildVetoShareUrl(window.location.origin, selected.code, token) : "";
  const copyLink = async (token: string) => { await navigator.clipboard.writeText(shareUrl(token)); setMessage("Private room link copied."); };

  return (
    <AdminShell title="Veto Rooms" description="Create and run animated Valorant toss, map veto, and starting-side rooms from desktop or mobile." actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowLibrary((value) => !value)}>Maps & presets</Button><Button onClick={() => { setExistingRoomId(null); setShowCreate(true); setWizardStep(1); }}>New veto room</Button></div>}>
      {message ? <div className="border border-purple-300/20 bg-purple-400/10 px-4 py-3 text-sm text-slate-200">{message}</div> : null}

      {showCreate ? <Card className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Step {wizardStep} of 6</p><h2 className="mt-2 text-2xl text-white">{["Choose match format", "Choose a saved template", "Map pool and veto rules", "Toss and room controls", "Teams and match source", "Review and create"][wizardStep - 1]}</h2></div><Button variant="ghost" onClick={() => setShowCreate(false)}>Close</Button></div>
        <div className="mt-6">
          {wizardStep === 1 ? <div className="grid gap-3 sm:grid-cols-4">{(form.matchId ? (["bo1", "bo3", "bo5"] as const) : (["bo1", "bo3", "bo5", "custom", "premier"] as const)).map((format) => <button type="button" key={format} onClick={() => chooseFormat(format)} className={`min-h-28 border p-5 text-left transition hover:-translate-y-1 ${form.format === format ? "border-purple-300/50 bg-purple-400/12" : "border-white/10 bg-white/[.025]"}`}><span className="text-2xl font-black uppercase text-white">{format}</span><span className="mt-2 block text-xs text-slate-400">{format === "custom" ? "Custom rule sequence" : format === "premier" ? "Seven-map Premier veto" : `Best of ${format.slice(2)}`}</span></button>)}</div> : null}
          {wizardStep === 2 ? <div><label className="text-sm text-slate-300">Saved room template<Select className="mt-2" value={form.templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Start with format defaults</option>{compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</Select></label><p className="mt-3 text-xs text-slate-500">Templates reuse pool, toss, control, timer, and visibility settings. Teams are never saved.</p></div> : null}
          {wizardStep === 3 ? <div className="grid gap-5 md:grid-cols-2"><label className="text-sm text-slate-300">Map pool<Select className="mt-2" value={form.mapPoolId} onChange={(event) => setForm({ ...form, mapPoolId: event.target.value })}>{catalog?.pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name} · {pool.maps.length} maps · v{pool.version}</option>)}</Select></label><label className="text-sm text-slate-300">Veto rule preset<Select className="mt-2" value={form.rulePresetId} onChange={(event) => setForm({ ...form, rulePresetId: event.target.value })}>{compatiblePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · v{preset.version}</option>)}</Select></label><div className="md:col-span-2 flex gap-2 overflow-x-auto pb-2">{chosenPreset?.steps.map((step, index) => <span key={index} className="min-w-24 border border-white/10 bg-black/20 px-3 py-2 text-[10px] uppercase tracking-[.14em] text-slate-300">{index + 1}. {step.kind}{step.actor ? ` · ${step.actor}` : ""}</span>)}</div></div> : null}
          {wizardStep === 4 ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"><label className="text-sm text-slate-300">Control mode<Select className="mt-2" value={form.controlMode} onChange={(event) => setForm({ ...form, controlMode: event.target.value })}><option value="captain_or_link">Captain account or link</option><option value="link_only">Private links only</option><option value="staff_only">Staff operates</option></Select></label><label className="text-sm text-slate-300">Team order<Select className="mt-2" value={form.teamOrderMethod} onChange={(event) => setForm({ ...form, teamOrderMethod: event.target.value })}><option value="toss">Coin toss</option><option value="slot_order">Slot order</option><option value="higher_seed">Higher seed is A</option><option value="lower_seed">Lower seed is A</option><option value="staff_assignment">Staff assignment</option></Select></label><label className="text-sm text-slate-300">Toss method<Select className="mt-2" value={form.tossMethod} onChange={(event) => setForm({ ...form, tossMethod: event.target.value })}><option value="digital">Digital Heads/Tails</option><option value="manual">Record physical toss</option></Select></label><label className="text-sm text-slate-300">Toss caller<Select className="mt-2" value={form.tossCallerSlot} onChange={(event) => setForm({ ...form, tossCallerSlot: event.target.value })}><option value="1">Team slot 1</option><option value="2">Team slot 2</option></Select></label><label className="text-sm text-slate-300">Turn timer seconds<Input className="mt-2" type="number" min="10" max="900" value={form.turnSeconds} onChange={(event) => setForm({ ...form, turnSeconds: event.target.value })} /></label><div className="grid gap-3 pt-6"><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.viewerEnabled} onChange={(event) => setForm({ ...form, viewerEnabled: event.target.checked })} />Viewer link</label><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.publishResult} onChange={(event) => setForm({ ...form, publishResult: event.target.checked })} />Publish completed result</label></div></div> : null}
          {wizardStep === 5 ? <div className="grid gap-5 md:grid-cols-2"><label className="text-sm text-slate-300">Tournament (optional)<Select className="mt-2" value={form.tournamentId} onChange={(event) => setForm({ ...form, tournamentId: event.target.value, matchId: "" })}><option value="">Standalone room</option>{tournaments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label><label className="text-sm text-slate-300">Existing match (optional)<Select className="mt-2" value={form.matchId} onChange={(event) => { const matchId = event.target.value; setForm((current) => ({ ...current, matchId, format: matchId && !["bo1", "bo3", "bo5"].includes(current.format) ? "bo3" : current.format })); }}><option value="">Enter teams manually</option>{matches.map((match) => <option key={match.id} value={match.id}>{match.identifier || match.id.slice(0, 8)} · {match.participants.map((entry) => entry.displayName).join(" vs ")}</option>)}</Select></label>{!form.matchId ? <><label className="text-sm text-slate-300">Team 1<Input className="mt-2" value={form.team1} onChange={(event) => setForm({ ...form, team1: event.target.value })} /></label><label className="text-sm text-slate-300">Team 2<Input className="mt-2" value={form.team2} onChange={(event) => setForm({ ...form, team2: event.target.value })} /></label></> : <div className="md:col-span-2 border border-cyan-300/15 bg-cyan-400/[.05] p-4 text-sm text-cyan-100">Teams and seeds will be imported from the selected match. You can still change the room title.</div>}<label className="text-sm text-slate-300">Room title<Input className="mt-2" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Generated from team names if blank" /></label></div> : null}
          {wizardStep === 6 ? <div className="grid gap-4 md:grid-cols-2"><div className="border border-white/10 bg-black/20 p-5"><p className="text-xs uppercase tracking-[.18em] text-slate-500">Match</p><p className="mt-2 text-xl text-white">{selectedMatch ? selectedMatch.participants.map((entry) => entry.displayName).join(" vs ") : `${form.team1} vs ${form.team2}`}</p>{selectedMatch ? <div className="mt-4 flex gap-3">{selectedMatch.participants.map((entry) => entry.logoUrl ? <Image key={entry.displayName} src={entry.logoUrl} alt="" width={40} height={40} className="size-10 rounded-lg object-contain" /> : <div key={entry.displayName} className="size-10 rounded-lg bg-white/10" aria-label={`${entry.displayName} logo placeholder`} />)}</div> : null}<p className="mt-2 text-sm text-slate-400">{form.format.toUpperCase()} · {chosenPool?.name} · {chosenPreset?.name}</p></div><div className="border border-white/10 bg-black/20 p-5"><p className="text-xs uppercase tracking-[.18em] text-slate-500">Operation</p><p className="mt-2 text-sm text-white">{formatLabel(form.controlMode)} · {formatLabel(form.teamOrderMethod)}</p><p className="mt-2 text-sm text-slate-400">{form.turnSeconds ? `${form.turnSeconds}s timer` : "No timer"} · {form.viewerEnabled ? "Viewer enabled" : "Private"}</p></div></div> : null}
        </div>
        {wizardStep > 1 ? <div className="mt-7 flex flex-wrap gap-3"><Button variant="ghost" onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>Back</Button>{wizardStep < 6 ? <Button onClick={() => setWizardStep((step) => Math.min(6, step + 1))}>Continue</Button> : <><Button disabled={busy === "create"} onClick={() => void createRoom()}>{busy === "create" ? "Creating…" : "Create room"}</Button><Button variant="secondary" disabled={Boolean(busy)} onClick={() => void saveTemplate()}>Save setup as template</Button></>}</div> : null}
      </Card> : null}

      {showLibrary ? <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-5"><p className="text-xs uppercase tracking-[.18em] text-purple-200">Map catalog</p><h2 className="mt-2 text-xl text-white">Add a map</h2><div className="mt-4 grid gap-3"><Input placeholder="Map name" value={mapForm.name} onChange={(event) => setMapForm({ ...mapForm, name: event.target.value })} /><label className="text-sm text-slate-400">Accent color<Input className="mt-2" type="color" value={mapForm.accentColor} onChange={(event) => setMapForm({ ...mapForm, accentColor: event.target.value })} /></label><Button disabled={busy === "map"} onClick={() => void createMap()}>Add map</Button></div></Card>
        <Card className="p-5"><p className="text-xs uppercase tracking-[.18em] text-purple-200">Map pool</p><h2 className="mt-2 text-xl text-white">Save a pool version</h2><div className="mt-4 grid gap-3"><Input placeholder="Pool name" value={poolName} onChange={(event) => setPoolName(event.target.value)} /><div className="grid max-h-80 gap-2 overflow-y-auto">{catalog?.maps.map((map) => { const active = map.isActive !== false; return <label key={map.slug} className="flex items-center gap-3 border border-white/8 p-3 text-sm text-slate-300"><input type="checkbox" disabled={!active} checked={Boolean(active && map.id && poolMapIds.includes(map.id))} onChange={(event) => map.id && setPoolMapIds((current) => event.target.checked ? [...current, map.id!] : current.filter((id) => id !== map.id))} />{map.name}<Badge className={active ? "" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}>{active ? "Active" : "Inactive"}</Badge></label>; })}</div><Button disabled={busy === "pool" || !poolMapIds.length} onClick={() => void createPool()}>Save new pool version</Button><p className="text-xs text-slate-500">{form.tournamentId ? "Saved for the selected tournament." : "Saved organization-wide."}</p></div></Card>
        <Card className="p-5"><p className="text-xs uppercase tracking-[.18em] text-purple-200">Rule builder</p><h2 className="mt-2 text-xl text-white">Save a veto preset</h2><div className="mt-4 grid gap-3"><Input placeholder="Preset name" value={presetName} onChange={(event) => setPresetName(event.target.value)} /><Select value={presetFormat} onChange={(event) => selectPresetBase(event.target.value as VetoRoom["format"])}>{["bo1", "bo3", "bo5", "custom", "premier"].map((format) => <option key={format} value={format}>{format.toUpperCase()}</option>)}</Select>{presetSteps.length === 0 ? <Button variant="secondary" onClick={() => selectPresetBase(presetFormat)}>Load a base sequence</Button> : <div className="grid max-h-96 gap-2 overflow-y-auto">{presetSteps.map((step, index) => <div key={index} className="grid grid-cols-[1fr_.7fr_64px_auto] gap-2 border border-white/8 p-2"><Select value={step.kind} onChange={(event) => setPresetSteps((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, kind: event.target.value as VetoStep["kind"] } : entry))}><option value="ban">Ban</option><option value="pick">Pick</option><option value="decider">Decider</option><option value="side">Side</option></Select><Select disabled={step.kind === "decider"} value={step.actor || ""} onChange={(event) => setPresetSteps((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, actor: (event.target.value || null) as VetoStep["actor"] } : entry))}><option value="">System</option><option value="A">A</option><option value="B">B</option></Select><Input aria-label="Series map" type="number" min="1" value={step.seriesIndex || ""} onChange={(event) => setPresetSteps((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, seriesIndex: event.target.value ? Number(event.target.value) : null } : entry))} /><Button size="sm" variant="danger" onClick={() => setPresetSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</Button></div>)}</div>}<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setPresetSteps((current) => [...current, { kind: "ban", actor: "A", seriesIndex: null }])}>Add step</Button><Button size="sm" disabled={busy === "preset" || !presetSteps.length} onClick={() => void createPreset()}>Save preset version</Button></div></div></Card>
      </div> : null}

      {showLibrary ? <Card className="mt-5 p-5"><p className="text-xs uppercase tracking-[.18em] text-purple-200">Map availability</p><p className="mt-2 text-sm text-slate-400">Inactive maps remain in the catalog for management but cannot be added to new pool versions.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{catalog?.maps.map((map) => { const active = map.isActive !== false; const mapBusy = busy === `map:${map.id}`; return <div key={`availability-${map.slug}`} className="flex items-center gap-3 border border-white/8 p-3" style={{ borderLeftColor: map.accentColor, borderLeftWidth: 3 }}><div className="h-14 w-20 shrink-0 bg-cover bg-center" style={{ backgroundColor: map.accentColor, backgroundImage: map.artworkUrl ? `url(${map.artworkUrl})` : undefined }} aria-label={`${map.name} artwork`} /><div className="min-w-0 flex-1"><p className="truncate text-sm text-white">{map.name}</p><Badge className={active ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}>{active ? "Active" : "Inactive"}</Badge></div><Button size="sm" variant={active ? "danger" : "secondary"} disabled={Boolean(busy) || mapBusy || !map.id} onClick={() => void toggleMapAvailability(map)}>{mapBusy ? "Saving…" : active ? "Disable" : "Enable"}</Button></div>; })}</div></Card> : null}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit p-4"><div className="flex items-center justify-between"><h2 className="text-lg text-white">Rooms</h2><Badge>{rooms.length}</Badge></div><div className="mt-4 grid gap-2">{rooms.map((room) => <button key={room.id} onClick={() => { setSelectedId(room.id); setIssued(null); }} className={`border p-4 text-left ${selectedId === room.id ? "border-purple-300/40 bg-purple-400/10" : "border-white/8 bg-white/[.025]"}`}><p className="font-semibold text-white">{room.title}</p><p className="mt-1 text-xs uppercase tracking-[.13em] text-slate-500">{room.format} · {formatLabel(room.status)}</p></button>)}{!rooms.length ? <EmptyState description="No veto rooms yet." /> : null}</div></Card>
        <div className="grid min-w-0 gap-5">{selected ? <>
          <Card className="p-5">{existingRoomId === selected.id ? <Link href={`/admin/veto-rooms?roomId=${encodeURIComponent(selected.id)}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>Open existing veto</Link> : null}<div className="flex flex-wrap gap-2"><Link href={`/veto/${selected.code}`} target="_blank" className={buttonClassName({ variant: "secondary", size: "sm" })}>Open live room</Link>{selected.status === "draft" ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void command("open")}>Open room</Button> : null}{selected.teamOrderMethod === "staff_assignment" && ["draft", "open"].includes(selected.status) ? <><Button size="sm" variant="secondary" onClick={() => void command("assign-team-a", { teamASlot: 1 })}>Slot 1 is A</Button><Button size="sm" variant="secondary" onClick={() => void command("assign-team-a", { teamASlot: 2 })}>Slot 2 is A</Button></> : null}{selected.status === "open" ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void command("start")}>Start toss / veto</Button> : null}{selected.status === "toss_complete" ? <Button size="sm" disabled={Boolean(busy)} onClick={() => void command("start")}>Start legacy veto</Button> : null}{selected.status === "open" ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command("start", { force: true })}>Force start</Button> : null}{selected.status === "toss_pending" && selected.toss.method === "manual" && !selected.toss.result ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void recordPhysicalToss()}>Record physical toss</Button> : null}{["in_progress", "completed"].includes(selected.status) ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void command("rewind", { targetStep: Math.max(0, selected.currentStep - 1) })}>Undo last step</Button> : null}<Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void command("reset")}>Reset</Button><Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void command("cancel")}>Cancel</Button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(["team_1", "team_2", "viewer", "caster"] as const).map((role) => { const token = role === "team_1" ? issued?.team1 : role === "team_2" ? issued?.team2 : role === "viewer" ? issued?.viewer : issued?.caster; return <div key={role} className="border border-white/8 bg-black/20 p-3"><p className="text-xs uppercase text-slate-500">{formatLabel(role)} link</p><div className="mt-3 flex flex-wrap gap-2">{token ? <><Button size="sm" onClick={() => void copyLink(token)}>Copy</Button><a href={shareUrl(token)} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "ghost", size: "sm" })}>Open</a></> : null}<Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void rotate(role)}>Rotate</Button></div></div>; })}</div>
          </Card>
          <VetoRoomView code={selected.code} onRoomChange={syncSelectedRoom} />
        </> : <EmptyState description="Select a veto room to operate it." />}</div>
      </div>
    </AdminShell>
  );
}
