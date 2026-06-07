// app/src/lib/sideMarketTitle.ts
// Shared helper for composing user soccer side-market titles with their match
// context. Used at creation time (create page) and for display of older
// side markets in the World Cup hub.

/**
 * Prefix a side-market question with its match label:
 *   withMatchPrefix("Brazil vs Morocco", "Hakimi to score?")
 *     → "Brazil vs Morocco: Hakimi to score?"
 *
 * Skips only when the question already STARTS WITH the same match label
 * (case-insensitive, with or without a ":"/"—"/"-" separator) so we never
 * double-prefix. Returns the question unchanged when no label is available.
 */
export function withMatchPrefix(matchLabel: string, question: string): string {
  const label = (matchLabel || "").trim();
  const q = (question || "").trim();
  if (!label) return q;
  if (!q) return label;

  const normLabel = label.toLowerCase();
  const normQ = q.toLowerCase();
  if (
    normQ === normLabel ||
    normQ.startsWith(`${normLabel}:`) ||
    normQ.startsWith(`${normLabel} —`) ||
    normQ.startsWith(`${normLabel} -`)
  ) {
    return q;
  }

  return `${label}: ${q}`;
}
