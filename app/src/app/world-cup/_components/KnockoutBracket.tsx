// app/src/app/world-cup/_components/KnockoutBracket.tsx
"use client";

import { Trophy } from "lucide-react";
import { KNOCKOUT, GOLD, type BracketMatch } from "./mockData";

const ROUNDS: { key: keyof typeof KNOCKOUT; label: string }[] = [
  { key: "r16", label: "Round of 16" },
  { key: "qf", label: "Quarter Finals" },
  { key: "sf", label: "Semi Finals" },
  { key: "final", label: "Final" },
];

export default function KnockoutBracket() {
  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
      style={{ scrollbarWidth: "thin" }}
    >
      <div className="flex min-w-[760px] gap-4">
        {ROUNDS.map(({ key, label }) => {
          const matches = KNOCKOUT[key] as BracketMatch[];
          return (
            <div
              key={key}
              className="flex flex-1 flex-col"
              style={{ minWidth: 180 }}
            >
              <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {key === "final" && (
                  <Trophy className="h-3.5 w-3.5" style={{ color: GOLD }} />
                )}
                {label}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {matches.map((m, i) => (
                  <BracketCard key={`${key}-${i}`} match={m} highlight={key === "final"} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketCard({ match, highlight = false }: { match: BracketMatch; highlight?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2.5 text-xs ${
        highlight
          ? "border-[#EAB54C]/50 bg-[#EAB54C]/5"
          : "border-gray-800 bg-[#05070b]"
      }`}
    >
      <TeamRow team={match.home} />
      <div className="my-1 h-px bg-gray-800" />
      <TeamRow team={match.away} />
    </div>
  );
}

function TeamRow({ team }: { team: BracketMatch["home"] }) {
  if (!team) {
    return <div className="text-gray-500">TBD</div>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-base leading-none">{team.flag}</span>
      <span className="truncate text-sm font-semibold text-white">
        {team.name}
      </span>
    </div>
  );
}
