import type { Metadata } from "next";
import LeaderboardByMode from "@/components/leaderboard/LeaderboardByMode";
import RealLeaderboardView from "@/components/real/RealLeaderboardView";

// Leaderboard shell.
//
// ONE route, two rankings, chosen by the global trading mode:
//
//   PLAY → the active contest, ranked by realized profit inside its period.
//   REAL → the all-time board, ranked by CLAIMED PROFIT in SOL.
//
// The branch is a mount/unmount inside LeaderboardByMode, so neither side
// can read the other's data or leave state behind when the mode changes.
//
// Both modes share one minimal presentation while retaining their separate
// endpoints and ranking semantics.

// Mode-NEUTRAL on purpose. Metadata is resolved on the server, where the
// trading mode is a client cookie that this route does not read, so a
// Real-specific title would sit in the tab while a Play visitor is looking
// at the Play contest board. The branding lives in each view's hero.
export const metadata: Metadata = {
  title: "Leaderboard — FunMarket",
  description: "Trader rankings on FunMarket.",
};

export default function LeaderboardPage() {
  return <LeaderboardByMode real={<RealLeaderboardView />} />;
}
