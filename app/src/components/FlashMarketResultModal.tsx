type FlashMarketResultState = "win" | "lose";

type FlashMarketResultModalProps = {
  open: boolean;
  result: FlashMarketResultState;
  onClose: () => void;
  outcomeLabel?: string | null;
  winningShares?: number | null;
  secondaryText?: string | null;
};

export type { FlashMarketResultState };

export default function FlashMarketResultModal({
  open,
  result,
  onClose,
  outcomeLabel = null,
  winningShares = null,
  secondaryText = "Market finalized.",
}: FlashMarketResultModalProps) {
  if (!open) return null;

  const isWin = result === "win";
  const accentBorder = isWin ? "border-pump-green/45" : "border-red-500/45";
  const accentGlow = isWin
    ? "shadow-[0_0_44px_rgba(0,255,136,0.2)]"
    : "shadow-[0_0_44px_rgba(239,68,68,0.2)]";
  const accentChip = isWin
    ? "bg-pump-green/20 text-pump-green"
    : "bg-red-500/20 text-red-300";
  const accentTitle = isWin ? "text-pump-green" : "text-red-300";
  const accentGradient = isWin
    ? "from-pump-green/30 via-pump-green/10 to-transparent"
    : "from-red-500/30 via-red-500/10 to-transparent";

  return (
    <div className="fixed inset-0 z-[320] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close flash result modal"
        onClick={onClose}
      />

      <div
        className={`relative w-full rounded-t-3xl border bg-pump-dark p-6 sm:max-w-sm sm:rounded-3xl ${accentBorder} ${accentGlow}`}
      >
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-3xl bg-gradient-to-b ${accentGradient}`}
        />

        <div className="relative text-center">
          <div
            className={`mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${accentChip}`}
          >
            {isWin ? "W" : "L"}
          </div>

          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/65">
            Flash market result
          </p>
          <h2
            className={`mt-2 text-4xl font-black leading-none ${accentTitle}`}
          >
            {isWin ? "You win" : "You lose"}
          </h2>
          {secondaryText ? <p className="mt-2 text-sm text-gray-300">{secondaryText}</p> : null}

          {outcomeLabel ? (
            <p className="mt-4 text-sm text-gray-200">
              Final outcome:{" "}
              <span className="font-semibold text-white">{outcomeLabel}</span>
            </p>
          ) : null}

          {isWin &&
          Number.isFinite(Number(winningShares)) &&
          Number(winningShares) > 0 ? (
            <p className="mt-1 text-xs text-pump-green/90">
              {Math.floor(Number(winningShares))} winning share
              {Math.floor(Number(winningShares)) === 1 ? "" : "s"}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className={`mt-6 w-full rounded-xl px-4 py-3 text-sm font-bold transition ${
              isWin
                ? "bg-pump-green text-black hover:bg-[#74ffb8]"
                : "bg-red-500 text-white hover:bg-red-400"
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
