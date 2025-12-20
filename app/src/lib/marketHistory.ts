// app/src/lib/marketHistory.ts

export type TxRow = {
  created_at: string;
  is_buy: boolean;
  is_yes?: boolean | null;
  amount: number | string;
  outcome_index: number | null;
  shares?: number | string | null;
};

export type OddsPoint = {
  t: number;      // timestamp ms
  pct: number[];  // percentages per outcome
};

/**
 * Rejoue toutes les transactions pour reconstruire les supplies
 * et donc les probabilités par outcome.
 */
export function buildOddsSeries(
  rows: TxRow[],
  outcomesCount: number
): OddsPoint[] {
  if (!outcomesCount || outcomesCount <= 0) return [];

  const supplies = new Array<number>(outcomesCount).fill(0);
  const result: OddsPoint[] = [];

  // on s'assure que c'est trié par date
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const tx of sorted) {
    let idx = tx.outcome_index;

    // fallback binaire si outcome_index manquant
    if (
      (idx === null || idx === undefined || Number.isNaN(idx)) &&
      outcomesCount === 2 &&
      tx.is_yes != null
    ) {
      idx = tx.is_yes ? 0 : 1;
    }

    if (idx == null || idx < 0 || idx >= outcomesCount) {
      continue; // impossible de l'appliquer proprement
    }

    const rawShares =
      tx.shares != null ? Number(tx.shares) : Number(tx.amount ?? 0);

    if (!rawShares || Number.isNaN(rawShares)) continue;

    const delta = tx.is_buy ? rawShares : -rawShares;
    supplies[idx] = Math.max(0, supplies[idx] + delta);

    const total = supplies.reduce((s, v) => s + (v || 0), 0);
    const pct =
      total > 0
        ? supplies.map((s) => ((s || 0) / total) * 100)
        : supplies.map(() => 0);

    result.push({
      t: new Date(tx.created_at).getTime(),
      pct,
    });
  }

  return result;
}

/**
 * Downsample très simple: on prend environ `maxPoints` points,
 * en gardant le shape global.
 */
export function downsample(points: OddsPoint[], maxPoints: number): OddsPoint[] {
  if (points.length <= maxPoints) return points;

  const step = Math.ceil(points.length / maxPoints);
  const res: OddsPoint[] = [];

  for (let i = 0; i < points.length; i += step) {
    res.push(points[i]);
  }

  // s'assurer qu'on garde le dernier point
  if (res[res.length - 1] !== points[points.length - 1]) {
    res.push(points[points.length - 1]);
  }

  return res;
}