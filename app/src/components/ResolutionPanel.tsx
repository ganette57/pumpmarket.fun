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

  // 24h creator propose deadline (ISO string)
  // computed in /trade/[id]/page.tsx as end_date + 24h
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
  variant: "final" | "proposed" | "ended" | "cancelled" | "pending";
}) {
  const cls =
    variant === "final"
      ? "border-pump-green/30 bg-pump-green/10 text-pump-green"
      : variant === "proposed"
      ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-200"
      : variant === "cancelled"
      ? "border-[#ff5c73]/30 bg-[#ff5c73]/10 text-[#ff5c73]"
      : variant === "pending"
      ? "border-blue-400/30 bg-blue-400/10 text-blue-300"
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
  tone?: "default" | "warn" | "danger" | "pending";
}) {
  const baseDot = done
    ? "bg-pump-green text-black border-pump-green/40"
    : tone === "danger"
    ? "bg-[#ff5c73]/20 text-[#ff5c73] border-[#ff5c73]/30"
    : tone === "warn"
    ? "bg-yellow-400/10 text-yellow-200 border-yellow-400/30"
    : tone === "pending"
    ? "bg-blue-400/20 text-blue-300 border-blue-400/30 animate-pulse"
    : "bg-black/30 text-gray-300 border-white/10";

  return (
    <div className="flex items-start gap-3">
      <div className="relative mt-0.5">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${baseDot}`}>
          {done ? "✓" : tone === "pending" ? "⏳" : "•"}
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
        {subtitle ? <div className="text-sm text-gray-400 mt-0.5">{subtitle}</div> : null}
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

  const noDisputes = (contestCount ?? 0) <= 0;
  
  // ✅ Only show as final if actually resolved on-chain
  const uiFinal = isFinal;
  
  // ✅ Awaiting admin validation = proposed + dispute window closed + not finalized yet
  const isAwaitingAdmin = isProposed && !contestOpen && !isFinal;

  function normalizeProofUrl(raw?: string | null): string | null {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;

    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${s.slice("ipfs://".length)}`;
    if (s.startsWith("//")) return `https:${s}`;
    if (s.startsWith("/")) {
      if (typeof window !== "undefined") return `${window.location.origin}${s}`;
      return s;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/?#].*)?$/i.test(s)) return `https://${s}`;
    return s;
  }

  const proofImg = uiFinal ? resolutionProofImage : proposedProofImage;
  const proofUrlRaw = uiFinal ? resolutionProofUrl : proposedProofUrl;
  const proofUrl = normalizeProofUrl(proofUrlRaw);
  const proofNote = uiFinal ? resolutionProofNote : proposedProofNote;

  const [previewOpen, setPreviewOpen] = useState(false);

  const shouldShow = ended || isProposed || isFinal || isCancelled;
  if (!shouldShow) return null;

  const headlineOutcome = uiFinal
    ? (winningOutcomeLabel || proposedOutcomeLabel)
    : isProposed
    ? proposedOutcomeLabel
    : null;

  const headerSubline = uiFinal
    ? `Finalized${formatDt(resolvedAt) ? ` • ${formatDt(resolvedAt)}` : ""}`
    : isAwaitingAdmin
    ? "Awaiting admin validation"
    : isProposed
    ? `Proposed${formatDt(proposedAt) ? ` • ${formatDt(proposedAt)}` : ""}`
    : isCancelled
    ? "Cancelled • funds refundable"
    : isPending
    ? creatorWindowOpen
      ? `Creator has ${formatMsToHhMm(creatorRemainingMs)} to propose (24h window)`
      : creatorWindowExpired
      ? "Creator window expired — cancelling / refunding"
      : "Waiting for proposal"
    : null;

  const headerChip = uiFinal ? (
    <Chip label="Final" variant="final" />
  ) : isAwaitingAdmin ? (
    <Chip label="Pending" variant="pending" />
  ) : isProposed ? (
    <Chip label="Proposed" variant="proposed" />
  ) : isCancelled ? (
    <Chip label="Cancelled" variant="cancelled" />
  ) : (
    <Chip label="Ended" variant="ended" />
  );

  const ViewProofLink = proofUrl ? (
    <a
      href={proofUrl}
      target="_blank"
      rel="noreferrer"
      className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 hover:bg-white/5 transition"
    >
      View proof
    </a>
  ) : null;

  const ProofOpenLink = proofUrl ? (
    <a href={proofUrl} target="_blank" rel="noreferrer" className="text-pump-green underline">
      open proof
    </a>
  ) : null;

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
                    : isAwaitingAdmin
                    ? "text-blue-300"
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
          <Step done={ended} title="Market ended" subtitle={ended ? "Trading is closed." : "Trading is still open."} />

          <Step
            done={isProposed || uiFinal}
            title="Outcome proposed"
            subtitle={
              isProposed || uiFinal
                ? `Proposed: ${proposedOutcomeLabel || "—"}${proposedAt ? ` • ${formatDt(proposedAt)}` : ""}`
                : isCancelled
                ? "No proposal needed (market cancelled)."
                : creatorWindowOpen
                ? "Creator must propose within 24h after end."
                : creatorWindowExpired
                ? "No proposal in 24h → auto-cancel + refund."
                : "No proposal yet."
            }
            right={
              isProposed && !isAwaitingAdmin ? (
                <div className="text-xs text-pump-green font-semibold">
                  {contestOpen && Number.isFinite(contestRemainingMs)
                    ? `${formatMsToHhMm(contestRemainingMs)} left`
                    : "Window ended"}
                </div>
              ) : isPending ? (
                creatorWindowOpen ? (
                  <div className="text-xs text-yellow-200 font-semibold">{formatMsToHhMm(creatorRemainingMs)} left</div>
                ) : creatorWindowExpired ? (
                  <div className="text-xs text-[#ff5c73] font-semibold">Expired</div>
                ) : null
              ) : null
            }
          />

          <Step
            done={!contestOpen && (isProposed || uiFinal)}
            title="Dispute window"
            subtitle={
              isCancelled
                ? "Disputes not applicable."
                : isAwaitingAdmin
                ? `Closed with ${contestCount ?? 0} dispute${(contestCount ?? 0) !== 1 ? "s" : ""}.`
                : isProposed
                ? "Anyone can dispute during the 4h window."
                : uiFinal
                ? "No disputes (or resolved after review)."
                : "Opens after proposal."
            }
            right={
              isProposed ? (
                <Link
                  href={contestHref}
                  className={`text-xs font-semibold transition ${
                    typeof contestCount === "number" && contestCount > 0
                      ? "text-[#ff5c73] hover:underline"
                      : "text-gray-400 hover:text-pump-green hover:underline"
                  }`}
                  title="Open contest / disputes"
                >
                  {typeof contestCount === "number" && contestCount > 0
                    ? `${contestCount} disputes`
                    : isAwaitingAdmin
                    ? "No disputes"
                    : "No disputes yet"}
                </Link>
              ) : null
            }
          />

          {/* ✅ NEW STEP: Admin validation pending */}
          <Step
            done={uiFinal}
            title="Admin validation"
            subtitle={
              uiFinal
                ? "Validated by admin."
                : isAwaitingAdmin
                ? "Waiting for admin to validate and finalize the outcome."
                : isCancelled
                ? "Not applicable."
                : "Pending after dispute window."
            }
            tone={isAwaitingAdmin ? "pending" : "default"}
            right={
              isAwaitingAdmin ? (
                <div className="text-xs text-blue-300 font-semibold">In progress</div>
              ) : null
            }
          />

          <Step
            done={uiFinal}
            title="Final outcome"
            subtitle={
              uiFinal
                ? `Final: ${(winningOutcomeLabel || proposedOutcomeLabel) || "—"}`
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
            <div className="text-white font-semibold mb-2">{uiFinal ? "Final proof" : "Proposed proof"}</div>

            {proofNote ? <p className="text-sm text-gray-300 mb-2">{proofNote}</p> : null}

            {proofUrl ? (
              <p className="text-sm text-gray-300 mb-3">
                Proof link: {ProofOpenLink}
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
          {isProposed && !isAwaitingAdmin ? (
            contestOpen ? (
              <Link
                href={contestHref}
                className="flex-1 px-4 py-2.5 rounded-xl text-center font-semibold transition bg-[#ff5c73] text-black hover:opacity-90"
              >
                🚨 Dispute
              </Link>
            ) : (
              <button className="flex-1 px-4 py-2.5 rounded-xl bg-gray-700 text-gray-300 cursor-not-allowed" disabled>
                🚨 Dispute (window closed)
              </button>
            )
          ) : isAwaitingAdmin ? (
            <button className="flex-1 px-4 py-2.5 rounded-xl bg-blue-500/20 text-blue-300 border border-blue-500/30 cursor-not-allowed" disabled>
              ⏳ Awaiting admin validation
            </button>
          ) : uiFinal ? (
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
            <button className="flex-1 px-4 py-2.5 rounded-xl bg-gray-700 text-gray-300 cursor-not-allowed" disabled>
              Waiting for proposal
            </button>
          )}

          {ViewProofLink}
        </div>

        <p className="mt-3 text-xs text-gray-500">
          Flow: ended → propose → 4h dispute window → admin validation → finalize/payout.{" "}
          {isPending ? "If no proposal in 24h: cancel + refund." : null}
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