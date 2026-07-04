"use client";

import { useEffect } from "react";
import gsap from "gsap";
import Lenis from "lenis";

/**
 * Page-level motion: Lenis smooth scrolling plus a one-time GSAP entrance
 * stagger over [data-animate] sections. Everything is skipped when the user
 * prefers reduced motion, and inner scroll containers opt out of Lenis with
 * data-lenis-prevent (the live-activity log auto-scrolls itself).
 */
export default function PageMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ duration: 1.05, smoothWheel: true });
    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    const ctx = gsap.context(() => {
      gsap.fromTo(
        "[data-animate]",
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.55, ease: "power2.out", stagger: 0.07, clearProps: "all" },
      );
    });

    return () => {
      ctx.revert();
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
}
