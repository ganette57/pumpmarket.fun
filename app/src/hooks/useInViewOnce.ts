"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

type InViewOpts = {
  rootMargin?: string;
  threshold?: number;
};

export function useInViewOnce<T extends HTMLElement>(
  opts: InViewOpts = {}
): { ref: RefObject<T>; inView: boolean } {
  const { rootMargin = "200px", threshold = 0 } = opts;
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin, threshold]);

  return { ref, inView };
}
