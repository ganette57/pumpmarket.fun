// app/src/app/world-cup/_components/TreasuryPreview.tsx
"use client";

import { TREASURY } from "./mockData";

export default function TreasuryPreview() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Stats */}
      <div className="space-y-3 lg:col-span-1">
        <TreasuryStat label="Prize Pool" value={TREASURY.prizePool} accent />
        <TreasuryStat label="Fees Generated" value={TREASURY.feesGenerated} />
        <TreasuryStat label="Treasury Balance" value={TREASURY.treasuryBalance} />
      </div>

      {/* Recent transactions */}
      <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#05070b] lg:col-span-2">
        <div className="border-b border-gray-800 bg-pump-gray/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Recent Transactions
        </div>
        <ul className="divide-y divide-gray-800">
          {TREASURY.recent.map((tx) => {
            const isOut = tx.amount.trim().startsWith("−");
            return (
              <li
                key={tx.id}
                className="grid grid-cols-12 items-center gap-2 px-4 py-3 text-sm"
              >
                <div className="col-span-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      isOut
                        ? "bg-red-500/15 text-red-400"
                        : "bg-pump-green/15 text-pump-green"
                    }`}
                  >
                    {tx.kind}
                  </span>
                </div>
                <div className="col-span-6 truncate text-gray-300">{tx.from}</div>
                <div
                  className={`col-span-2 text-right font-bold tabular-nums ${
                    isOut ? "text-red-400" : "text-pump-green"
                  }`}
                >
                  {tx.amount}
                </div>
                <div className="col-span-2 text-right text-[11px] text-gray-500">
                  {tx.time}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function TreasuryStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-[#05070b] px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div
        className="mt-1 text-lg font-extrabold tabular-nums"
        style={{ color: accent ? "#EAB54C" : "#00ff88" }}
      >
        {value}
      </div>
    </div>
  );
}
