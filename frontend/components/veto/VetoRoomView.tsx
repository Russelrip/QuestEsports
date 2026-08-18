"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resolveImageUrl } from "@/lib/media";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { readVetoToken, type VetoAction, type VetoRoom, vetoRequest, vetoTokenHeaders } from "@/lib/veto";

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function useCountdown(deadline: string | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!deadline || !now) return null;
  return Math.ceil((new Date(deadline).getTime() - now) / 1000);
}

const actorSlot = (room: VetoRoom) => {
  if (!room.currentAction?.actor || !room.toss.teamASlot) return null;
  return room.currentAction.actor === "A" ? room.toss.teamASlot : room.toss.teamASlot === 1 ? 2 : 1;
};

const canAct = (room: VetoRoom, slot: number | null) => room.access.kind === "staff" || (room.access.kind === "team" && room.access.slot === slot);

type PendingDecision =
  | { kind: "ban"; mapSlug: string; mapName: string; revision: number; seriesIndex: number | null }
  | { kind: "pick"; mapSlug: string; mapName: string; revision: number; seriesIndex: number | null }
  | { kind: "side"; side: "attack" | "defense"; mapName: string; revision: number; seriesIndex: number | null }
  | { kind: "position"; choice: "A" | "B"; opensVeto: boolean; revision: number };

