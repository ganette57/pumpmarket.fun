// app/src/app/world-cup/_components/WorldCupMarketsBrowser.tsx
"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import MarketCard from "@/components/MarketCard";
import WorldCupMatchMarketCard from "./WorldCupMatchMarketCard";
import type { WorldCupMarket } from "../_lib/marketQueries";

type StatusFilter = "open" | "ended" | "all";

export default function WorldCupMarketsBrowser({
  markets,
  emptyLabel,
  cardKind = "side",
}: {
  markets: WorldCupMarket[];
  emptyLabel: string;
  /** "match" → 3-way match card; "side" → standard MarketCard. */
  cardKind?: "match" | "side";
}) {
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("open");

  // Unique team list (from home/away) for the dropdown.
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const m of markets) {
      if (m.homeTeam) set.add(m.homeTeam);
      if (m.awayTeam) set.add(m.awayTeam);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [markets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markets.filter((m) => {
      // status
      if (status === "open" && m.ended) return false;
      if (status === "ended" && !m.ended) return false;
      // team
      if (team !== "all") {
        if (m.homeTeam !== team && m.awayTeam !== team) return false;
      }
      // search (question + teams)
      if (q.length > 0) {
        const haystack = `${m.question} ${m.homeTeam || ""} ${m.awayTeam || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [markets, query, team, status]);

  return (
    <div>
      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center rounded-lg border border-gray-700/60 bg-black px-3 py-2 text-sm">
          <Search className="mr-2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by team or question..."
            className="w-full bg-transparent text-gray-100 placeholder:text-gray-500 focus:outline-none"
          />
        </div>

        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-lg border border-gray-700/60 bg-black px-3 py-2 text-sm text-gray-100 focus:outline-none"
        >
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <div className="inline-flex overflow-hidden rounded-lg border border-gray-700/60">
          {(["open", "ended", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-2 text-xs font-semibold capitalize transition ${
                status === s
                  ? "bg-pump-green text-black"
                  : "bg-black text-gray-300 hover:text-white"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {filtered.length > 0 ? (
        <>
          <p className="mb-4 text-xs text-gray-500">
            {filtered.length} market{filtered.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 gap-4 auto-rows-fr sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((m) =>
              cardKind === "match" ? (
                <WorldCupMatchMarketCard key={m.publicKey} market={m} />
              ) : (
                <MarketCard key={m.publicKey} market={m} />
              ),
            )}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-gray-800 bg-[#05070b] px-4 py-10 text-center text-sm text-gray-400">
          {markets.length === 0 ? emptyLabel : "No markets match your filters."}
        </div>
      )}
    </div>
  );
}
