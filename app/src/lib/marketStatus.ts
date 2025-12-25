// app/src/lib/marketStatus.ts
export type MarketLike = {
    resolved?: boolean;
    resolutionTime?: number; // unix seconds
  };
  
  export function isMarketResolved(m: MarketLike) {
    const nowSec = Date.now() / 1000;
    return !!m.resolved || (!!m.resolutionTime && nowSec >= m.resolutionTime);
  }
  
  export type StatusFilter = "all" | "open" | "resolved";
  
  export function filterByStatus<T extends MarketLike>(rows: T[], status: StatusFilter) {
    if (status === "all") return rows;
    if (status === "resolved") return rows.filter((m) => isMarketResolved(m));
    return rows.filter((m) => !isMarketResolved(m));
  }