"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type ResolutionStatus = "open" | "proposed" | "finalized" | "cancelled";

type Props = {
  marketAddress: string;

  // derived from DB row
  resolutionStatus: ResolutionStatus;
  proposedOutcomeLabel?: string | null;
  proposedAt?: string | null;
  contestDeadline?: string | null;
  contestCount?: number | null;

  proposedProofUrl?: string | null;
  proposedProofImage?: string | null;
  proposedProofNote?: string | null;

  // resolved (on-chain / final)
  resolved: boolean;
  winningOutcomeLabel?: string | null;
  resolvedAt?: string | null;

  resolutionProofUrl?: string | null;
  resolutionProofImage?: string | null;
  resolutionProofNote?: string | null;

  // UI helpers
  ended: boolean;

  // ✅ NEW: 72h creator propose deadline (ISO string)
  // computed in /trade/[id]/page.tsx as end_date + 72h
  creatorResolveDeadline?: string | null;
};

function formatMsToHhMm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / (60 * 1000)));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDt(x?: string | null) {
  if (!x) return null;
  const t = new Date(x);
  if (!Number.isFinite(t.getTime())) return null;
  return t.toLocaleString();
}

function Chip({
  label,
  variant,
}: {
  label: string;
  variant: "final" | "proposed" | "ended" | "cancelled";
}) {
  const cls =
    variant === "final"
      ? "border-pump-green/30 bg-pump-green/10 text-pump-green"
      : variant === "proposed"
      ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-200"
      : variant === "cancelled"
      ? "border-[#ff5c73]/30 bg-[#ff5c73]/10 text-[#ff5c73]"
      : "border-white/10 bg-black/20 text-gray-300";

  return (
    <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {label}
    </div>
  );
}