export default function VetoRoomView({ code, onRoomChange }: { code: string; onRoomChange?: (room: VetoRoom) => void }) {
  const [room, setRoom] = useState<VetoRoom | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [sound, setSound] = useState(false);
  const [revealingToss, setRevealingToss] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const previousRef = useRef<{ revision: number; tossResult: string | null; actions: number } | null>(null);

  const playTone = useCallback((kind: "toss" | "ban" | "pick" | "done") => {
    if (!sound) return;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "ban" ? "sawtooth" : "sine";
    oscillator.frequency.value = kind === "done" ? 660 : kind === "pick" ? 520 : kind === "toss" ? 420 : 180;
    gain.gain.setValueAtTime(0.04, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.addEventListener("ended", () => void context.close());
  }, [sound]);

  const applyRoom = useCallback((next: VetoRoom) => {
    const previous = previousRef.current;
    if (previous && next.toss.result && next.toss.result !== previous.tossResult) {
      setRevealingToss(true);
      playTone("toss");
      window.setTimeout(() => setRevealingToss(false), 1300);
    }
    if (previous && next.actions.length > previous.actions) {
      const latest = next.actions.at(-1);
      playTone(latest?.kind === "ban" ? "ban" : latest?.kind === "pick" ? "pick" : next.status === "completed" ? "done" : "pick");
    }
    previousRef.current = { revision: next.revision, tossResult: next.toss.result, actions: next.actions.length };
    setRoom(next);
    onRoomChange?.(next);
  }, [onRoomChange, playTone]);

  const load = useCallback(async (quiet = false) => {
    try {
      const next = await vetoRequest<VetoRoom>(`/api/v1/veto-rooms/${encodeURIComponent(code)}`, { headers: vetoTokenHeaders(token) });
      applyRoom(next);
      setError("");
    } catch (caught) {
      if (!quiet) setError(caught instanceof Error ? caught.message : "Could not load the veto room.");
    }
  }, [applyRoom, code, token]);

  useEffect(() => setToken(readVetoToken(code)), [code]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 5000);
    const closeRealtime = subscribeToRealtimeUpdates(`veto:${code}`, () => void load(true));
    return () => { clearInterval(poll); closeRealtime(); };
  }, [code, load]);
  useEffect(() => setPendingDecision(null), [room?.revision]);
  useEffect(() => {
    if (!pendingDecision) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPendingDecision(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDecision]);

  const mutate = async (key: string, path: string, json: Record<string, unknown>) => {
    if (!room) return;
    setBusy(key);
    setError("");
    try {
      const next = await vetoRequest<VetoRoom>(path, { method: "POST", headers: vetoTokenHeaders(token), json: { expectedRevision: room.revision, ...json } });
      applyRoom(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action could not be completed.");
      await load(true);
    } finally { setBusy(""); }
  };

  const countdown = useCountdown(room?.timer.deadline || null);
  const currentSlot = room ? actorSlot(room) : null;
  const currentParticipant = room?.participants.find((entry) => entry.slot === currentSlot);
  const selectedBySlug = useMemo(() => new Map((room?.actions || []).filter((action) => action.mapSlug).map((action) => [action.mapSlug, action])), [room?.actions]);
  const playedMaps = useMemo(() => (room?.actions || []).filter((action) => ["pick", "decider"].includes(action.kind)).sort((a, b) => Number(a.payload.seriesIndex || 0) - Number(b.payload.seriesIndex || 0)), [room?.actions]);

  if (!room) return <Card className="p-8 text-center"><div className="mx-auto size-10 animate-spin rounded-full border-2 border-white/10 border-t-purple-300" /><p className="mt-4 text-sm text-slate-400">{error || "Connecting to veto room…"}</p></Card>;

  const myParticipant = room.participants.find((entry) => entry.slot === room.access.slot);
  const canCall = room.status === "toss_pending" && !room.toss.result && canAct(room, room.toss.callerSlot);
  const canChooseOrder = room.status === "toss_pending" && Boolean(room.toss.winnerSlot) && !room.toss.teamASlot && canAct(room, room.toss.winnerSlot);
  const actionAllowed = room.status === "in_progress" && canAct(room, currentSlot);
  const firstActor = room.steps.find((step) => step.actor)?.actor || "A";
  const sideMap = room.currentAction?.kind === "side"
    ? playedMaps.find((action) => Number(action.payload.seriesIndex) === Number(room.currentAction?.seriesIndex))
    : null;
  const actionInstruction = room.currentAction?.kind === "ban"
    ? "Ban one map"
    : room.currentAction?.kind === "pick"
      ? `Pick Map ${room.currentAction.seriesIndex || ""}`.trim()
      : room.currentAction?.kind === "side"
        ? "Choose the starting side"
        : "Resolving the decider";
  const turnHeading = room.status === "completed"
    ? "Veto complete"
    : room.status === "toss_complete"
      ? "Toss complete · Staff is starting the veto"
      : room.status === "in_progress" && room.currentAction
        ? room.currentAction.kind === "decider"
          ? "Selecting the automatic decider"
          : actionAllowed
            ? room.access.kind === "team"
              ? `Your turn · ${actionInstruction}`
              : `Staff control · ${currentParticipant?.displayName || "Team"} · ${actionInstruction}`
            : `Waiting for ${currentParticipant?.displayName || "the active team"} · ${actionInstruction}`
        : "Waiting for staff to begin";

  const confirmDecision = () => {
    if (!pendingDecision || pendingDecision.revision !== room.revision) return;
    const decision = pendingDecision;
    setPendingDecision(null);
    if (decision.kind === "position") {
      void mutate(`team-${decision.choice.toLowerCase()}`, `/api/v1/veto-rooms/${room.code}/team-a`, { choice: decision.choice });
    } else if (decision.kind === "side") {
      void mutate(decision.side, `/api/v1/veto-rooms/${room.code}/actions`, { side: decision.side });
    } else {
      void mutate(`map-${decision.mapSlug}`, `/api/v1/veto-rooms/${room.code}/actions`, { mapSlug: decision.mapSlug });
    }
  };

  return (
    <div className="veto-stage grid min-w-0 gap-5">
      <Card className="overflow-hidden border-white/10 bg-[#090a11] p-0">
        <div className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(circle_at_15%_0%,rgba(34,211,238,.13),transparent_34%),radial-gradient(circle_at_85%_0%,rgba(251,113,133,.13),transparent_34%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap gap-2"><Badge>{room.format.toUpperCase()}</Badge><Badge>{label(room.status)}</Badge>{room.tournament ? <Badge>{room.tournament.title}</Badge> : null}</div>
              <h1 className="mt-4 text-2xl text-white sm:text-4xl">{room.title}</h1>
              <p className="mt-2 text-sm text-slate-400">Room {room.code} · Revision {room.revision}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSound((value) => !value)}>{sound ? "Sound on" : "Sound muted"}</Button>
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={Boolean(busy)}>Refresh</Button>
            </div>
          </div>
        </div>
      </Card>

      {error ? <div className="border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        {room.participants.map((participant, index) => (
          <div key={participant.id} className={`${index === 1 ? "md:col-start-3" : ""} border border-white/10 bg-[#11131c] p-5`} style={{ borderTopColor: participant.accentColor }}>
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Slot {participant.slot}{participant.team ? ` · Team ${participant.team}` : ""}</p><h2 className="mt-2 text-xl text-white">{participant.displayName}</h2></div><span className={`size-3 rounded-full ${participant.ready ? "bg-emerald-400 shadow-[0_0_18px_#34d399]" : "bg-slate-700"}`} /></div>
            <p className="mt-4 text-xs uppercase tracking-[0.16em] text-slate-400">{participant.team ? `Team ${participant.team} · ${participant.team === firstActor ? "takes the first veto action" : "waits for the first veto action"}` : participant.ready ? "Ready" : "Waiting"}</p>
            {participant.team ? <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">{participant.ready ? "Ready" : "Waiting"}</p> : null}
            {(room.access.kind === "staff" || myParticipant?.slot === participant.slot) && ["open", "toss_pending", "toss_complete"].includes(room.status) ? <Button className="mt-4 w-full" size="sm" variant={participant.ready ? "ghost" : "secondary"} disabled={Boolean(busy)} onClick={() => mutate(`ready-${participant.slot}`, `/api/v1/veto-rooms/${room.code}/ready`, { slot: participant.slot, ready: !participant.ready })}>{participant.ready ? "Not ready" : "Ready up"}</Button> : null}
          </div>
        ))}
        <div className="hidden items-center justify-center text-lg font-black text-slate-600 md:col-start-2 md:row-start-1 md:flex">VS</div>
      </div>

      {(room.status === "toss_pending" || room.status === "toss_complete") ? (
        <Card className="relative overflow-hidden p-6 sm:p-8">
          <div className="grid gap-7 lg:grid-cols-[.75fr_1.25fr] lg:items-center">
            <div className="text-center">
              <div className={`veto-coin ${revealingToss ? "veto-coin--flipping" : ""}`} aria-label={room.toss.result ? `Coin result ${room.toss.result}` : "Coin toss pending"}><span>{room.toss.result ? room.toss.result === "heads" ? "H" : "T" : "?"}</span></div>
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-500">{room.toss.result ? `${label(room.toss.result)} wins` : `${room.participants[room.toss.callerSlot - 1]?.displayName} calls`}</p>
            </div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Pre-match toss</p><h2 className="mt-2 text-2xl text-white">{room.toss.winnerSlot ? `${room.participants[room.toss.winnerSlot - 1]?.displayName} won the toss` : "Choose Heads or Tails"}</h2>
              {canCall ? <div className="mt-5 grid grid-cols-2 gap-3"><Button disabled={Boolean(busy)} onClick={() => mutate("heads", `/api/v1/veto-rooms/${room.code}/toss`, { call: "heads" })}>Heads</Button><Button disabled={Boolean(busy)} onClick={() => mutate("tails", `/api/v1/veto-rooms/${room.code}/toss`, { call: "tails" })}>Tails</Button></div> : null}
              {canChooseOrder ? <div className="mt-5"><p className="mb-3 text-sm text-slate-300">Choose the veto position. The veto starts immediately after confirmation.</p><div className="grid grid-cols-2 gap-3"><Button disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "position", choice: "A", opensVeto: firstActor === "A", revision: room.revision })}>Team A · {firstActor === "A" ? "opens veto" : "waits"}</Button><Button disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "position", choice: "B", opensVeto: firstActor === "B", revision: room.revision })}>Team B · {firstActor === "B" ? "opens veto" : "waits"}</Button></div></div> : null}
              {!canCall && !canChooseOrder ? <p className="mt-4 text-sm text-slate-400">Waiting for the authorized team or match staff.</p> : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className={`p-5 sm:p-7 ${room.access.kind === "team" && actionAllowed ? "border-cyan-300/40 bg-cyan-400/[.06]" : ""}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">{room.access.kind === "team" && actionAllowed ? "Your turn" : "Veto progress"}</p><h2 className="mt-2 text-2xl text-white">{turnHeading}</h2>{room.status === "in_progress" && room.currentAction && room.currentAction.kind !== "decider" ? <p className="mt-2 text-sm text-slate-400">Only {currentParticipant?.displayName || "the active team"} can lock this decision.</p> : null}</div>{countdown !== null ? <div className={`min-w-28 border px-4 py-3 text-center ${countdown <= 0 ? "border-rose-400/40 bg-rose-500/10 text-rose-200" : "border-white/10 bg-black/20 text-white"}`}><p className="text-[9px] uppercase tracking-[0.2em]">{countdown <= 0 ? "Overdue · no automatic selection" : "Turn time"}</p><p className="mt-1 text-2xl font-black tabular-nums">{Math.max(0, countdown)}s</p></div> : null}</div>
        <div className="mt-5 flex gap-1 overflow-x-auto pb-2" aria-label="Veto step progress">{room.steps.map((step, index) => <div key={`${step.kind}-${index}`} className={`min-w-24 border px-3 py-2 text-[10px] uppercase tracking-[0.14em] ${index < room.currentStep ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : index === room.currentStep ? "border-purple-300/40 bg-purple-400/15 text-white" : "border-white/8 bg-white/[.025] text-slate-600"}`}>{index + 1}. {step.kind}{step.actor ? ` · ${step.actor}` : ""}</div>)}</div>
      </Card>

      {room.currentAction?.kind === "side" && actionAllowed ? (
        <Card className="veto-side-reveal p-6 text-center sm:p-8"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Starting side · Map {room.currentAction.seriesIndex}{sideMap?.mapName ? ` · ${sideMap.mapName}` : ""}</p><h2 className="mt-3 text-3xl text-white">Choose Attack or Defense</h2><p className="mt-3 text-sm text-slate-400">You will review the side before it is locked.</p><div className="mx-auto mt-6 grid max-w-xl gap-3 sm:grid-cols-2"><Button className="h-16" disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "side", side: "attack", mapName: sideMap?.mapName || `Map ${room.currentAction?.seriesIndex || ""}`, revision: room.revision, seriesIndex: room.currentAction?.seriesIndex || null })}>Attack</Button><Button className="h-16" disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "side", side: "defense", mapName: sideMap?.mapName || `Map ${room.currentAction?.seriesIndex || ""}`, revision: room.revision, seriesIndex: room.currentAction?.seriesIndex || null })}>Defense</Button></div></Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {room.maps.map((map) => {
          const action = selectedBySlug.get(map.slug) as VetoAction | undefined;
          const available = !action;
          const selectable = available && actionAllowed && ["ban", "pick"].includes(room.currentAction?.kind || "");
          const artworkUrl = resolveImageUrl(map.artworkUrl);
          return <button key={map.slug} type="button" disabled={!selectable || Boolean(busy)} onClick={() => room.currentAction && ["ban", "pick"].includes(room.currentAction.kind) && setPendingDecision({ kind: room.currentAction.kind as "ban" | "pick", mapSlug: map.slug, mapName: map.name, revision: room.revision, seriesIndex: room.currentAction.seriesIndex })} className={`veto-map-card group relative min-h-48 overflow-hidden border text-left transition ${action?.kind === "ban" ? "veto-map-card--banned border-rose-400/25" : action ? "veto-map-card--picked border-emerald-400/35" : selectable ? "border-purple-300/30 hover:-translate-y-1 hover:border-purple-200/70" : "border-white/10"}`} style={{ background: map.artworkUrl ? undefined : `radial-gradient(circle at 75% 15%, ${map.accentColor}55, transparent 35%), linear-gradient(145deg, #191b28, #090a10)` }}>
            {artworkUrl ? <Image src={artworkUrl} alt="" fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" unoptimized className="absolute inset-0 size-full object-cover opacity-70 transition duration-500 group-hover:scale-105" onError={(event) => { const image = event.currentTarget; if (image.dataset.fallbackApplied === "true") image.style.display = "none"; else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; } }} /> : null}<div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" /><div className="relative flex min-h-48 flex-col justify-end p-5"><p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{action ? action.kind === "ban" ? "Banned" : action.kind === "decider" ? "Decider" : `Map ${action.payload.seriesIndex || ""}` : selectable ? `Select to ${room.currentAction?.kind}` : "Available"}</p><h3 className="mt-2 text-2xl font-black uppercase text-white">{map.name}</h3>{action?.side ? <span className="mt-3 w-fit bg-white/10 px-3 py-1 text-xs uppercase text-white">{action.side}</span> : null}</div>
          </button>;
        })}
      </div>

      {playedMaps.length ? <Card className="p-6"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Series order</p><div className="mt-4 grid gap-3 md:grid-cols-3">{playedMaps.map((action) => { const side = room.actions.find((entry) => entry.kind === "side" && entry.payload.seriesIndex === action.payload.seriesIndex); return <div key={action.id} className="border border-white/10 bg-black/20 p-4"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Map {action.payload.seriesIndex} · {action.kind}</p><p className="mt-2 text-lg font-bold text-white">{action.mapName}</p><p className="mt-1 text-xs uppercase text-slate-400">{side?.side ? `${label(side.side)} start` : "Side pending"}</p></div>; })}</div></Card> : null}

      {pendingDecision ? <div className="fixed inset-0 z-[100] grid place-items-center bg-black/80 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPendingDecision(null); }}><Card className="w-full max-w-lg border-purple-300/30 bg-[#10121b] p-6 shadow-[0_24px_90px_rgba(0,0,0,.7)]" role="dialog" aria-modal="true" aria-labelledby="veto-confirm-title"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Review decision</p><h2 id="veto-confirm-title" className="mt-3 text-3xl text-white">{pendingDecision.kind === "position" ? `Choose Team ${pendingDecision.choice}?` : pendingDecision.kind === "side" ? `Start ${label(pendingDecision.side)} on ${pendingDecision.mapName}?` : `${label(pendingDecision.kind)} ${pendingDecision.mapName}?`}</h2><p className="mt-4 text-sm leading-6 text-slate-300">{pendingDecision.kind === "position" ? `The toss winner will become Team ${pendingDecision.choice}, ${pendingDecision.opensVeto ? "take the first veto action" : "wait for the first veto action"}, and the veto will start immediately.` : pendingDecision.kind === "ban" ? `${pendingDecision.mapName} will be removed from this veto. Players cannot undo this decision; match staff can rewind it if needed.` : pendingDecision.kind === "pick" ? `${pendingDecision.mapName} will be locked as Map ${pendingDecision.seriesIndex || ""}. Players cannot undo this decision; match staff can rewind it if needed.` : `${pendingDecision.mapName} will be locked with a ${label(pendingDecision.side)} start. Players cannot undo this decision; match staff can rewind it if needed.`}</p><div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="ghost" disabled={Boolean(busy)} onClick={() => setPendingDecision(null)}>Go back</Button><Button variant={pendingDecision.kind === "ban" ? "danger" : "primary"} disabled={Boolean(busy)} onClick={confirmDecision}>{pendingDecision.kind === "position" ? `Confirm Team ${pendingDecision.choice}` : pendingDecision.kind === "side" ? `Confirm ${label(pendingDecision.side)}` : `Confirm ${label(pendingDecision.kind)}`}</Button></div></Card></div> : null}
    </div>
  );
}
