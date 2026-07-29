import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  cancelPlayContest,
  getCurrentPlayContest,
  getPlayContestById,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/cancel   { contest_id?, reason? }
//
// The emergency exit: disowns a contest period before any ranking has
// been frozen. The cancelled contest disappears from the public
// competition view and stops being the admin's current contest, so the
// create form returns.
//
// Allowed from draft / live / ended only. Refused once results are
// frozen — under_review, verified and paid all have a snapshot that a
// prize is paid against, and cancelling one would orphan a frozen
// winner. `closed` is refused because it is already terminal.
//
// Records no result row, no prize and no payment. Changes no play_trade,
// no settlement and no balance. Cancelling a LIVE contest discards the
// competition period for prize purposes and nothing else: every trade
// made inside it stays as it was and still settles normally.
//
// Idempotent: a repeat returns the contest unchanged.
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

    const outcome = await cancelPlayContest({
      contest,
      adminWallet: guard.wallet,
      reason: body?.reason != null ? String(body.reason) : null,
    });

    if (outcome.cancelled) {
      // The acting wallet lives here rather than in a new column: a
      // cancellation records no prize decision that would need one.
      console.info(
        `[play-contest] cancelled ${outcome.contest.id} by ${guard.wallet}`
      );
    }

    return contestOk({
      ok: true,
      cancelled: outcome.cancelled,
      contest: outcome.contest,
      message: outcome.cancelled
        ? "Contest cancelled. It no longer appears publicly, and you can create the next one."
        : "Already cancelled — nothing changed.",
    });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/cancel");
  }
}
