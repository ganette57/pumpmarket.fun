"use client";

type HapticKind = "light" | "medium" | "success";

let lastHapticAt = 0;

export function triggerHaptic(kind: HapticKind = "light") {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;

  const now = Date.now();
  if (now - lastHapticAt < 35) return;
  lastHapticAt = now;

  if (typeof navigator.vibrate !== "function") return;

  const pattern: number | number[] =
    kind === "success" ? [16, 24, 20] : kind === "medium" ? 14 : 8;

  navigator.vibrate(pattern);
}
