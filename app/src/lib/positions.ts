// src/lib/positions.ts
export type TxRow = {
    market_address: string;
    trader?: string;   // ou "wallet" selon ta colonne
    wallet?: string;   // fallback
    outcome_index: number;
    side: "buy" | "sell";
    shares: number;
  };
  
  export function computeHoldingsFromTransactions(txs: TxRow[], outcomesCount: number) {
    const pos = Array(outcomesCount).fill(0);
  
    for (const t of txs) {
      const i = Number(t.outcome_index);
      const sh = Math.floor(Number(t.shares || 0));
      if (!Number.isFinite(i) || i < 0 || i >= outcomesCount) continue;
  
      if (t.side === "buy") pos[i] += sh;
      else pos[i] -= sh;
    }
  
    return pos.map((x) => Math.max(0, Math.floor(x)));
  }