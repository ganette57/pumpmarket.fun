/** Display geometry only. Never used by quotes, trades or persisted history. */
export type ProbabilityPoint = { t: number; pct: number[] };
export const validProbability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

export function currentValues(current: number[], points: ProbabilityPoint[], count: number): number[] {
  if (current.length === count && current.every(validProbability) && current.some(v => v > 0)) return current;
  const last = points[points.length - 1]?.pct;
  if (last?.length === count && last.every(validProbability) && last.some(v => v > 0)) return last;
  return Array.from({ length: count }, () => 100 / Math.max(1, count));
}

export function probabilityDomain(values: number[]): [number, number] {
  const valid = values.filter(validProbability);
  if (!valid.length) return [0, 100];
  const min = Math.min(...valid), max = Math.max(...valid);
  const span = Math.min(100, Math.max(20, (max - min) * 1.3));
  const low = Math.max(0, Math.min(100 - span, (min + max - span) / 2));
  return [low, low + span];
}

/** Keep names/values apart without changing their curve endpoints or probabilities. */
export function separateLabels(ys: number[], top: number, bottom: number, gap = 42): number[] {
  const ordered = ys.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y);
  const spacing = Math.min(gap, (bottom - top) / Math.max(1, ys.length - 1));
  const result: number[] = [];
  ordered.forEach((item, i) => {
    result[item.index] = Math.max(item.y, i ? result[ordered[i - 1].index] + spacing : top);
  });
  if (ordered.length) {
    result[ordered[ordered.length - 1].index] = Math.min(bottom, result[ordered[ordered.length - 1].index]);
    for (let i = ordered.length - 2; i >= 0; i--) {
      result[ordered[i].index] = Math.min(result[ordered[i].index], result[ordered[i + 1].index] - spacing);
    }
  }
  return result;
}
