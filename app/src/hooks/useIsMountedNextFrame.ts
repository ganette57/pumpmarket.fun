"use client";

import { useEffect, useState } from "react";

export function useIsMountedNextFrame(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return mounted;
}
