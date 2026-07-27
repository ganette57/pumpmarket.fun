import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  freezePlayContest,
  getCurrentPlayContest,
  getPlayContestById,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/freeze
// Body: { contest_id?, override_unresolved?, override_not_ended? }
//
// Turns the period ranking into an IMMUTABLE snapshot in
// play_contest_results and moves the contest to `under_review`.
//
// BLOCKED BY DEFAULT while any market with contest-period Play activity is
// still unresolved, and while the window is still running. Both overrides
// are explicit booleans a caller has to opt into — they are never inferred
// from a retry, and the UI requires a typed confirmation for them.
//
// IDEMPOTENT. A repeated freeze returns the EXISTING rows and reports
// froze: false. It never recalculates, never duplicates a winner and never
// overwrites a frozen value.
//
// Freezes a ranking. Sends nothing.
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.deny) return guard.deny;

  try {
    const body = await readJsonBody(req);
    const id = String(body?.contest_id ?? "").trim();

    const contest = id ? await getPlayContestById(id) : await getCurrentPlayContest();
    if (!contest) {
      throw new PlayEngineError("No Play contest configured.", 404);
    }

    const outcome = await freezePlayContest({
      contest,
      adminWallet: guard.wallet,
      overrideUnresolved: body?.override_unresolved === true,
      overrideNotEnded: body?.override_not_ended === true,
    });

    return contestOk({
      ok: true,
      froze: outcome.froze,
      contest: outcome.contest,
      results: outcome.results,
      unresolved_markets: outcome.unresolved_markets,
      message: outcome.froze
        ? `Results frozen at ${outcome.contest.frozen_at}.`
        : "Already frozen — returning the existing snapshot unchanged.",
    });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/freeze");
  }
}
