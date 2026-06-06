// app/src/app/world-cup/_components/GroupsTable.tsx
"use client";

import { GROUPS } from "./mockData";

export default function GroupsGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {GROUPS.map((g) => (
        <div
          key={g.name}
          className="overflow-hidden rounded-xl border border-gray-800 bg-[#05070b]"
        >
          <div className="border-b border-gray-800 bg-pump-gray/40 px-4 py-2 text-sm font-bold text-white">
            {g.name}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-gray-400">
                <th className="px-4 py-2 text-left font-semibold">Team</th>
                <th className="py-2 text-center font-semibold">P</th>
                <th className="py-2 text-center font-semibold">W</th>
                <th className="py-2 text-center font-semibold">D</th>
                <th className="py-2 text-center font-semibold">L</th>
                <th className="px-4 py-2 text-right font-semibold">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {g.rows.map((r, idx) => (
                <tr key={r.team.name} className="text-gray-200">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-[10px] font-bold text-gray-500 tabular-nums">
                        {idx + 1}
                      </span>
                      <span className="text-base leading-none">
                        {r.team.flag}
                      </span>
                      <span
                        className={`truncate text-sm ${
                          idx < 2 ? "font-semibold text-white" : "text-gray-300"
                        }`}
                      >
                        {r.team.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 text-center tabular-nums">{r.played}</td>
                  <td className="py-2 text-center tabular-nums">{r.win}</td>
                  <td className="py-2 text-center tabular-nums">{r.draw}</td>
                  <td className="py-2 text-center tabular-nums">{r.loss}</td>
                  <td className="px-4 py-2 text-right font-bold text-pump-green tabular-nums">
                    {r.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
