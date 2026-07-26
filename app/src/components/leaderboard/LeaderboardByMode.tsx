"use client";

// src/components/leaderboard/LeaderboardByMode.tsx
//
// ONE route, two views — the same pattern src/app/profile/[wallet]/page.tsx
// already uses.
//
// The branch is a mount/unmount, not a CSS hide: in Play mode the `real` slot
// is not rendered at all, and in Real mode PlayLeaderboardView is not mounted,
// so no Play request runs and no Play row can linger. Switching back re-mounts
// the other side clean, with no page reload and no second route.
//
// `real` is a SLOT, not a component reference: the Real leaderboard stays
// server-rendered in src/app/leaderboard/page.tsx, unchanged, and is simply
// passed through here. That keeps this file from having any opinion about — or
// any ability to alter — what Real renders.

import type { ReactNode } from "react";
import { useTradingMode } from "@/components/mode/ModeProvider";
import PlayLeaderboardView from "@/components/play/PlayLeaderboardView";

export default function LeaderboardByMode({ real }: { real: ReactNode }) {
  const { isPlay } = useTradingMode();

  if (isPlay) return <PlayLeaderboardView />;
  return <>{real}</>;
}
