import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  getCurrentPlayContest,
  getPlayContestById,
  verifyPlayContest,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/verify   { contest_id? }
//
// Records that the FROZEN snapshot has been reviewed: sets verified_at and
// verified_by, moves the contest to `verified`, and moves still-pending
// prize rows to `verified`.
//
// Allowed only after freeze. Recalculates nothing. Mutates no rank, no
// realized P&L and no prize amount. Idempotent — a repeat reports
// verified: false and changes nothing.
//
// Confirms a winner ranking. Sends no prizes.
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

    const outcome = await verifyPlayContest({ contest, adminWallet: guard.wallet });

    return contestOk({
      ok: true,
      verified: outcome.verified,
      contest: outcome.contest,
      results: outcome.results,
      message: outcome.verified
        ? "Frozen results verified. No prizes were sent."
        : "Already verified — nothing changed.",
    });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/verify");
  }
}
