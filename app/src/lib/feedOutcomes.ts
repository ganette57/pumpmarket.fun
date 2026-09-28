/** Presentation order only; every entry remains the original trade outcome index. */
export function footballMatchOutcomeIndices({
  isSoccer,
  marketMode,
  sportMeta,
  outcomeNames,
}: {
  isSoccer: boolean;
  marketMode?: string | null;
  sportMeta?: Record<string, unknown> | null;
  outcomeNames?: string[];
}): [number, number, number] | null {
  // Official match markets use "sport". Side/prop markets must keep the
  // generic feed layout, even when they reference the same fixture.
  if (!isSoccer || marketMode !== "sport" || sportMeta?.side_market || outcomeNames?.length !== 3) {
    return null;
  }

  const normalize = (value: unknown) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const home = normalize(sportMeta?.home_team);
  const away = normalize(sportMeta?.away_team);
  if (!home || !away) return null;

  const names = outcomeNames.map(normalize);
  const indices: [number, number, number] = [
    names.indexOf(home),
    names.indexOf("draw"),
    names.indexOf(away),
  ];
  return indices.every((index) => index >= 0) && new Set(indices).size === 3
    ? indices
    : null;
}
