"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

type ReportReason = "spam" | "inappropriate" | "scam" | "misleading" | "duplicate" | "other";

const REASONS: { value: ReportReason; label: string; description: string }[] = [
  { value: "spam", label: "Spam", description: "Repetitive or low-quality content" },
  { value: "inappropriate", label: "Inappropriate", description: "Offensive or harmful content" },
  { value: "scam", label: "Scam", description: "Fraudulent or deceptive market" },
  { value: "misleading", label: "Misleading", description: "False or misleading information" },
  { value: "duplicate", label: "Duplicate", description: "This market already exists" },
  { value: "other", label: "Other", description: "Another reason not listed" },
];

type Props = {
  marketAddress: string;
  variant?: "icon" | "text" | "full";
  className?: string;
};

export default function ReportMarketButton({ marketAddress, variant = "icon", className = "" }: Props) {
  const { publicKey } = useWallet();
  
  const [isOpen, setIsOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setIsOpen(true);
    setSelectedReason(null);
    setDetails("");
    setError(null);
    setSubmitted(false);
  }

  function closeModal() {
    setIsOpen(false);
  }

  async function handleSubmit() {
    if (!selectedReason) {
      setError("Please select a reason");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/markets/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_address: marketAddress,
          reporter_address: publicKey?.toBase58() || null,
          reason: selectedReason,
          details: details.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to submit report");
      }

      setSubmitted(true);
    } catch (e: any) {
      setError(e?.message || "Failed to submit report");
    } finally {
      setSubmitting(false);
    }
  }

  // Button render based on variant
  const buttonContent = () => {
    if (variant === "icon") {
      return (
        <button
          onClick={openModal}
          className={`p-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition ${className}`}
          title="Report this market"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </button>
      );
    }

    if (variant === "text") {
      return (
        <button
          onClick={openModal}
          className={`text-sm text-gray-400 hover:text-red-400 transition ${className}`}
        >
          Report
        </button>
      );
    }

    // full variant
    return (
      <button
        onClick={openModal}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition text-sm ${className}`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        Report
      </button>
    );
  };

  return (
    <>
      {buttonContent()}

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-pump-dark border border-white/20 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            
            {submitted ? (
              // Success state
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-pump-green/20 flex items-center justify-center">
                  <svg className="w-8 h-8 text-pump-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Report Submitted</h3>
                <p className="text-gray-400 text-sm mb-6">
                  Thank you for helping keep FunMarket safe. Our team will review this report shortly.
                </p>
                <button
                  onClick={closeModal}
                  className="px-6 py-2 rounded-lg bg-pump-green text-black font-semibold hover:opacity-90 transition"
                >
                  Close
                </button>
              </div>
            ) : (
              // Form state
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Report Market
                  </h3>
                  <button
                    onClick={closeModal}
                    className="text-gray-400 hover:text-white transition"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="text-sm text-gray-400 mb-4">
                  Help us maintain a safe platform by reporting markets that violate our guidelines.
                </p>

                {/* Reason selection */}
                <div className="mb-4">
                  <label className="text-sm text-gray-300 font-medium mb-2 block">
                    Why are you reporting this market?
                  </label>
                  <div className="space-y-2">
                    {REASONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setSelectedReason(r.value)}
                        className={`w-full text-left p-3 rounded-xl border transition ${
                          selectedReason === r.value
                            ? "border-red-500/60 bg-red-500/10"
                            : "border-white/10 bg-white/5 hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              selectedReason === r.value
                                ? "border-red-500 bg-red-500"
                                : "border-gray-500"
                            }`}
                          >
                            {selectedReason === r.value && (
                              <div className="w-1.5 h-1.5 rounded-full bg-white" />
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{r.label}</div>
                            <div className="text-xs text-gray-500">{r.description}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Additional details */}
                <div className="mb-4">
                  <label className="text-sm text-gray-300 font-medium mb-2 block">
                    Additional details (optional)
                  </label>
                  <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Provide any additional context..."
                    maxLength={1000}
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none"
                  />
                  <div className="text-xs text-gray-500 text-right mt-1">
                    {details.length}/1000
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
                    {error}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={closeModal}
                    disabled={submitting}
                    className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white font-medium hover:bg-white/10 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting || !selectedReason}
                    className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-semibold hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Submitting..." : "Submit Report"}
                  </button>
                </div>

                {!publicKey && (
                  <p className="text-xs text-gray-500 text-center mt-3">
                    Connect your wallet to help us track repeat reporters.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}