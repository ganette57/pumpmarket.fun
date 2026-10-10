export type LinkedLiveMarketLifecycle = {
  resolved?: boolean | null;
  cancelled?: boolean | null;
  resolutionStatus?: string | null;
};

/**
 * A host may end the stream session once its linked market has a durable
 * resolution path: a result has been proposed, or the market is already
 * finalized/resolved/cancelled. Ending the stream never advances the market.
 * A missing snapshot fails closed.
 */
export function linkedLiveMarketRequiresResolution(input: {
  marketAddress?: string | null;
  market: LinkedLiveMarketLifecycle | null | undefined;
}): boolean {
  if (!String(input.marketAddress || "").trim()) return false;
  if (!input.market) return true;
  if (input.market.resolved || input.market.cancelled) return false;
  const status = String(input.market.resolutionStatus || "").trim().toLowerCase();
  return !["proposed", "finalized", "resolved", "cancelled"].includes(status);
}
