"use client";

import { useEffect, useRef, useState } from "react";

type InViewOnceOptions = {
  rootMargin?: string;
  threshold?: number;
};

export function useInViewOnce<T extends HTMLElement>(opts?: InViewOnceOptions) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((entry) => entry.isIntersecting);
        if (hit) {
          setInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: opts?.rootMargin ?? "200px",
        threshold: opts?.threshold ?? 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, opts?.rootMargin, opts?.threshold]);

  return [ref, inView] as const;
}
