"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  countryCode?: string | null; // "US", "FR", etc.
  onAccept: () => void;
};

const STORAGE_KEY = "funmarket_geo_accept_v1";

function isSoftBlockedUS(countryCode?: string | null) {
  return String(countryCode || "").toUpperCase() === "US";
}

export default function GeoGateModal({ open, countryCode, onAccept }: Props) {
  const isUS = useMemo(() => isSoftBlockedUS(countryCode), [countryCode]);
  const cc = useMemo(() => String(countryCode || "").toUpperCase(), [countryCode]);

  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChecked(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-pump-dark p-6 shadow-2xl">
        <div className="text-white text-xl font-extrabold mb-2">
          {isUS ? "Notice for US users" : "Welcome"}
        </div>

        <p className="text-sm text-gray-300 leading-relaxed">
          FunMarket is an experimental prediction market platform on Solana. Trading involves risk and may result in
          loss of funds. This is not financial advice.
        </p>

        {isUS ? (
          <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
            <div className="text-yellow-200 font-semibold text-sm mb-1">US Disclaimer</div>
            <p className="text-xs text-yellow-100/90 leading-relaxed">
              If you are located in the United States, you acknowledge you are accessing the platform at your own
              initiative and you are solely responsible for compliance with applicable laws and regulations.
            </p>

            <label className="mt-3 flex items-start gap-3 text-xs text-yellow-100/90 select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#7cff6b]"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <span>I understand and agree. I am responsible for compliance with my local laws.</span>
            </label>
          </div>
        ) : (
          <label className="mt-4 flex items-start gap-3 text-xs text-gray-300 select-none">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[#7cff6b]"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            <span>I understand the risks and agree to the Terms of Use.</span>
          </label>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            disabled={!checked}
            onClick={() => {
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now() }));
              } catch {}
              onAccept();
            }}
            className={`w-full py-3 rounded-xl font-bold transition ${
              checked
                ? "bg-pump-green text-black hover:bg-pump-green/90"
                : "bg-white/10 text-gray-400 cursor-not-allowed"
            }`}
          >
            Continue
          </button>
        </div>

        {/* Hide noisy "unknown" */}
        {!!cc && cc !== "UNKNOWN" && cc !== "XX" && (
          <p className="mt-3 text-center text-xs text-gray-500">
            Country detected: <span className="text-gray-300">{cc}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function hasAcceptedGeoGate(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return !!parsed?.ts;
  } catch {
    return false;
  }
}