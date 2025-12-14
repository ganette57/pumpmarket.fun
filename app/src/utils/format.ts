// Format lamports to SOL
export function lamportsToSol(lamports: number): number {
  return lamports / 1_000_000_000;
}

// Format SOL to lamports
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}

// Calculate bonding curve price
export function calculateBondingCurvePrice(currentSupply: number): number {
  const basePrice = 0.01;
  const pricePerUnit = basePrice + (currentSupply / 100000);
  return pricePerUnit;
}

// Calculate cost for buying amount of shares
export function calculateBuyCost(currentSupply: number, amount: number): number {
  const basePrice = 0.01;
  const price = basePrice + (currentSupply / 100000);
  const cost = amount * price;
  const fee = cost * 0.01;
  return cost + fee;
}
