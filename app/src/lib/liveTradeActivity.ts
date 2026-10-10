export type LiveTradeIdentity = {
  id: string;
  market_address: string | null;
  is_buy: boolean;
  activity_mode?: "real" | "play";
};

export type NormalizedTradeActivity = LiveTradeIdentity & {
  created_at: string;
  user_address: string;
  user_label?: string | null;
  is_yes: boolean | null;
  shares: number;
  cost: number;
  cost_currency: "SOL" | "USD";
  outcome_index: number | null;
  outcome_name: string | null;
};

export type PlayTradeActivityInput = {
  id: string;
  outcome_index: number;
  outcome_name: string | null;
  side: "buy";
  shares: string;
  stake_usd: string;
  created_at: string;
  trader_label: string;
};

export const LIVE_TRADE_ACTIVITY_EVENT = "funmarket:live-trade-activity";

export function normalizeLiveMarketIdentifier(value: unknown): string {
  return String(value || "").trim();
}

export function isTradeForLiveMarket(
  trade: Pick<LiveTradeIdentity, "market_address">,
  marketAddress: string,
): boolean {
  const expected = normalizeLiveMarketIdentifier(marketAddress);
  return (
    expected.length > 0 &&
    normalizeLiveMarketIdentifier(trade.market_address) === expected
  );
}

export function enqueueLiveTradeActivity<T extends LiveTradeIdentity>(
  queue: Array<T & { _key: number }>,
  trade: T,
  marketAddress: string,
  key: number,
  expectedMode?: "real" | "play",
): Array<T & { _key: number }> {
  if (!trade.is_buy || !isTradeForLiveMarket(trade, marketAddress)) return queue;
  const tradeMode = trade.activity_mode ?? "real";
  if (expectedMode && tradeMode !== expectedMode) return queue;
  if (queue.some((item) => item.id === trade.id)) return queue;
  return [...queue, { ...trade, _key: key }].slice(-3);
}

/**
 * The ticker polls globally. On its first response we only establish a
 * baseline; later responses return genuinely new rows, oldest first, so a
 * page load never replays stale activity as if it just happened.
 */
export function collectUnseenLiveTrades<T extends Pick<LiveTradeIdentity, "id">>(
  rows: T[],
  seenIds: Set<string> | null,
): { newTrades: T[]; seenIds: Set<string> } {
  const nextSeen = new Set(seenIds || []);
  if (seenIds === null) {
    for (const row of rows) if (row.id) nextSeen.add(row.id);
    return { newTrades: [], seenIds: nextSeen };
  }

  const newTrades = rows
    .filter((row) => !!row.id && !nextSeen.has(row.id))
    .reverse();
  for (const row of rows) if (row.id) nextSeen.add(row.id);
  return { newTrades, seenIds: nextSeen };
}

/** Maps the public, server-sanitized PLAY row into the shared popup shape. */
export function normalizePlayTradeActivity(
  row: PlayTradeActivityInput,
  marketAddress: string,
  outcomeNames: string[],
): NormalizedTradeActivity {
  const explicitName = row.outcome_name?.trim() || "";
  const outcomeName = explicitName || outcomeNames[row.outcome_index] || null;
  const normalized = outcomeName?.toUpperCase();
  return {
    id: row.id,
    created_at: row.created_at,
    market_address: normalizeLiveMarketIdentifier(marketAddress),
    user_address: "",
    // The endpoint deliberately returns only this public label. "Player"
    // conveys no useful identity, so omit it rather than displaying an ID.
    user_label: row.trader_label === "Player" ? null : row.trader_label,
    is_buy: row.side === "buy",
    is_yes: normalized === "YES" ? true : normalized === "NO" ? false : null,
    shares: Number(row.shares) || 0,
    cost: Number(row.stake_usd) || 0,
    cost_currency: "USD",
    outcome_index: row.outcome_index,
    outcome_name: outcomeName,
    activity_mode: "play",
  };
}

export function publishLiveTradeActivity(trade: LiveTradeIdentity): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(LIVE_TRADE_ACTIVITY_EVENT, { detail: trade }),
  );
}

export function subscribePublishedLiveTradeActivity(
  callback: (trade: LiveTradeIdentity) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const trade = (event as CustomEvent<LiveTradeIdentity>).detail;
    if (trade?.id) callback(trade);
  };
  window.addEventListener(LIVE_TRADE_ACTIVITY_EVENT, listener);
  return () => window.removeEventListener(LIVE_TRADE_ACTIVITY_EVENT, listener);
}
