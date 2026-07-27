import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  PLAY_PRIZE_STATUSES,
  updatePlayContestResult,
  type PlayPrizeStatus,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIZE_STATUS_SET = new Set<string>(PLAY_PRIZE_STATUSES);

// POST /api/admin/play-contests/result/update
// Body: { contest_id, result_id, prize_status?, payment_reference?, admin_note? }
//
// Updates the PAYMENT RECORD of one frozen winner and nothing else.
//
// The frozen ranking values — rank, realized P&L, picks, wins, losses, win
// rate, settled stake and prize amount — are not writable through this
// route. There is no parameter for them.
//
// Marking a row `paid` records that a payment happened somewhere else. It
// moves no money, calls no chain, creates no Play balance, mints no bonus
// and touches no wallet.
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.deny) return guard.deny;

  try {
    const body = await readJsonBody(req);

    const contestId = String(body?.contest_id ?? "").trim();
    const resultId = String(body?.result_id ?? "").trim();
    if (!contestId || !resultId) {
      throw new PlayEngineError("contest_id and result_id are required.", 400);
    }

    let prizeStatus: PlayPrizeStatus | undefined;
    if (body?.prize_status != null) {
      const raw = String(body.prize_status);
      if (!PRIZE_STATUS_SET.has(raw)) {
        throw new PlayEngineError(
          `Invalid prize status. Expected one of: ${PLAY_PRIZE_STATUSES.join(", ")}.`,
          400
        );
      }
      prizeStatus = raw as PlayPrizeStatus;
    }

    const outcome = await updatePlayContestResult({
      contestId,
      resultId,
      prizeStatus,
      paymentReference:
        body?.payment_reference !== undefined
          ? String(body.payment_reference ?? "").slice(0, 200)
          : undefined,
      adminNote:
        body?.admin_note !== undefined
          ? String(body.admin_note ?? "").slice(0, 2000)
          : undefined,
    });

    return contestOk({
      ok: true,
      result: outcome.result,
      contest: outcome.contest,
      message:
        prizeStatus === "paid"
          ? "Recorded as paid. This only records the payment — it does not send funds."
          : "Payment record updated.",
    });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/result/update");
  }
}