function Step({
  done,
  title,
  subtitle,
  right,
  showLine = true,
  tone = "default",
}: {
  done: boolean;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  showLine?: boolean;
  tone?: "default" | "warn" | "danger";
}) {
  const baseDot = done
    ? "bg-pump-green text-black border-pump-green/40"
    : tone === "danger"
    ? "bg-[#ff5c73]/20 text-[#ff5c73] border-[#ff5c73]/30"
    : tone === "warn"
    ? "bg-yellow-400/10 text-yellow-200 border-yellow-400/30"
    : "bg-black/30 text-gray-300 border-white/10";

  return (
    <div className="flex items-start gap-3">
      <div className="relative mt-0.5">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center border ${baseDot}`}
        >
          {done ? "✓" : "•"}
        </div>

        {showLine ? (
          <div className="absolute left-1/2 -translate-x-1/2 top-10 w-px h-8 bg-white/10" />
        ) : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="text-white font-semibold">{title}</div>
          {right}
        </div>
        {subtitle ? (
          <div className="text-sm text-gray-400 mt-0.5">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

export default function ResolutionPanel(props: Props) {
  const {
    marketAddress,
    resolutionStatus,
    proposedOutcomeLabel,
    proposedAt,
    contestDeadline,
    contestCount,

    proposedProofUrl,
    proposedProofImage,
    proposedProofNote,

    resolved,
    winningOutcomeLabel,
    resolvedAt,
    resolutionProofUrl,
    resolutionProofImage,
    resolutionProofNote,

    ended,
    creatorResolveDeadline,
  } = props;

  const isProposed = resolutionStatus === "proposed" && !resolved;
  const isFinal = resolved || resolutionStatus === "finalized";
  const isCancelled = resolutionStatus === "cancelled";
  const isPending = ended && !isProposed && !isFinal && !isCancelled;

  // tick when we need a countdown
  const [now, setNow] = useState(Date.now());

  const contestDeadlineMs = contestDeadline ? new Date(contestDeadline).getTime() : NaN;
  const contestRemainingMs = Number.isFinite(contestDeadlineMs) ? contestDeadlineMs - now : NaN;

  const creatorDeadlineMs = creatorResolveDeadline ? new Date(creatorResolveDeadline).getTime() : NaN;
  const creatorRemainingMs = Number.isFinite(creatorDeadlineMs) ? creatorDeadlineMs - now : NaN;

  const contestOpen = useMemo(() => {
    if (!isProposed) return false;
    if (!Number.isFinite(contestRemainingMs)) return false;
    return contestRemainingMs > 0;
  }, [isProposed, contestRemainingMs]);

  const creatorWindowOpen = useMemo(() => {
    if (!isPending) return false;
    if (!Number.isFinite(creatorRemainingMs)) return false;
    return creatorRemainingMs > 0;
  }, [isPending, creatorRemainingMs]);

  const creatorWindowExpired = useMemo(() => {
    if (!isPending) return false;
    if (!Number.isFinite(creatorRemainingMs)) return false;
    return creatorRemainingMs <= 0;
  }, [isPending, creatorRemainingMs]);

  useEffect(() => {
    const shouldTick =
      (isProposed && Number.isFinite(contestDeadlineMs)) ||
      (isPending && Number.isFinite(creatorDeadlineMs));
    if (!shouldTick) return;

    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isProposed, isPending, contestDeadlineMs, creatorDeadlineMs]);

  const contestHref = `/contest/${encodeURIComponent(marketAddress)}`;

  // Proof selection
  const proofImg = isFinal ? resolutionProofImage : proposedProofImage;
  const proofUrl = isFinal ? resolutionProofUrl : proposedProofUrl;
  const proofNote = isFinal ? resolutionProofNote : proposedProofNote;

  // Lightbox preview
  const [previewOpen, setPreviewOpen] = useState(false);

  // only show when relevant
  const shouldShow = ended || isProposed || isFinal || isCancelled;
  if (!shouldShow) return null;

  // headline outcome (like your ref screen)
  const headlineOutcome = isFinal ? winningOutcomeLabel : isProposed ? proposedOutcomeLabel : null;

  const headerSubline = isFinal
    ? `Finalized${formatDt(resolvedAt) ? ` • ${formatDt(resolvedAt)}` : ""}`
    : isProposed
    ? `Proposed${formatDt(proposedAt) ? ` • ${formatDt(proposedAt)}` : ""}`
    : isCancelled
    ? "Cancelled • funds refundable"
    : isPending
    ? creatorWindowOpen
      ? `Creator has ${formatMsToHhMm(creatorRemainingMs)} to propose (72h window)`
      : creatorWindowExpired
      ? "Creator window expired — cancelling / refunding"
      : "Waiting for proposal"
    : null;

  const headerChip =
    isFinal ? (
      <Chip label="Final" variant="final" />
    ) : isProposed ? (
      <Chip label="Proposed" variant="proposed" />
    ) : isCancelled ? (
      <Chip label="Cancelled" variant="cancelled" />
    ) : (
      <Chip label="Ended" variant="ended" />
    );

  return (
    <>
      <div className="card-pump">
        {/* Header: outcome first */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">Outcome</div>

            <div className="text-2xl font-extrabold text-white leading-tight">
              {headlineOutcome ? headlineOutcome : isCancelled ? "Cancelled" : isPending ? "Pending" : "—"}
            </div>

            {headerSubline ? (
              <div
                className={`text-xs mt-1 ${
                  creatorWindowExpired || isCancelled
                    ? "text-[#ff5c73]"
                    : isPending
                    ? "text-yellow-200"
                    : "text-gray-500"
                }`}
              >
                {headerSubline}
              </div>
            ) : null}
          </div>

          {headerChip}
        </div>

        {/* Timeline */}
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 space-y-5">
          <Step
            done={ended}
            title="Market ended"
            subtitle={ended ? "Trading is closed." : "Trading is still open."}
          />

          <Step
            done={isProposed || isFinal}
            title="Outcome proposed"
            subtitle={
              isProposed || isFinal
                ? `Proposed: ${proposedOutcomeLabel || "—"}${proposedAt ? ` • ${formatDt(proposedAt)}` : ""}`
                : isCancelled
                ? "No proposal needed (market cancelled)."
                : creatorWindowOpen
                ? "Creator must propose within 72h after end."
                : creatorWindowExpired
                ? "No proposal in 72h → auto-cancel + refund."
                : "No proposal yet."
            }
            right={
              isProposed ? (
                <div className="text-xs text-pump-green font-semibold">
                  {contestOpen && Number.isFinite(contestRemainingMs)
                    ? `${formatMsToHhMm(contestRemainingMs)} left`
                    : "Window ended"}
                </div>
              ) : isPending ? (
                creatorWindowOpen ? (
                  <div className="text-xs text-yellow-200 font-semibold">
                    {formatMsToHhMm(creatorRemainingMs)} left
                  </div>
                ) : creatorWindowExpired ? (
                  <div className="text-xs text-[#ff5c73] font-semibold">Expired</div>
                ) : null
              ) : null
            }
          />

          <Step
            done={isFinal}
            title="Dispute window"
            subtitle={
              isCancelled
                ? "Disputes not applicable."
                : isProposed
                ? "Anyone can dispute during the window."
                : isFinal
                ? "No disputes (or resolved after review)."
                : "Opens after proposal."
            }
            right={
              isProposed ? (
                <div className="text-xs text-gray-400">
                  {typeof contestCount === "number" && contestCount > 0
                    ? `${contestCount} disputes`
                    : "No disputes yet"}
                </div>
              ) : null
            }
          />

          <Step
            done={isFinal}
            title="Final outcome"
            subtitle={
              isFinal
                ? `Final: ${winningOutcomeLabel || "—"}`
                : isCancelled
                ? "Cancelled — funds refundable."
                : "Not finalized yet."
            }
            showLine={false}
            tone={isCancelled ? "danger" : "default"}
          />
        </div>

        {/* Proof */}
        {(proofNote || proofUrl || proofImg) ? (
          <div className="mt-5">
            <div className="text-white font-semibold mb-2">
              {isFinal ? "Final proof" : "Proposed proof"}
            </div>

            {proofNote ? <p className="text-sm text-gray-300 mb-2">{proofNote}</p> : null}

            {proofUrl ? (
              <p className="text-sm text-gray-300 mb-3">
                Proof link:{" "}
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-pump-green underline"
                >
                  open proof
                </a>
              </p>
            ) : null}

            {proofImg ? (
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="w-full text-left rounded-2xl overflow-hidden border border-white/10 bg-black/20 hover:border-white/20 transition"
                title="Open preview"
              >
                <div className="relative w-full aspect-video">
                  <Image src={proofImg} alt="Proof" fill className="object-contain bg-black" />
                </div>
                <div className="px-3 py-2 text-xs text-gray-400">Click to preview</div>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* CTA */}
        <div className="mt-5 flex items-center gap-2">
          {isProposed ? (
            contestOpen ? (
              <Link
                href={contestHref}
                className="flex-1 px-4 py-2.5 rounded-xl text-center font-semibold transition bg-[#ff5c73] text-black hover:opacity-90"
              >
                🚨 Dispute
              </Link>
            ) : (
              <button
                className="flex-1 px-4 py-2.5 rounded-xl bg-gray-700 text-gray-300 cursor-not-allowed"
                disabled
              >
                🚨 Dispute (window closed)
              </button>
            )
          ) : isFinal ? (
            <Link
              href="/dashboard"
              className="flex-1 px-4 py-2.5 rounded-xl text-center font-semibold transition bg-pump-green text-black hover:opacity-90"
            >
              💰 Claim
            </Link>
          ) : isCancelled ? (
            <Link
              href="/dashboard"
              className="flex-1 px-4 py-2.5 rounded-xl text-center font-semibold transition bg-pump-green text-black hover:opacity-90"
            >
              💸 Refund
            </Link>
          ) : (
            <button
              className="flex-1 px-4 py-2.5 rounded-xl bg-gray-700 text-gray-300 cursor-not-allowed"
              disabled
            >
              Waiting for proposal
            </button>
          )}

          {proofUrl ? (
            <a
              href={proofUrl}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 hover:bg-white/5 transition"
            >
              View proof
            </a>
          ) : null}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Flow: ended → propose → 24h dispute window → finalize/payout.{" "}
          {isPending ? "If no proposal in 72h: cancel + refund." : null}
        </p>
      </div>

      {/* Lightbox */}
      {previewOpen && proofImg ? (
        <div
          className="fixed inset-0 z-[80] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-4xl rounded-2xl overflow-hidden border border-white/10 bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-3 right-3 z-10">
              <button
                onClick={() => setPreviewOpen(false)}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 transition"
              >
                ✕
              </button>
            </div>

            <div className="relative w-full max-h-[80vh] aspect-video">
              <Image src={proofImg} alt="Proof preview" fill className="object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}