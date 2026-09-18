"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { resolveImageUrl } from "@/lib/media";
import { subscribeToRealtimeUpdates } from "@/lib/realtime";
import { readVetoToken, type VetoAction, type VetoRoom, vetoRequest, vetoTokenHeaders } from "@/lib/veto";
import { vetoMapArtwork } from "@/lib/veto-map-artwork";
import { getPremierBanSlotLabel, getPremierMapPresentation } from "@/lib/veto-premier";
import { banSlam, coinFlip, dialogIn, gsap, headingSwap, introTimeline, pickGlow, prefersReducedMotion, turnPulse, useGSAP } from "./vetoMotion";

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const initials = (value: string) => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
const TIMER_RADIUS = 26;
const TIMER_CIRCUMFERENCE = 2 * Math.PI * TIMER_RADIUS;

function ParticipantMark({ name, logoUrl, accentColor }: { name: string; logoUrl?: string | null; accentColor: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const resolvedLogoUrl = resolveImageUrl(logoUrl);
  return <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border text-base font-black text-white sm:size-16" style={{ borderColor: `${accentColor}88`, backgroundColor: `${accentColor}22`, boxShadow: `0 0 28px ${accentColor}33` }}>
    {resolvedLogoUrl && !logoFailed ? <Image src={resolvedLogoUrl} alt="" width={64} height={64} unoptimized className="size-full object-contain" onError={() => setLogoFailed(true)} /> : <span aria-label={`${name} initials`}>{initials(name)}</span>}
  </div>;
}

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

// A gentle 3D tilt that follows the mouse over a selectable map card. Only on
// devices with a real hover pointer; touch screens get no tilt.
const canTilt = () => !prefersReducedMotion() && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const tiltCard = (event: ReactPointerEvent<HTMLElement>) => {
  if (event.pointerType !== "mouse" || !canTilt()) return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width - 0.5;
  const y = (event.clientY - bounds.top) / bounds.height - 0.5;
  gsap.to(card, { rotationY: x * 10, rotationX: -y * 8, transformPerspective: 900, duration: 0.4, ease: "power2.out", overwrite: "auto" });
};
const resetTilt = (event: ReactPointerEvent<HTMLElement>) => {
  if (!canTilt()) return;
  gsap.to(event.currentTarget, { rotationY: 0, rotationX: 0, duration: 0.6, ease: "elastic.out(1, 0.6)", overwrite: "auto" });
};

const fallbackToLogo = (event: React.SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.dataset.fallbackApplied === "true") image.style.display = "none";
  else { image.dataset.fallbackApplied = "true"; image.src = "/images/logo.png"; }
};

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
  const rootRef = useRef<HTMLDivElement>(null);
  const seenActionsRef = useRef<Set<string> | null>(null);
  const seenStatusRef = useRef<string | null>(null);
  const headingKeyRef = useRef<string | null>(null);

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
      window.setTimeout(() => setRevealingToss(false), prefersReducedMotion() ? 0 : 1700);
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
  const isPremier = room?.format === "premier";
  const currentSlot = room ? actorSlot(room) : null;
  const currentParticipant = room?.participants.find((entry) => entry.slot === currentSlot);
  const selectedBySlug = useMemo(() => new Map((room?.actions || []).filter((action) => action.mapSlug).map((action) => [action.mapSlug, action])), [room?.actions]);
  const playedMaps = useMemo(() => (room?.actions || []).filter((action) => ["pick", "decider"].includes(action.kind)).sort((a, b) => Number(a.payload.seriesIndex || 0) - Number(b.payload.seriesIndex || 0)), [room?.actions]);
  const loaded = Boolean(room);
  const actionIds = (room?.actions || []).map((action) => action.id).join(",");
  const onTheClock = room?.status === "in_progress" && room.currentAction?.kind !== "decider" ? currentSlot : null;
  const stepFraction = room ? room.status === "completed" ? 1 : room.steps.length ? room.currentStep / room.steps.length : 0 : 0;
  const timerFraction = countdown === null ? 0 : Math.min(1, Math.max(0, countdown / (room?.timer.seconds || 60)));
  const tossResult = room?.toss.result || null;
  const headingKey = `${room?.status}|${room?.currentStep}|${room?.toss.winnerSlot}`;

  // Broadcast-style entrance once the room first arrives.
  useGSAP(() => {
    if (!loaded || !rootRef.current || prefersReducedMotion()) return;
    introTimeline(rootRef.current);
  }, { scope: rootRef, dependencies: [loaded] });

  // Slam bans, lift picks, and pop sides for actions that arrive after the first load.
  useGSAP(() => {
    if (!room || !rootRef.current) return;
    const seen = seenActionsRef.current;
    seenActionsRef.current = new Set(room.actions.map((action) => action.id));
    if (!seen || prefersReducedMotion()) return;
    for (const action of room.actions.filter((entry) => !seen.has(entry.id))) {
      if (action.kind === "side") {
        rootRef.current.querySelectorAll(`[data-veto-series="${action.payload.seriesIndex}"] [data-veto-side]`).forEach((badge) => gsap.fromTo(badge, { scale: 0, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out(3)" }));
        continue;
      }
      if (action.mapSlug) rootRef.current.querySelectorAll(`[data-veto-map="${action.mapSlug}"]`).forEach((card) => void (action.kind === "ban" ? banSlam(card) : pickGlow(card)));
      rootRef.current.querySelectorAll(`[data-veto-series-card="${action.id}"]`).forEach((card) => gsap.from(card, { y: 24, autoAlpha: 0, duration: 0.5, ease: "power3.out" }));
    }
  }, { scope: rootRef, dependencies: [actionIds] });

  // Celebrate the finished veto by cascading the series order.
  useGSAP(() => {
    const previous = seenStatusRef.current;
    seenStatusRef.current = room?.status || null;
    if (!previous || previous === "completed" || room?.status !== "completed" || prefersReducedMotion()) return;
    gsap.timeline()
      .from("[data-veto-series-card]", { y: 40, rotationX: -60, transformPerspective: 800, autoAlpha: 0, duration: 0.7, stagger: 0.12, ease: "back.out(1.8)" })
      .fromTo("[data-veto-progress-card]", { boxShadow: "0 0 0 rgba(52,211,153,0)" }, { boxShadow: "0 0 70px rgba(52,211,153,.35)", duration: 0.5, yoyo: true, repeat: 1 }, 0);
  }, { scope: rootRef, dependencies: [room?.status] });

  // Glow around whichever team is on the clock.
  useGSAP(() => {
    if (!onTheClock || prefersReducedMotion()) return;
    const glow = rootRef.current?.querySelector(`[data-veto-team="${onTheClock}"] [data-veto-glow]`);
    if (glow) turnPulse(glow);
  }, { scope: rootRef, dependencies: [onTheClock], revertOnUpdate: true });

  useGSAP(() => {
    const previous = headingKeyRef.current;
    headingKeyRef.current = headingKey;
    const heading = rootRef.current?.querySelector("[data-veto-heading]");
    if (!previous || previous === headingKey || !heading || prefersReducedMotion()) return;
    headingSwap(heading);
  }, { scope: rootRef, dependencies: [headingKey] });

  useGSAP(() => {
    const ring = rootRef.current?.querySelector("[data-veto-timer-ring]");
    const box = rootRef.current?.querySelector("[data-veto-timer]");
    if (!ring) return;
    const offset = TIMER_CIRCUMFERENCE * (1 - timerFraction);
    if (prefersReducedMotion()) { gsap.set(ring, { strokeDashoffset: offset }); return; }
    gsap.to(ring, { strokeDashoffset: offset, duration: 0.5, ease: "none", overwrite: true });
    if (box && countdown !== null && countdown > 0 && countdown <= 10) gsap.fromTo(box, { scale: 1.08 }, { scale: 1, duration: 0.4, ease: "power2.out", overwrite: true });
  }, { scope: rootRef, dependencies: [countdown, timerFraction] });

  useGSAP(() => {
    const bar = rootRef.current?.querySelector("[data-veto-progress]");
    if (!bar) return;
    if (prefersReducedMotion()) gsap.set(bar, { scaleX: stepFraction });
    else gsap.to(bar, { scaleX: stepFraction, duration: 0.8, ease: "power3.inOut", overwrite: true });
    const active = rootRef.current?.querySelector("[data-veto-step-active]");
    if (active && !prefersReducedMotion()) gsap.fromTo(active, { y: -6, scale: 1.08 }, { y: 0, scale: 1, duration: 0.5, ease: "back.out(2.5)" });
  }, { scope: rootRef, dependencies: [loaded, stepFraction] });

  // The coin rests heads-up, or tails-up once the toss has landed on tails.
  useGSAP(() => {
    const coin = rootRef.current?.querySelector("[data-veto-coin]");
    if (!coin) return;
    const restingAngle = tossResult === "tails" ? 180 : 0;
    if (revealingToss && !prefersReducedMotion()) coinFlip(coin, rootRef.current?.querySelector("[data-veto-coin-shadow]") || null, restingAngle);
    else if (!revealingToss) gsap.set(coin, { rotationY: restingAngle });
  }, { scope: rootRef, dependencies: [revealingToss, tossResult, room?.status] });

  useGSAP(() => {
    const backdrop = rootRef.current?.querySelector("[data-veto-dialog]");
    const panel = rootRef.current?.querySelector("[data-veto-dialog-panel]");
    if (!pendingDecision || !backdrop || !panel || prefersReducedMotion()) return;
    dialogIn(backdrop, panel);
  }, { scope: rootRef, dependencies: [pendingDecision] });

  if (!room) return <Card className="p-8 text-center"><div className="mx-auto size-10 animate-spin rounded-full border-2 border-white/10 border-t-purple-300" /><p className="mt-4 text-sm text-slate-400">{error || "Connecting to veto room…"}</p></Card>;

  const myParticipant = room.participants.find((entry) => entry.slot === room.access.slot);
  const isCaster = room.access.kind === "caster";
  const roleLabel = isCaster ? "Live broadcast" : room.access.kind === "viewer" || room.access.kind === "public" ? "Spectator" : label(room.access.kind);
  const canCall = !isCaster && room.status === "toss_pending" && !room.toss.result && canAct(room, room.toss.callerSlot);
  const canChooseOrder = !isCaster && room.status === "toss_pending" && Boolean(room.toss.winnerSlot) && !room.toss.teamASlot && canAct(room, room.toss.winnerSlot);
  const actionAllowed = !isCaster && room.status === "in_progress" && canAct(room, currentSlot);
  const firstActor = room.steps.find((step) => step.actor)?.actor || "A";
  const premierBanSteps = room.steps.filter((step) => step.kind === "ban");
  const premierBans = room.actions.filter((action) => action.kind === "ban");
  const participantName = (slot: number | null) => room.participants.find((participant) => participant.slot === slot)?.displayName || null;
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
  const lowTime = countdown !== null && countdown > 0 && countdown <= 10;

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
    <div ref={rootRef} className={`veto-stage grid min-w-0 gap-5 ${isCaster ? "veto-stage--caster" : ""}`}>
      <Card className="overflow-hidden border-white/10 bg-[#090a11] p-0">
        <div className="relative overflow-hidden px-5 py-6 sm:px-8 sm:py-8">
          <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_15%_0%,rgba(34,211,238,.16),transparent_36%),radial-gradient(circle_at_85%_0%,rgba(251,113,133,.16),transparent_36%)]" />
          <div className="veto-scanlines pointer-events-none absolute inset-0" />
          <div data-veto-hero className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap gap-2"><Badge>{room.format.toUpperCase()}</Badge><div aria-live="polite" aria-atomic="true"><Badge className={room.status === "in_progress" ? "border-rose-400/40 bg-rose-500/15 text-rose-100" : room.status === "completed" ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100" : ""}>{room.status === "in_progress" ? <span className="veto-live-dot mr-2" aria-hidden="true" /> : null}{label(room.status)}</Badge></div><Badge>{roleLabel}</Badge>{room.tournament ? <Badge>{room.tournament.title}</Badge> : null}</div>
              <h1 className="mt-4 text-2xl text-white sm:text-4xl">{room.title}</h1>
              <p className="mt-2 text-sm text-slate-400">Room {room.code}{!isCaster ? ` · Revision ${room.revision}` : " · Follow the live veto below"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSound((value) => !value)}>{sound ? "Sound on" : "Sound muted"}</Button>
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={Boolean(busy)}>Refresh</Button>
            </div>
          </div>
        </div>
      </Card>

      {error ? <div className="border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">{error}</div> : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">{turnHeading}</div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        {room.participants.map((participant, index) => {
          const onClock = onTheClock === participant.slot;
          return (
            <div key={participant.id} data-veto-team={participant.slot} className={`${index === 1 ? "md:col-start-3" : ""} relative overflow-hidden border border-white/10 bg-[#11131c] p-5`} style={{ borderTopColor: participant.accentColor, background: `linear-gradient(${index === 1 ? "225deg" : "135deg"}, ${participant.accentColor}1f, transparent 55%), #11131c` }}>
              {onClock ? <span data-veto-glow className="veto-team-glow pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 1px ${participant.accentColor}cc, inset 0 0 48px ${participant.accentColor}55` }} aria-hidden="true" /> : null}
              <div className={`flex items-start justify-between gap-4 ${index === 1 ? "md:flex-row-reverse md:text-right" : ""}`}>
                <div className={`flex min-w-0 items-center gap-4 ${index === 1 ? "md:flex-row-reverse" : ""}`}><ParticipantMark name={participant.displayName} logoUrl={participant.logoUrl} accentColor={participant.accentColor} /><div className="min-w-0"><p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Slot {participant.slot}{participant.team ? ` · Team ${participant.team}` : ""}</p><h2 className="mt-1 truncate text-2xl font-black uppercase tracking-tight text-white">{participant.displayName}</h2></div></div>
                <span className={`size-3 shrink-0 rounded-full ${participant.ready ? "bg-emerald-400 shadow-[0_0_18px_#34d399]" : "bg-slate-700"}`} />
              </div>
              <div className={`mt-4 flex flex-wrap items-center gap-2 ${index === 1 ? "md:justify-end" : ""}`}>
                {onClock ? <span className="px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950" style={{ backgroundColor: participant.accentColor }}>On the clock</span> : null}
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{participant.team ? `Team ${participant.team} · ${participant.team === firstActor ? "takes the first veto action" : "waits for the first veto action"}` : participant.ready ? "Ready" : "Waiting"}</p>
              </div>
              {participant.team ? <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-slate-500">{participant.ready ? "Ready" : "Waiting"}</p> : null}
              {(room.access.kind === "staff" || myParticipant?.slot === participant.slot) && ["open", "toss_pending", "toss_complete"].includes(room.status) ? <Button className="mt-4 w-full" size="sm" variant={participant.ready ? "ghost" : "secondary"} disabled={Boolean(busy)} onClick={() => mutate(`ready-${participant.slot}`, `/api/v1/veto-rooms/${room.code}/ready`, { slot: participant.slot, ready: !participant.ready })}>{participant.ready ? "Not ready" : "Ready up"}</Button> : null}
            </div>
          );
        })}
        <div className="hidden items-center justify-center md:col-start-2 md:row-start-1 md:flex"><div data-veto-vs className="veto-vs grid size-16 place-items-center rounded-full text-lg font-black text-white">VS</div></div>
      </div>

      {(room.status === "toss_pending" || room.status === "toss_complete") ? (
        <Card data-veto-panel className="relative p-6 sm:p-8">
          <div className="grid gap-7 lg:grid-cols-[.75fr_1.25fr] lg:items-center">
            <div className="text-center [perspective:700px]">
              <div className="veto-coin-stage">
                <div data-veto-coin className="veto-coin" role="img" aria-label={room.toss.result && !revealingToss ? `Coin result ${room.toss.result}` : room.toss.result ? "Coin flipping" : "Coin toss pending"}>
                  {Array.from({ length: 12 }, (_, layer) => <span key={layer} className="veto-coin__edge" style={{ transform: `translateZ(${layer - 5.5}px)` }} aria-hidden="true" />)}
                  <span className="veto-coin__face veto-coin__face--heads" aria-hidden="true"><span className="veto-coin__ring" /><span className="veto-coin__emblem" /><span className="veto-coin__legend">Heads</span></span>
                  <span className="veto-coin__face veto-coin__face--tails" aria-hidden="true"><span className="veto-coin__ring" /><span className="veto-coin__mark">Q</span><span className="veto-coin__legend">Tails</span></span>
                </div>
              </div>
              <div data-veto-coin-shadow className="veto-coin-shadow mx-auto mt-3" aria-hidden="true" />
              <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">{room.toss.result ? revealingToss ? "Flipping…" : `${label(room.toss.result)} wins` : `${room.participants[room.toss.callerSlot - 1]?.displayName} calls`}</p>
            </div>
            <div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Pre-match toss</p><h2 className="mt-2 text-2xl text-white">{room.toss.winnerSlot ? `${room.participants[room.toss.winnerSlot - 1]?.displayName} won the toss` : "Choose Heads or Tails"}</h2>
              {canCall ? <div className="mt-5 grid grid-cols-2 gap-3"><Button disabled={Boolean(busy)} onClick={() => mutate("heads", `/api/v1/veto-rooms/${room.code}/toss`, { call: "heads" })}>Heads</Button><Button disabled={Boolean(busy)} onClick={() => mutate("tails", `/api/v1/veto-rooms/${room.code}/toss`, { call: "tails" })}>Tails</Button></div> : null}
              {canChooseOrder ? <div className="mt-5"><p className="mb-3 text-sm text-slate-300">Choose the veto position. The veto starts immediately after confirmation.</p><div className="grid grid-cols-2 gap-3"><Button disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "position", choice: "A", opensVeto: firstActor === "A", revision: room.revision })}>Team A · {firstActor === "A" ? "opens veto" : "waits"}</Button><Button disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "position", choice: "B", opensVeto: firstActor === "B", revision: room.revision })}>Team B · {firstActor === "B" ? "opens veto" : "waits"}</Button></div></div> : null}
              {!canCall && !canChooseOrder ? <p className="mt-4 text-sm text-slate-400">Waiting for the authorized team or match staff.</p> : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card data-veto-panel data-veto-progress-card className={`p-5 sm:p-7 ${isPremier ? "border-cyan-300/25 bg-[#0b111b]" : ""} ${room.access.kind === "team" && actionAllowed ? "border-cyan-300/40 bg-cyan-400/[.06]" : ""}`}>
        {isPremier ? <div className="mb-6 border-b border-white/10 pb-5"><p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">Premier map veto</p><h2 className="mt-2 text-3xl font-black uppercase tracking-tight text-white">Ban phase</h2><p className="mt-2 text-sm text-slate-400">{actionAllowed ? "Your team’s turn" : currentParticipant ? `${currentParticipant.displayName}’s turn` : "Waiting for the active team"}</p><div className="mt-5 grid grid-cols-6 gap-1.5" aria-label="Premier ban progress">{Array.from({ length: 6 }, (_, index) => { const step = premierBanSteps[index]; const ban = premierBans[index]; const active = !ban && room.currentAction?.kind === "ban" && room.currentStep === room.steps.indexOf(step); return <div key={`premier-slot-${index}`} className={`border px-1.5 py-2 text-center ${ban ? "border-cyan-400/35 bg-cyan-400/10" : active ? "border-amber-300 bg-amber-300/15" : "border-white/10 bg-white/[.03]"}`}><p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Ban {index + 1}</p><p className={`mt-1 truncate text-[10px] font-bold uppercase ${ban ? "text-cyan-200" : active ? "text-amber-200" : "text-slate-600"}`}>{getPremierBanSlotLabel(Boolean(ban), active, step?.actor || null)}</p></div>; })}</div></div> : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-xs uppercase tracking-[0.2em] text-purple-200">{room.access.kind === "team" && actionAllowed ? "Your turn" : "Veto progress"}</p><h2 data-veto-heading className="mt-2 text-2xl text-white">{turnHeading}</h2>{room.status === "in_progress" && room.currentAction && room.currentAction.kind !== "decider" ? <p className="mt-2 text-sm text-slate-400">Only {currentParticipant?.displayName || "the active team"} can lock this decision.</p> : null}</div>
          {countdown !== null ? (
            <div data-veto-timer className={`flex min-w-36 items-center gap-3 border px-4 py-3 ${countdown <= 0 ? "border-rose-400/40 bg-rose-500/10 text-rose-200" : lowTime ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-black/20 text-white"}`}>
              <svg viewBox="0 0 64 64" className="size-14 -rotate-90" aria-hidden="true"><circle cx="32" cy="32" r={TIMER_RADIUS} fill="none" stroke="currentColor" strokeOpacity=".12" strokeWidth="5" /><circle data-veto-timer-ring cx="32" cy="32" r={TIMER_RADIUS} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={TIMER_CIRCUMFERENCE} strokeDashoffset={0} /></svg>
              <div><p className="text-[9px] uppercase tracking-[0.2em]">{countdown <= 0 ? "Overdue · no automatic selection" : "Turn time"}</p><p className="mt-1 text-2xl font-black tabular-nums">{Math.max(0, countdown)}s</p></div>
            </div>
          ) : null}
        </div>
        <div className="mt-5 h-1 overflow-hidden bg-white/[.06]" aria-hidden="true"><div data-veto-progress className="h-full origin-left bg-gradient-to-r from-cyan-300 via-purple-400 to-rose-400" style={{ transform: "scaleX(0)" }} /></div>
        <div className="mt-3 flex gap-1 overflow-x-auto pb-2" aria-label="Veto step progress">{room.steps.map((step, index) => <div key={`${step.kind}-${index}`} data-veto-step-active={index === room.currentStep && room.status !== "completed" ? "" : undefined} className={`min-w-24 border px-3 py-2 text-[10px] uppercase tracking-[0.14em] ${index < room.currentStep ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : index === room.currentStep ? "border-purple-300/40 bg-purple-400/15 text-white" : "border-white/8 bg-white/[.025] text-slate-600"}`}>{index + 1}. {step.kind}{step.actor ? ` · ${step.actor}` : ""}</div>)}</div>
      </Card>

      {!isPremier && room.currentAction?.kind === "side" && actionAllowed ? (
        <Card data-veto-panel className="veto-side-reveal p-6 text-center sm:p-8"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Starting side · Map {room.currentAction.seriesIndex}{sideMap?.mapName ? ` · ${sideMap.mapName}` : ""}</p><h2 className="mt-3 text-3xl text-white">Choose Attack or Defense</h2><p className="mt-3 text-sm text-slate-400">You will review the side before it is locked.</p><div className="mx-auto mt-6 grid max-w-xl gap-3 sm:grid-cols-2"><Button className="h-16" disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "side", side: "attack", mapName: sideMap?.mapName || `Map ${room.currentAction?.seriesIndex || ""}`, revision: room.revision, seriesIndex: room.currentAction?.seriesIndex || null })}>Attack</Button><Button className="h-16" disabled={Boolean(busy)} onClick={() => setPendingDecision({ kind: "side", side: "defense", mapName: sideMap?.mapName || `Map ${room.currentAction?.seriesIndex || ""}`, revision: room.revision, seriesIndex: room.currentAction?.seriesIndex || null })}>Defense</Button></div></Card>
      ) : null}

      {isPremier ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Premier map selection">{room.maps.map((map) => { const action = selectedBySlug.get(map.slug) as VetoAction | undefined; const actionKind = action?.kind || null; const selectable = !action && !getPremierMapPresentation(actionKind, null, actionAllowed && room.currentAction?.kind === "ban").disabled; const artworkUrl = resolveImageUrl(vetoMapArtwork(map)); const bannedBy = action?.actorSlot ? room.participants.find((participant) => participant.slot === action.actorSlot)?.team : null; const presentation = getPremierMapPresentation(actionKind, bannedBy || null, actionAllowed && room.currentAction?.kind === "ban"); const locked = presentation.locked; return <button key={map.slug} type="button" data-veto-map={map.slug} disabled={!selectable || Boolean(busy)} aria-label={`${map.name}${action?.kind === "ban" ? `, banned by Team ${bannedBy || "a team"}` : locked ? ", map locked" : ""}`} onPointerMove={selectable ? tiltCard : undefined} onPointerLeave={selectable ? resetTilt : undefined} onClick={() => selectable && setPendingDecision({ kind: "ban", mapSlug: map.slug, mapName: map.name, revision: room.revision, seriesIndex: null })} className={`group relative min-h-56 overflow-hidden border text-left transition-[border-color,box-shadow,filter] ${action?.kind === "ban" ? "border-rose-400/30 grayscale" : locked ? "border-amber-300 ring-2 ring-amber-300/30" : selectable ? "veto-map-card--selectable border-cyan-300/40 hover:border-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" : "border-white/10"}`} style={{ background: artworkUrl ? undefined : `radial-gradient(circle at 75% 15%, ${map.accentColor}66, transparent 35%), linear-gradient(145deg, #191b28, #090a10)` }}>{artworkUrl ? <Image src={artworkUrl} alt="" fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" unoptimized className="absolute inset-0 size-full object-cover opacity-70 transition duration-500 group-hover:scale-105" onError={fallbackToLogo} /> : null}<div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" /><div data-veto-flash className={`pointer-events-none invisible absolute inset-0 z-[3] opacity-0 ${action?.kind === "ban" ? "bg-rose-500" : "bg-amber-200"}`} />{action?.kind === "ban" ? <div className="absolute inset-0 z-[4] grid place-items-center bg-rose-950/60"><span data-veto-stamp className="border-2 border-rose-200/70 bg-rose-950/40 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-rose-100" style={{ transform: "rotate(-8deg)" }}>{bannedBy ? `Banned - Team ${bannedBy}` : "Banned"}</span></div> : null}{locked ? <div data-veto-ribbon className="absolute right-4 top-4 z-[4] bg-amber-300 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950">Map locked</div> : null}<div className="relative flex min-h-56 flex-col justify-end p-5"><p className="text-[10px] uppercase tracking-[0.2em] text-slate-300">{action?.kind === "ban" ? "Banned" : locked ? "Map locked" : selectable ? "Select to ban" : "Available"}</p><h3 className="mt-2 text-2xl font-black uppercase text-white">{map.name}</h3></div></button>; })}</div> : null}
      <div className={isPremier ? "hidden" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
        {room.maps.map((map) => {
          const action = selectedBySlug.get(map.slug) as VetoAction | undefined;
          const available = !action;
          const selectable = available && actionAllowed && ["ban", "pick"].includes(room.currentAction?.kind || "");
          const artworkUrl = resolveImageUrl(vetoMapArtwork(map));
          const byName = action?.kind === "decider" ? "Automatic decider" : participantName(action?.actorSlot ?? null);
          const intent = room.currentAction?.kind === "ban" ? "ban" : "pick";
          return <button key={map.slug} type="button" data-veto-map={map.slug} data-veto-series={action && action.kind !== "ban" ? action.payload.seriesIndex ?? undefined : undefined} disabled={!selectable || Boolean(busy)} onPointerMove={selectable ? tiltCard : undefined} onPointerLeave={selectable ? resetTilt : undefined} onClick={() => room.currentAction && ["ban", "pick"].includes(room.currentAction.kind) && setPendingDecision({ kind: room.currentAction.kind as "ban" | "pick", mapSlug: map.slug, mapName: map.name, revision: room.revision, seriesIndex: room.currentAction.seriesIndex })} className={`veto-map-card group relative min-h-48 overflow-hidden border text-left transition-[border-color,box-shadow] ${action?.kind === "ban" ? "veto-map-card--banned border-rose-400/25" : action ? "veto-map-card--picked border-emerald-400/35" : selectable ? `veto-map-card--selectable veto-map-card--${intent} border-purple-300/30 hover:border-purple-200/70` : "border-white/10"}`} style={{ background: artworkUrl ? undefined : `radial-gradient(circle at 75% 15%, ${map.accentColor}55, transparent 35%), linear-gradient(145deg, #191b28, #090a10)` }}>
            {artworkUrl ? <Image src={artworkUrl} alt="" fill sizes="(min-width: 1280px) 33vw, (min-width: 640px) 50vw, 100vw" unoptimized className="absolute inset-0 size-full object-cover opacity-70 transition duration-500 group-hover:scale-105" onError={fallbackToLogo} /> : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
            <div data-veto-flash className={`pointer-events-none invisible absolute inset-0 z-[3] opacity-0 ${action?.kind === "ban" ? "bg-rose-500" : "bg-emerald-300"}`} />
            {action?.kind === "ban" ? <div className="absolute inset-x-0 top-0 bottom-20 z-[4] grid place-items-center"><span data-veto-stamp className="veto-stamp" style={{ transform: "rotate(-8deg)" }}>Banned</span></div> : null}
            {action && action.kind !== "ban" ? <div data-veto-ribbon className="absolute left-0 top-4 z-[4] bg-emerald-300 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-950">{action.kind === "decider" ? "Decider" : `Map ${action.payload.seriesIndex || ""} · Picked`}</div> : null}
            <div className="relative flex min-h-48 flex-col justify-end p-5"><p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{action ? action.kind === "ban" ? "Banned" : action.kind === "decider" ? "Decider" : `Map ${action.payload.seriesIndex || ""}` : selectable ? `Select to ${room.currentAction?.kind}` : "Available"}</p><h3 className="mt-2 text-2xl font-black uppercase text-white">{map.name}</h3>{action && byName ? <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">{action.kind === "decider" ? byName : `by ${byName}`}</p> : null}{action?.side ? <span data-veto-side className="mt-3 w-fit bg-white/10 px-3 py-1 text-xs uppercase text-white">{action.side}</span> : null}</div>
          </button>;
        })}
      </div>

      {playedMaps.length ? <Card data-veto-panel className="p-6"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Series order</p><div className="mt-4 grid gap-3 md:grid-cols-3">{playedMaps.map((action) => { const side = room.actions.find((entry) => entry.kind === "side" && entry.payload.seriesIndex === action.payload.seriesIndex); const map = room.maps.find((entry) => entry.slug === action.mapSlug); return <div key={action.id} data-veto-series-card={action.id} className="relative overflow-hidden border border-white/10 bg-black/20 p-4" style={{ borderLeftColor: map?.accentColor, borderLeftWidth: 3 }}><span className="pointer-events-none absolute -right-2 -top-4 text-7xl font-black text-white/[.04]" aria-hidden="true">{action.payload.seriesIndex}</span><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Map {action.payload.seriesIndex} · {action.kind}</p><p className="mt-2 text-lg font-bold text-white">{action.mapName}</p><p className="mt-1 text-xs uppercase text-slate-400">{isPremier ? "Map locked - automatic decider" : side?.side ? `${label(side.side)} start` : "Side pending"}</p></div>; })}</div></Card> : null}

      {pendingDecision ? <div data-veto-dialog className="fixed inset-0 z-[100] grid place-items-center bg-black/85 p-4" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setPendingDecision(null); }}><Card data-veto-dialog-panel className={`w-full max-w-lg bg-[#10121b] p-6 shadow-[0_24px_90px_rgba(0,0,0,.7)] ${pendingDecision.kind === "ban" ? "border-rose-300/30" : "border-purple-300/30"}`} role="dialog" aria-modal="true" aria-labelledby="veto-confirm-title"><p className="text-xs uppercase tracking-[0.2em] text-purple-200">Review decision</p><h2 id="veto-confirm-title" className="mt-3 text-3xl text-white">{pendingDecision.kind === "position" ? `Choose Team ${pendingDecision.choice}?` : pendingDecision.kind === "side" ? `Start ${label(pendingDecision.side)} on ${pendingDecision.mapName}?` : `${label(pendingDecision.kind)} ${pendingDecision.mapName}?`}</h2><p className="mt-4 text-sm leading-6 text-slate-300">{pendingDecision.kind === "position" ? `The toss winner will become Team ${pendingDecision.choice}, ${pendingDecision.opensVeto ? "take the first veto action" : "wait for the first veto action"}, and the veto will start immediately.` : pendingDecision.kind === "ban" ? `${pendingDecision.mapName} will be removed from this veto. Players cannot undo this decision; match staff can rewind it if needed.` : pendingDecision.kind === "pick" ? `${pendingDecision.mapName} will be locked as Map ${pendingDecision.seriesIndex || ""}. Players cannot undo this decision; match staff can rewind it if needed.` : `${pendingDecision.mapName} will be locked with a ${label(pendingDecision.side)} start. Players cannot undo this decision; match staff can rewind it if needed.`}</p><div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="ghost" disabled={Boolean(busy)} onClick={() => setPendingDecision(null)}>Go back</Button><Button variant={pendingDecision.kind === "ban" ? "danger" : "primary"} disabled={Boolean(busy)} onClick={confirmDecision}>{pendingDecision.kind === "position" ? `Confirm Team ${pendingDecision.choice}` : pendingDecision.kind === "side" ? `Confirm ${label(pendingDecision.side)}` : `Confirm ${label(pendingDecision.kind)}`}</Button></div></Card></div> : null}
    </div>
  );
}
