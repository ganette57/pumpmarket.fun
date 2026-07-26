"use client";

// src/components/play/PlayActivity.tsx
//
// The ONE Play activity view, rendered into the three existing shells that
// already host Real activity. It never renders in Real mode and never reads a
// Real table — the Real components are untouched and sit on the other side of
// an outer `isPlay ? … : …` branch at each call site.
//
// `variant` is presentation only. All three read the same hook, the same
// endpoint and the same authoritative play_trades rows; they differ in the
// chrome the surrounding surface already established:
//
//   card   — Market Detail /trade/[id]  (mirrors MarketActivity's card-pump)
//   drawer — mobile bottom sheets       (mirrors LiveActivityDrawer's rows)
//   panel  — Live desktop right column  (mirrors LiveActivity's compact rows)
//
// FACTS ONLY. Every value shown is stored on the trade: side (Play is
// buy-only), outcome, shares, USD stake, timestamp and the server-truncated
// trader label. No SOL, no derived P&L, no entry price — the engine does not
// store an authoritative average price, so none is invented here.

import { formatUsd } from "@/lib/playClient";
import {
  usePlayMarketActivity,
  type PlayActivityRow,
} from "@/components/play/usePlayMarketActivity";

export type PlayActivityVariant = "card" | "drawer" | "panel";

function relTime(iso?: string | null): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr}h` : `${Math.floor(hr / 24)}d`;
}

function formatShares(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function outcomeLabel(row: PlayActivityRow, names: string[]): string {
  if (row.outcome_name) return row.outcome_name;
  const fromMarket = names[row.outcome_index];
  if (fromMarket) return fromMarket;
  return `Outcome #${row.outcome_index + 1}`;
}

/** Outcome 0 keeps the green/YES accent the Real surfaces already use. */
function accentClass(outcomeIndex: number): string {
  return outcomeIndex === 0 ? "text-pump-green" : "text-[#ff5c73]";
}

export default function PlayActivity({
  marketAddress,
  outcomeNames,
  variant = "card",
  enabled = true,
  limit,
}: {
  marketAddress: string | null | undefined;
  /** Names from the surrounding page, used when a trade stored none. */
  outcomeNames?: string[] | null;
  variant?: PlayActivityVariant;
  /** False while the surface is closed — stops the fetch and the watcher. */
  enabled?: boolean;
  limit?: number;
}) {
  const { rows, outcomeNames: apiNames, pending, error, refresh } =
    usePlayMarketActivity(marketAddress, { enabled, limit });

  const names = outcomeNames?.length ? outcomeNames : apiNames;

  const body = (() => {
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center text-center gap-2 py-6">
          <p className="text-sm text-gray-400">Couldn't load Play activity.</p>
          <button
            onClick={refresh}
            className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-semibold text-gray-300 hover:border-gray-500 transition"
          >
            Retry
          </button>
        </div>
      );
    }

    // `pending`, not `loading`: it is already true during the debounce window,
    // so the empty state cannot flash before the first response lands.
    if (pending) {
      return (
        <div className="h-[200px] flex items-center justify-center">
          <span className="w-6 h-6 rounded-full border-2 border-pump-green/40 border-t-pump-green animate-spin" />
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <div className="h-[160px] flex flex-col items-center justify-center text-center gap-1">
          <p className="text-sm text-gray-400">No Play trades yet</p>
          <p className="text-xs text-gray-600">
            Play trades on this market will show up here.
          </p>
        </div>
      );
    }

    if (variant === "panel") {
      return (
        <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-2 text-[11px] py-1 border-b border-gray-800/40 last:border-0"
            >
              <span className="font-semibold text-pump-green">BUY</span>
              <span className="text-gray-400 truncate">{r.trader_label}</span>
              <span className="text-white font-medium truncate">
                {outcomeLabel(r, names)}
              </span>
              <span className="text-gray-500 whitespace-nowrap">
                {formatUsd(r.stake_usd)}
              </span>
              <span className="ml-auto text-gray-600 whitespace-nowrap">
                {relTime(r.created_at)}
              </span>
            </div>
          ))}
        </div>
      );
    }

    if (variant === "drawer") {
      return (
        <div className="max-h-[320px] overflow-y-auto -mx-1 px-1 space-y-1.5">
          {rows.map((r) => {
            const label = outcomeLabel(r, names);
            const initials =
              r.trader_label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() ||
              "?";
            const t = relTime(r.created_at);
            return (
              <div
                key={r.id}
                className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2"
              >
                <span
                  className={`shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-[9px] font-black ${
                    r.outcome_index === 0
                      ? "bg-pump-green/20 text-pump-green"
                      : "bg-[#ff5c73]/20 text-[#ff5c73]"
                  }`}
                >
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-white/85 truncate">
                    <span className="font-semibold">{r.trader_label}</span>{" "}
                    <span className="text-gray-400">bought</span>{" "}
                    <span className={`font-bold ${accentClass(r.outcome_index)}`}>
                      {label}
                    </span>
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {formatShares(r.shares)} shares
                    {t ? ` · ${t} ago` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] font-bold tabular-nums text-white/85">
                  {formatUsd(r.stake_usd)}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    // card
    return (
      <div className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-gray-800 bg-pump-dark/40 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">
                Buy{" "}
                <span className="text-gray-400 font-normal">
                  {formatShares(r.shares)} shares
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleString()}
              </div>
            </div>

            <div className="mt-1 text-sm text-gray-300">
              Outcome:{" "}
              <span className="text-white font-semibold">
                {outcomeLabel(r, names)}
              </span>
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
              <div>Player: {r.trader_label}</div>
              <div className="text-gray-400 font-semibold">
                {formatUsd(r.stake_usd)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  })();

  if (variant === "drawer") return body;

  if (variant === "panel") {
    return (
      <div className="card-pump p-4">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-pump-green animate-pulse" />
          Play Activity
        </h3>
        {body}
      </div>
    );
  }

  return (
    <div className="card-pump">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Play activity</h3>
        <div className="text-xs text-gray-500">
          {rows.length} trade{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      {body}
    </div>
  );
}
