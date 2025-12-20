// app/src/utils/outcomes.ts

export type OutcomeNames = string[] | null | undefined;

function normalizeNames(names: OutcomeNames): string[] | null {
  if (!names) return null;
  if (!Array.isArray(names)) return null;
  return names.map((n) => String(n ?? "").trim()).filter(Boolean);
}

/**
 * Retourne le bon label d'outcome en combinant :
 * - outcome_name stocké dans la tx (si présent)
 * - outcome_index + market.outcome_names
 * - fallback legacy is_yes (YES / NO)
 */
export function outcomeLabelFromMarket(
  marketLike: { outcome_names?: OutcomeNames } | null | undefined,
  opts: {
    outcomeIndex?: number | null;
    isYes?: boolean | null;
    txOutcomeName?: string | null;
    fallbackLabel?: string;
  } = {}
): string {
  const { outcomeIndex, isYes, txOutcomeName, fallbackLabel } = opts;

  // 1) Si la tx a déjà outcome_name => on le fait gagner
  if (txOutcomeName && String(txOutcomeName).trim()) {
    return String(txOutcomeName).trim();
  }

  const names = normalizeNames(marketLike?.outcome_names);
  const idx =
    outcomeIndex === null || outcomeIndex === undefined
      ? null
      : Number(outcomeIndex);

  // 2) Si on a outcome_index + names
  if (idx !== null && names && idx >= 0 && idx < names.length) {
    return names[idx];
  }

  // 3) Gestion spéciale YES/NO
  if (isYes != null) {
    if (names && names.length === 2) {
      const n0 = names[0].toUpperCase();
      const n1 = names[1].toUpperCase();
      const looksYesNo =
        (n0 === "YES" && n1 === "NO") || (n0 === "NO" && n1 === "YES");

      if (looksYesNo) {
        return isYes ? "YES" : "NO";
      }
    }
    // legacy : pas de names => on garde YES/NO
    return isYes ? "YES" : "NO";
  }

  // 4) Dernier fallback : index brut
  if (idx !== null) {
    if (names && names[idx]) return names[idx];
    return `Option ${idx + 1}`;
  }

  // 5) ultra fallback
  return fallbackLabel ?? "Outcome";
}