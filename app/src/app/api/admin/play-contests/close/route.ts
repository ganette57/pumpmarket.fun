import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  closePlayContest,
  getCurrentPlayContest,
  getPlayContestById,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/close   { contest_id?, note? }
//
// Closes a contest that ran normally and produced NO payable ranking, so
// the operator can create the next one. Without this an `ended` contest
// with zero eligible players sits forever as the current contest and the
// create form never returns.
//
// REFUSED, with no override, when any eligible player exists — the
// correct action there is Freeze, and a bypass would let real winners be
// discarded with one click. Also refused while a contest-period market is
// still unresolved, since those positions could still become eligible,
// and once results are frozen.
//
// Creates no result row, records no prize, moves no money, calls no chain
// and touches no play_trades. Idempotent: a repeat on an already-closed
// contest returns it unchanged and reports closed: false.
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

    const outcome = await closePlayContest({
      contest,
      adminWallet: guard.wallet,
      note: body?.note != null ? String(body.note) : null,
    });

    if (outcome.closed) {
      // The acting wallet lives here rather than in a new column: the
      // schema has no closed_by, and a close records no prize decision
      // that would need one.
      console.info(
        `[play-contest] closed ${outcome.contest.id} by ${guard.wallet}`
      );
    }

    return contestOk({
      ok: true,
      closed: outcome.closed,
      contest: outcome.contest,
      message: outcome.closed
        ? "Contest closed. You can now create the next contest."
        : "Already closed — nothing changed.",
    });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/close");
  }
}
