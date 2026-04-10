"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import CommentsSection from "@/components/CommentsSection";
import { triggerHaptic } from "@/utils/haptics";

type HomeFeedCommentsSheetProps = {
  open: boolean;
  marketAddress: string | null;
  marketQuestion?: string | null;
  initialCount?: number | null;
  onClose: () => void;
  onCountChange?: (marketAddress: string, count: number) => void;
};

export default function HomeFeedCommentsSheet({
  open,
  marketAddress,
  marketQuestion = null,
  initialCount = null,
  onClose,
  onCountChange,
}: HomeFeedCommentsSheetProps) {
  const [count, setCount] = useState<number>(Number(initialCount || 0));
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    setCount(Number(initialCount || 0));
  }, [initialCount, marketAddress, open]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const updateInset = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };

    updateInset();
    vv.addEventListener("resize", updateInset);
    vv.addEventListener("scroll", updateInset);
    return () => {
      vv.removeEventListener("resize", updateInset);
      vv.removeEventListener("scroll", updateInset);
      setKeyboardInset(0);
    };
  }, [open]);

  const handleCountChange = useCallback(
    (nextCount: number) => {
      setCount(nextCount);
      if (marketAddress) onCountChange?.(marketAddress, nextCount);
    },
    [marketAddress, onCountChange]
  );

  if (!open || !marketAddress) return null;

  const bottomOffset = 56 + keyboardInset;
  const closeSheet = () => {
    triggerHaptic("light");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[230]">
      <button
        className="absolute inset-x-0 top-0 bg-black/70"
        style={{ bottom: `${bottomOffset}px` }}
        onClick={closeSheet}
        aria-label="Close comments"
      />

      <div
        className="absolute inset-x-0 h-[min(78dvh,680px)] rounded-t-2xl border-t border-gray-700 bg-[#0a0a0c] shadow-2xl animate-slideUp flex flex-col"
        style={{ bottom: `${bottomOffset}px` }}
      >
        <div className="flex-shrink-0 px-4 pt-3 pb-3 border-b border-gray-800">
          <div className="w-10 h-1 rounded-full bg-gray-600 mx-auto mb-3" />
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white">
                <MessageCircle className="h-4 w-4 text-[#61ff9a]" />
                <span className="text-sm font-semibold">Comments</span>
                <span className="text-sm text-white/70">({count})</span>
              </div>
              {marketQuestion ? (
                <p className="mt-1 truncate text-xs text-gray-400">{marketQuestion}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeSheet}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-black/40 text-gray-200"
              aria-label="Close comments sheet"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 px-4 pt-3 pb-2">
          <CommentsSection
            marketId={marketAddress}
            embedded
            composerAtBottom
            onCountChange={handleCountChange}
          />
        </div>
      </div>
    </div>
  );
}
