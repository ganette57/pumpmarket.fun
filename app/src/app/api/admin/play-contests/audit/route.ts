import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  getCurrentPlayContest,
  getPlayContestById,
  getPlayContestWinnerAudit,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/audit   { contest_id?, wallet }
//
// The positions that produced ONE winner's contest-period result, grouped
// exactly as the Play profile groups them, with the authoritative winning
// outcome for each market. This is what makes a contest dispute auditable:
// an operator can reconcile the frozen number against the picks behind it.
//
// PRIVACY: no play_accounts UUID, no client_trade_id, no ledger row, no
// season attribution, no session data and no balance.
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.deny) return guard.deny;

  try {
    const body = await readJsonBody(req);

    const wallet = String(body?.wallet ?? "").trim();
    if (!wallet) throw new PlayEngineError("wallet is required.", 400);

    const id = String(body?.contest_id ?? "").trim();
    const contest = id ? await getPlayContestById(id) : await getCurrentPlayContest();
    if (!contest) throw new PlayEngineError("No Play contest configured.", 404);

    const audit = await getPlayContestWinnerAudit({ contest, wallet });

    return contestOk({ audit });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/audit");
  }
}
