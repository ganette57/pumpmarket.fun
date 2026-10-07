"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaySession } from "@/components/play/PlaySessionProvider";
import { playClient, formatUsd } from "@/lib/playClient";

import { useRealQuotes } from "@/hooks/useRealQuotes";
import { formatFeedMultiplier } from "@/hooks/useFeedMultipliers";

type Props = {
  marketAddress: string;
  isPlay: boolean;
  version?: string | null;
  names: string[];
  indices: number[];
  values: number[];
  colors: string[];
  drawIndex?: number;
  closed: boolean;
  winningIndex?: number | null;
  onChoose: (index: number) => void;
};

export default function MobileTradeOutcomes({ marketAddress, isPlay, version, names, indices, values, colors, drawIndex, closed, winningIndex, onChoose }: Props) {
  const realQuotes = useRealQuotes(marketAddress, !isPlay && !closed, version ?? "");
  const session = usePlaySession();
  const [quotes, setQuotes] = useState<{ key: string; payouts: (string | null)[] } | null>(null);
  const lastRequest = useRef(0);
  const quoteKey = `${marketAddress}:${version ?? ""}:${session.authenticated}:${session.balanceUsd}:${session.identityKind}:${names.length}`;
  const count = names.length;
  useEffect(() => {
    if (!isPlay || closed || !session.authenticated) { setQuotes(null); return; }
    let cancelled = false;
    // One batch per changed book/session; coalesce updates and cap to one batch / 15s.
    // No polling, wallet prompts, per-render requests or transaction calls.
    const timer = setTimeout(async () => {
      lastRequest.current = Date.now();
      const results = await Promise.allSettled(Array.from({ length: count }, (_, outcomeIndex) =>
        playClient.quote({ marketAddress, outcomeIndex, stakeUsd: "100.00" })
      ));
      if (!cancelled) setQuotes({ key: quoteKey, payouts: results.map(result => {
        if (result.status !== "fulfilled") return null;
        const value = result.value.estimated_payout_usd;
        return Number.isFinite(Number(value)) && Number(value) >= 0 ? value : null;
      }) });
    }, Math.max(250, 15000 - (Date.now() - lastRequest.current)));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isPlay, closed, session.authenticated, marketAddress, count, quoteKey]);

  return <div className={`grid gap-2 ${names.length === 3 ? "grid-cols-3" : "grid-cols-2"}`} aria-label="Choose an outcome">
    {indices.map(index => {
      const payout = isPlay && session.authenticated && quotes?.key === quoteKey ? quotes.payouts[index] : null;
      return <button key={index} type="button" onClick={() => onChoose(index)} disabled={closed}
        title={names[index]}
        className="flex min-h-[136px] min-w-0 flex-col justify-between rounded-[18px] px-3 py-3 text-left transition-transform duration-150 ease-out active:scale-[.965] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pump-green disabled:opacity-65"
        style={{ backgroundColor: index === drawIndex ? "#262626" : colors[index], color: index === drawIndex ? "white" : "black" }}>
        <span className="line-clamp-2 text-xs font-bold uppercase leading-4 tracking-wide">{names[index]}</span>
        <span className={`block ${names.length === 3 ? "text-[27px]" : "text-[32px]"} font-bold leading-none tabular-nums`}>{values[index].toFixed(1).replace(/\.0$/, "")}%</span>
        <span className="block text-[11px] leading-4 opacity-70">
          {closed ? winningIndex === index ? "Winner" : "Trading closed" : payout != null ? <>
            <span className="block whitespace-nowrap font-semibold">$100 → {formatUsd(payout)}</span>
            <span className="block text-[9px]">Est. total if win</span>
          </> : isPlay ? session.authenticated ? "Est. return —" : "Return after sign-in" : realQuotes[index]?.multiplier != null ? `${formatFeedMultiplier(realQuotes[index]?.multiplier)} return` : "Return in trade"}
        </span>
      </button>;
    })}
  </div>;
}
