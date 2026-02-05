// components/BlockedMarketBanner.tsx

"use client";

import React from "react";

type Props = {
  reason?: string | null;
  blockedAt?: string | null;
};

export default function BlockedMarketBanner({ reason, blockedAt }: Props) {
  const formattedDate = blockedAt
    ? new Date(blockedAt).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="rounded-2xl border-2 border-red-600/50 bg-red-600/10 p-6">
      <div className="flex items-start gap-4">
        <div className="text-4xl">🚫</div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-red-400 mb-2">
            Market Suspended
          </h3>
          <p className="text-gray-300 text-sm mb-3">
            This market has been temporarily suspended by the platform administrators.
            Trading is currently disabled.
          </p>
          
          {reason && (
            <div className="mb-3">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Reason:</span>
              <p className="text-sm text-red-300 mt-1">{reason}</p>
            </div>
          )}

          {formattedDate && (
            <div className="text-xs text-gray-500">
              Suspended on: {formattedDate}
            </div>
          )}

          <div className="mt-4 p-3 rounded-xl bg-black/30 border border-white/10">
            <p className="text-xs text-gray-400">
              <strong className="text-white">What happens next?</strong>
              <br />
              If you have positions in this market, you will be able to claim a full refund 
              once the market is officially cancelled. Please check back later or visit your 
              dashboard for updates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}