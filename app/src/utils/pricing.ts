export function calculateBondingCurvePrice(currentSupply: number): number {
  return 0.0001 + currentSupply * 0.0000001;
}

export function calculateBuyCost(currentSupply: number, amount: number): number {
  let cost = 0;
  for (let i = 0; i < amount; i++) {
    cost += calculateBondingCurvePrice(currentSupply + i);
  }
  return cost * 1.02; // 2% fees
}
