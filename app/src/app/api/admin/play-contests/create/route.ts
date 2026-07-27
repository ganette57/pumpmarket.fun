import {
  requireAdmin,
  contestError,
  contestOk,
  readJsonBody,
} from "@/lib/playContestApi";
import { createPlayContest } from "@/lib/playContests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/admin/play-contests/create
// Body: { name, starts_at, ends_at, prize_pool_usd,
//         first_prize_usd, second_prize_usd, third_prize_usd, notes? }
//
// Creates ONE manually configured contest period. No recurrence, no
// scheduling. Every rule (start < end, prizes sum to the pool, no negative
// amounts, no overlapping active contest) is enforced server-side in
// createPlayContest and repeated by CHECK constraints in the database.
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.deny) return guard.deny;

  try {
    const body = await readJsonBody(req);

    const contest = await createPlayContest({
      name: String(body?.name ?? ""),
      startsAt: String(body?.starts_at ?? ""),
      endsAt: String(body?.ends_at ?? ""),
      prizePoolUsd: String(body?.prize_pool_usd ?? ""),
      firstPrizeUsd: String(body?.first_prize_usd ?? ""),
      secondPrizeUsd: String(body?.second_prize_usd ?? ""),
      thirdPrizeUsd: String(body?.third_prize_usd ?? ""),
      notes: body?.notes != null ? String(body.notes) : null,
      adminWallet: guard.wallet,
    });

    return contestOk({ ok: true, contest });
  } catch (e) {
    return contestError(e, "/api/admin/play-contests/create");
  }
}
