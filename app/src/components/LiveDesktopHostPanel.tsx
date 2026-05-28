"use client";

// Desktop host actions for /live/[id]. Mirrors the mobile HUD flow:
//  - Result card when the market has settled (everyone).
//  - Resolve form when expired + not settled (host only).
//  - Up Next strip when a queued config exists (everyone).
//  - Create Next Market modal/button (host only; persists CONFIG when the
//    current market is active, immediate-swap when it's already settled).
//
// All actions reuse the existing page-level handlers — no smart contract,
// market creation, or backend logic is duplicated here.

import { useEffect, useState } from "react";
import type { QueuedNextMarketConfig } from "@/lib/liveSessions";

const DURATION_OPTIONS = [3, 5, 10, 30] as const;

export type LiveDesktopHostPanelProps = {
  isHost: boolean;
  expired: boolean;
  settled: boolean;
  resolved: boolean;
  proposed: boolean;
  outcomeNames: string[] | null;
  /** Index of the proposed/winning outcome, if any. */
  outcomeIndex: number | null;
  queuedNext: QueuedNextMarketConfig | null;
  onResolve?: (outcomeIndex: number) => Promise<void>;
};

export default function LiveDesktopHostPanel(props: LiveDesktopHostPanelProps) {
  const {
    isHost,
    expired,
    settled,
    resolved,
    proposed,
    outcomeNames,
    outcomeIndex,
    queuedNext,
    onResolve,
  } = props;

  const showResolve = isHost && expired && !settled && !!onResolve;
  const winnerLabel =
    outcomeIndex != null && outcomeNames ? outcomeNames[outcomeIndex] : null;

  // Create Next moved out — now sits next to HostControls in the page.
  if (!settled && !showResolve && !queuedNext) return null;

  return (
    <div className="space-y-3">
      {settled && (
        <ResultCard
          resolved={resolved}
          proposed={proposed}
          winnerLabel={winnerLabel}
        />
      )}

      {showResolve && outcomeNames && onResolve && (
        <ResolveCard outcomeNames={outcomeNames} onResolve={onResolve} />
      )}

      {queuedNext && <QueuedNextCard config={queuedNext} />}
    </div>
  );
}

/* ── Result ───────────────────────────────────────────────────────── */

function ResultCard({
  resolved,
  proposed,
  winnerLabel,
}: {
  resolved: boolean;
  proposed: boolean;
  winnerLabel?: string | null;
}) {
  return (
    <div className="rounded-xl border border-pump-green/30 bg-pump-green/[0.06] backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
          {resolved ? "Market resolved" : proposed ? "Outcome proposed" : "Settled"}
        </div>
        <div className="text-lg font-black text-white truncate">
          {winnerLabel ? `${winnerLabel} wins` : "Resolved"}
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center px-3 py-1 rounded-full bg-pump-green/20 border border-pump-green/40 text-pump-green text-[11px] font-bold uppercase tracking-wider">
        {resolved ? "Final" : "Proposed"}
      </span>
    </div>
  );
}

/* ── Resolve form (host only) ─────────────────────────────────────── */

