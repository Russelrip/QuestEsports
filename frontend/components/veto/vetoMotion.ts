"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

// Environments without matchMedia (tests, very old browsers) get the static
// end state, the same as a viewer who asked for reduced motion.
export const prefersReducedMotion = () =>
  typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function introTimeline(scope: HTMLElement) {
  const q = gsap.utils.selector(scope);
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(q("[data-veto-hero] > *"), { y: 24, autoAlpha: 0, duration: 0.6, stagger: 0.08 })
    .from(q("[data-veto-team='1']"), { x: -80, autoAlpha: 0, duration: 0.7 }, "-=0.35")
    .from(q("[data-veto-team='2']"), { x: 80, autoAlpha: 0, duration: 0.7 }, "<")
    .from(q("[data-veto-vs]"), { scale: 0, rotate: -180, autoAlpha: 0, duration: 0.6, ease: "back.out(2.2)" }, "-=0.45")
    .from(q("[data-veto-panel]"), { y: 30, autoAlpha: 0, duration: 0.55, stagger: 0.1 }, "-=0.3")
    .from(q("[data-veto-map]"), { y: 40, scale: 0.94, autoAlpha: 0, duration: 0.55, stagger: { each: 0.06, from: "start" } }, "-=0.35");
  return tl;
}

export function coinFlip(coin: Element, onLand?: () => void) {
  return gsap.timeline({ onComplete: onLand })
    .set(coin, { transformPerspective: 700 })
    .to(coin, { y: -90, scale: 1.15, duration: 0.55, ease: "power2.out" })
    .to(coin, { rotationY: "+=1800", rotationX: 20, duration: 1.1, ease: "power2.inOut" }, 0)
    .to(coin, { y: 0, scale: 1, rotationX: 0, duration: 0.55, ease: "bounce.out" }, 0.55)
    .fromTo(coin, { boxShadow: "0 0 0px rgba(168,85,247,0)" }, { boxShadow: "0 0 90px rgba(168,85,247,.75)", duration: 0.3, yoyo: true, repeat: 1 }, 1.05);
}

export function banSlam(card: Element) {
  const stamp = card.querySelector("[data-veto-stamp]");
  const flash = card.querySelector("[data-veto-flash]");
  const tl = gsap.timeline();
  tl.fromTo(card, { x: 0 }, { x: 8, duration: 0.05, repeat: 5, yoyo: true, ease: "none", clearProps: "x" });
  if (flash) tl.fromTo(flash, { autoAlpha: 0.85 }, { autoAlpha: 0, duration: 0.6, ease: "power2.out" }, 0);
  if (stamp) tl.fromTo(stamp, { scale: 2.6, rotate: -18, autoAlpha: 0 }, { scale: 1, rotate: -8, autoAlpha: 1, duration: 0.45, ease: "back.out(3)" }, 0.05);
  return tl;
}

export function pickGlow(card: Element) {
  const ribbon = card.querySelector("[data-veto-ribbon]");
  const flash = card.querySelector("[data-veto-flash]");
  const tl = gsap.timeline();
  tl.fromTo(card, { scale: 1.06, y: -12 }, { scale: 1, y: 0, duration: 0.7, ease: "elastic.out(1, 0.55)", clearProps: "transform" });
  if (flash) tl.fromTo(flash, { autoAlpha: 0.7 }, { autoAlpha: 0, duration: 0.8, ease: "power2.out" }, 0);
  if (ribbon) tl.fromTo(ribbon, { xPercent: -110 }, { xPercent: 0, duration: 0.5, ease: "power3.out" }, 0.1);
  return tl;
}

export function turnPulse(target: Element, color: string) {
  return gsap.fromTo(target,
    { boxShadow: `0 0 0 0 ${color}00, inset 0 0 0 1px ${color}55` },
    { boxShadow: `0 0 42px 2px ${color}66, inset 0 0 0 1px ${color}cc`, duration: 1.1, repeat: -1, yoyo: true, ease: "sine.inOut" });
}

export function headingSwap(target: Element) {
  return gsap.fromTo(target, { y: 14, autoAlpha: 0, filter: "blur(6px)" }, { y: 0, autoAlpha: 1, filter: "blur(0px)", duration: 0.5, ease: "power3.out", clearProps: "filter" });
}

export function dialogIn(backdrop: Element, panel: Element) {
  return gsap.timeline()
    .fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2, ease: "power1.out" })
    .fromTo(panel, { y: 30, scale: 0.94, autoAlpha: 0 }, { y: 0, scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(1.6)" }, 0.05);
}

export { gsap, useGSAP };
