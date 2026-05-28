"use client";

// Shared mobile/desktop host status controls for a live session.
// Extracted verbatim from /live/[id] so both the deeplink view and the
// /live swipe feed can reuse the exact same status flow + handlers.

import { useState } from "react";
import type { LiveSession, LiveSessionStatus } from "@/lib/liveSessions";

export default function LiveHostControls({
  session,
  onStatusChange,
  error,
}: {
  session: LiveSession;
  onStatusChange: (s: LiveSessionStatus) => void;
  error?: string | null;
}) {
  // UI only exposes Live / Locked / Ended. Resolved + Cancelled remain valid
  // statuses on the backend but are not user-driven from this panel anymore.
  const statusFlow: LiveSessionStatus[] = ["live", "locked", "ended"];
  const [collapsed, setCollapsed] = useState(false);
  const isTerminal = ["resolved", "cancelled"].includes(session.status);

  return (
    <div className="rounded-xl border border-gray-800/60 bg-pump-dark/40 px-3 py-2">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between w-full text-xs text-gray-400 hover:text-white transition"
      >
        <span className="font-semibold">Host</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`w-3.5 h-3.5 transition-transform ${collapsed ? "" : "rotate-180"}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {!collapsed && (
        <div className="space-y-2 mt-2">
          {isTerminal ? (
            <p className="text-[11px] text-gray-500">
              Session is {session.status}. No further actions available.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {statusFlow.map((s) => (
                <button
                  key={s}
                  disabled={session.status === s}
                  onClick={() => onStatusChange(s)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border transition ${
                    session.status === s
                      ? "bg-pump-green/15 border-pump-green text-pump-green"
                      : "bg-pump-dark/40 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200"
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="text-[11px] text-red-400 bg-red-900/20 rounded-md px-2 py-1">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
