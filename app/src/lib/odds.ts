// app/src/lib/odds.ts

/**
 * Calcule des cotes "bookmaker" à partir des supplies.
 *
 * @param supplies  tableau de supply par outcome (ex: [251, 439])
 * @param margin    marge globale de la plateforme (0.05 = 5%)
 *
 * Retourne un objet avec:
 * - probs:   probas implicites (0–1)
 * - odds:    cotes nettes (ex: 2.61 => x2.61)
 */
export function computeOddsFromSupply(
    supplies: number[],
    margin: number = 0.05
  ): { probs: number[]; odds: number[] } {
    const n = supplies.length || 0;
    if (n === 0) {
      return { probs: [], odds: [] };
    }
  
    const totalSupply = supplies.reduce(
      (sum, s) => sum + (Number.isFinite(s) ? Number(s) : 0),
      0
    );
  
    // Probas implicites (si pas de liquidité → égalité)
    const baseProbs =
      totalSupply > 0
        ? supplies.map((s) => (Number(s) || 0) / totalSupply)
        : Array(n).fill(1 / n);
  
    // Sécurités
    const cleanProbs = baseProbs.map((p) =>
      !Number.isFinite(p) || p <= 0 ? 1 / n : p
    );
  
    // Marge: 1 - margin = fraction redistribuée aux joueurs
    const payoutFraction = Math.max(0.5, Math.min(1, 1 - margin));
  
    const odds = cleanProbs.map((p) => {
      const o = payoutFraction / p;
      // on borne les cotes pour éviter les trucs absurdes
      return Math.max(1.01, Math.min(1000, o));
    });
  
    return { probs: cleanProbs, odds };
  }