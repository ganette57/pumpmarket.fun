// src/lib/bondingCurve.ts
// Courbe linéaire simple (discrète, par share) :
// de 0.010 à 0.020 SOL entre supply 0 et 1000

export const BASE_PRICE = 0.010;
export const MAX_PRICE = 0.020;
export const MAX_SUPPLY = 1000;

export const SLOPE = (MAX_PRICE - BASE_PRICE) / MAX_SUPPLY;

function toInt(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

export function clampSupply(supply: number) {
  return Math.max(0, Math.min(MAX_SUPPLY, toInt(supply)));
}

// Prix “spot” à une supply donnée (discret)
export function priceAtSupply(supply: number) {
  const s = clampSupply(supply);
  return BASE_PRICE + SLOPE * s;
}

// Max shares achetables à partir d'une supply (si MAX_SUPPLY est un cap dur)
export function maxBuyable(currentSupply: number) {
  const s = clampSupply(currentSupply);
  return Math.max(0, MAX_SUPPLY - s);
}

// coût exact d’un BUY de n shares quand supply actuelle = s
export function quoteBuyCostSol(currentSupply: number, shares: number) {
  const s = clampSupply(currentSupply);
  const n = Math.min(toInt(shares), maxBuyable(s));

  if (n === 0) return { costSol: 0, avgPrice: priceAtSupply(s), shares: 0 };

  // somme des prix linéaires discrets: Σ (BASE + SLOPE*(s+i)) for i=0..n-1
  // = n*BASE + SLOPE*(n*s + n(n-1)/2)
  const cost =
    n * BASE_PRICE +
    SLOPE * (n * s + (n * (n - 1)) / 2);

  return { costSol: cost, avgPrice: cost / n, shares: n };
}

// “receive” exact d’un SELL de n shares quand supply actuelle = s
// (reverse integral) = coût d'un buy depuis (s-n) sur n shares
export function quoteSellReceiveSol(currentSupply: number, shares: number) {
  const s = clampSupply(currentSupply);
  const n = Math.min(toInt(shares), s);

  if (n === 0) return { receiveSol: 0, avgPrice: priceAtSupply(s), shares: 0 };

  const start = Math.max(0, s - n);
  const q = quoteBuyCostSol(start, n); // cost over interval [start..start+n)
  return { receiveSol: q.costSol, avgPrice: q.costSol / n, shares: n };
}