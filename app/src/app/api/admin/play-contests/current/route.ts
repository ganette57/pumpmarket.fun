import { requireAdmin, contestError, contestOk } from "@/lib/playContestApi";
import {
  getCurrentPlayContest,
  listPlayContestResults,
} from "@/lib/playContests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/play-contests/current
//
// The contest the admin is managing plus its FROZEN results, if any.
//
// Returns { contest: null } when none is configured — an empty state, not
// an error. Never returns a live ranking: preview is a separate, explicit
// call so a frozen snapshot can never be confused with a recalculation.
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.deny) return guard.deny;

  try {
    const contest = await getCurrentPlayContest();
    if (!contest) return contestOk({ contest: null, results: [] });

    const results = contest.frozen_at
      ? await listPlayContestResults(contest.id)
      : [];

    return contestOk({ contest, results });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/current");
  }
}