function ResolveCard({
  outcomeNames,
  onResolve,
}: {
  outcomeNames: string[];
  onResolve: (outcomeIndex: number) => Promise<void>;
}) {
  const labels = outcomeNames.slice(0, 2);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 space-y-3">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
          Resolve Market
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Select the winning outcome.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {labels.map((name, idx) => {
          const isYes = idx === 0;
          const active = selected === idx;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setSelected(idx)}
              className={`rounded-lg border px-3 py-3 text-center font-black text-base transition ${
                active
                  ? isYes
                    ? "border-pump-green bg-pump-green/15 text-pump-green"
                    : "border-[#ff5c73] bg-[#ff5c73]/15 text-[#ff5c73]"
                  : "border-white/10 bg-black/20 text-gray-300 hover:border-white/20"
              }`}
            >
              {name}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={selected == null || submitting}
        onClick={async () => {
          if (selected == null) return;
          setSubmitting(true);
          setError(null);
          try {
            await onResolve(selected);
            // Page state refresh will hide this card automatically.
          } catch (e: any) {
            setError(String(e?.message || "Resolve failed"));
          } finally {
            setSubmitting(false);
          }
        }}
        className={`w-full py-2.5 rounded-lg font-bold text-sm transition ${
          selected == null || submitting
            ? "bg-gray-700 text-gray-400 cursor-not-allowed"
            : "bg-pump-green text-black hover:bg-[#74ffb8]"
        }`}
      >
        {submitting ? "Resolving…" : "Resolve Winner"}
      </button>
    </div>
  );
}

/* ── Queued Next indicator (everyone) ─────────────────────────────── */

function QueuedNextCard({ config }: { config: QueuedNextMarketConfig }) {
  return (
    <div className="rounded-xl border border-pump-green/30 bg-pump-green/[0.04] px-4 py-3 flex items-center gap-3">
      <div className="shrink-0 w-8 h-8 rounded-full border-2 border-pump-green/35 flex items-center justify-center shadow-[0_0_14px_-4px_rgba(109,255,164,0.5)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 text-pump-green/80"
        >
          <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/45">
          Up Next
        </div>
        <div className="text-sm font-semibold text-white/85 truncate">
          {config.title || "Next market queued"}
        </div>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pump-green/10 border border-pump-green/25 text-[10px] font-bold uppercase tracking-wider text-pump-green/80">
        {config.durationMin} Min
      </span>
    </div>
  );
}

/* ── Create Next Market launcher + modal (host only) ──────────────── */

export function CreateNextLauncher({
  onCreate,
}: {
  onCreate: (params: {
    title: string;
    outcomes: string[];
    durationMin: number;
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-pump-green/45 bg-pump-green/15 text-pump-green font-bold text-xs px-3 py-2 shadow-[0_0_22px_-10px_rgba(109,255,164,0.7)] hover:bg-pump-green/20 transition"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5"
        >
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        Create Next Market
      </button>
      {open && (
        <CreateNextModal onClose={() => setOpen(false)} onCreate={onCreate} />
      )}
    </>
  );
}

function CreateNextModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (params: {
    title: string;
    outcomes: string[];
    durationMin: number;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [yesLabel, setYesLabel] = useState("YES");
  const [noLabel, setNoLabel] = useState("NO");
  const [durationMin, setDurationMin] = useState<number>(5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const canSubmit = !!title.trim() && !submitting;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md bg-pump-dark border border-gray-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-white font-bold text-base leading-tight">
              Create Next Market
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Stays in this live session — stream keeps playing.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1.5">
              Market Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Will he say Bitcoin in the next 5 minutes?"
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/50"
              maxLength={200}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1.5">
              Outcomes
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={yesLabel}
                onChange={(e) => setYesLabel(e.target.value)}
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm font-semibold text-pump-green focus:outline-none focus:border-pump-green/50"
                maxLength={24}
              />
              <input
                type="text"
                value={noLabel}
                onChange={(e) => setNoLabel(e.target.value)}
                className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm font-semibold text-[#ff5c73] focus:outline-none focus:border-[#ff5c73]/50"
                maxLength={24}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-white/70 mb-1.5">
              Duration
            </label>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDurationMin(d)}
                  className={`py-2.5 rounded-xl text-sm font-semibold border transition ${
                    durationMin === d
                      ? "border-pump-green bg-pump-green/10 text-pump-green"
                      : "border-white/10 text-gray-400 hover:border-white/20"
                  }`}
                >
                  {d} min
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={async () => {
              if (!canSubmit) return;
              setSubmitting(true);
              setError(null);
              try {
                await onCreate({
                  title: title.trim(),
                  outcomes: [yesLabel, noLabel],
                  durationMin,
                });
                onClose();
              } catch (e: any) {
                setError(String(e?.message || "Failed to create next market"));
              } finally {
                setSubmitting(false);
              }
            }}
            className={`w-full py-3 rounded-xl font-bold text-base transition ${
              !canSubmit
                ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                : "bg-pump-green text-black hover:bg-[#74ffb8]"
            }`}
          >
            {submitting ? "Creating…" : "Create Next Market"}
          </button>
        </div>
      </div>
    </div>
  );
}
