import { redirect } from "next/navigation";

// The World Cup leaderboard is the same global Fun Points leaderboard.
// We keep this route so existing hub links don't break, but send users
// to the single canonical page rather than maintaining a duplicate.
export default function WorldCupLeaderboardPage() {
  redirect("/leaderboard");
}
