// src/lib/bondingCurve.ts

// Exemple: de 0.010 à 0.020 SOL entre supply 0 et 1000
const BASE_PRICE = 0.010;
const MAX_PRICE = 0.020;
const MAX_SUPPLY = 1000;

const SLOPE = (MAX_PRICE - BASE_PRICE) / MAX_SUPPLY;

export function priceAtSupply(supply: number) {
  const s = Math.max(0, Number(supply) || 0);
  return BASE_PRICE + SLOPE * s;
}

// coût exact d’un BUY de n shares quand supply actuelle = s
export function quoteBuyCostSol(currentSupply: number, shares: number) {
  const s = Math.max(0, Math.floor(Number(currentSupply) || 0));
  const n = Math.max(0, Math.floor(Number(shares) || 0));
  if (n === 0) return { costSol: 0, avgPrice: priceAtSupply(s) };

  // somme des prix linéaires: Σ (BASE + SLOPE*(s+i))
  // = n*BASE + SLOPE*(n*s + n(n-1)/2)
  const cost =
    n * BASE_PRICE +
    SLOPE * (n * s + (n * (n - 1)) / 2);

  return { costSol: cost, avgPrice: cost / n };
}