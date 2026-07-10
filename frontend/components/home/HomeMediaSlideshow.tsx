"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const slides = [
  {
    src: "/images/hero-bg.jpg",
    alt: "Quest Esports event atmosphere",
    label: "Match Moments",
    title: "Spectra matches and face-cam highlights",
  },
  {
    src: "/images/banner.jpg",
    alt: "Quest Esports banner",
    label: "Quest Events",
    title: "Competition, community, and tournament stories",
  },
  {
    src: "/images/face-camera-angle-examples.jpg",
    alt: "Face camera setup examples",
    label: "Behind The Scenes",
    title: "Player face cams and interviews coming soon",
  },
] as const;

export default function HomeMediaSlideshow() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        setActiveIndex((current) => (current + 1) % slides.length);
      }
    }, 5000);

    return () => window.clearInterval(timer);
  }, []);

  const activeSlide = slides[activeIndex];

  return (
    <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-black/30 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
      <div className="relative aspect-video min-h-72">
          <div key={activeSlide.src} className="modal-backdrop-enter absolute inset-0">
            <Image
              src={activeSlide.src}
              alt={activeSlide.alt}
              fill
              priority={activeIndex === 0}
              sizes="(min-width: 1024px) 48vw, 100vw"
              className="object-cover"
            />
          </div>

        <div className="absolute inset-x-0 bottom-0 bg-black/80 p-5 sm:p-7">
            <div key={activeSlide.title} className="popover-enter">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100/80">
                {activeSlide.label}
              </p>
              <p className="mt-2 max-w-md font-display text-xl leading-tight text-white sm:text-2xl">
                {activeSlide.title}
              </p>
            </div>

          <div className="mt-5 flex gap-2">
            {slides.map((slide, index) => (
              <button
                key={slide.src}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "h-1.5 rounded-full bg-white/35 transition-all",
                  activeIndex === index ? "w-9 bg-white" : "w-4 hover:bg-white/60"
                )}
                aria-label={`Show slide ${index + 1}: ${slide.label}`}
                aria-current={activeIndex === index}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
