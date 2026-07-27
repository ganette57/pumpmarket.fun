import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import {
  getCurrentPlayContest,
  getPlayContestById,
  getPlayContestPreview,
} from "@/lib/playContests";
import { PlayEngineError } from "@/lib/playEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/preview   { contest_id?, limit? }
//
// LIVE PREVIEW of the period ranking. Recalculated from current
// authoritative Play data on every call, carries its generated_at, and is
// NEVER stored. Freezing is a separate, deliberate action.
//
// The ranking comes from rankPlayContestPeriod — the same trusted server
// helper the freeze uses — so a preview and the snapshot it produces can
// never disagree. No trade rows are sent to the browser.
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

    const rawLimit = Number(body?.limit);
    const preview = await getPlayContestPreview(contest, {
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
    });

    return contestOk({ contest, preview });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/preview");
  }
}
