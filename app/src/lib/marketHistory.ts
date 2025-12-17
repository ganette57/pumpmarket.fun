export type TxDbRow = {
    created_at: string;
    is_buy: boolean;
    amount: number; // shares
    outcome_index?: number | null; // IMPORTANT for multi
    is_yes?: boolean | null; // legacy binary
  };
  
  export type OddsPoint = {
    t: number;              // ms timestamp
    supplies: number[];     // current supplies
    pct: number[];          // percentages
  };
  
  export function buildOddsSeries(txs: TxDbRow[], outcomesCount: number): OddsPoint[] {
    const supplies = Array(outcomesCount).fill(0);
    const points: OddsPoint[] = [];
  
    for (const tx of txs) {
      const amt = Math.max(0, Math.floor(Number(tx.amount || 0)));
      if (!amt) continue;
  
      let idx = tx.outcome_index;
      if (idx == null) {
        // legacy binary fallback
        if (outcomesCount === 2 && typeof tx.is_yes === "boolean") idx = tx.is_yes ? 0 : 1;
      }
  
      if (idx == null || idx < 0 || idx >= outcomesCount) continue;
  
      const delta = tx.is_buy ? amt : -amt;
      supplies[idx] = Math.max(0, supplies[idx] + delta);
  
      const total = supplies.reduce((a, b) => a + b, 0);
      const pct = supplies.map(s => (total > 0 ? (s / total) * 100 : 100 / outcomesCount));
  
      points.push({
        t: new Date(tx.created_at).getTime(),
        supplies: supplies.slice(),
        pct,
      });
    }
  
    return points;
  }
  
  // petit downsample pour éviter 2000 points
  export function downsample(points: OddsPoint[], maxPoints = 200): OddsPoint[] {
    if (points.length <= maxPoints) return points;
    const step = Math.ceil(points.length / maxPoints);
    const out: OddsPoint[] = [];
    for (let i = 0; i < points.length; i += step) out.push(points[i]);
    if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
    return out;
  }