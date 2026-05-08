"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface VideoPreviewModalProps {
  open: boolean;
  videoUrl: string;
  posterUrl?: string | null;
  onClose: () => void;
}

export default function VideoPreviewModal({ open, videoUrl, posterUrl, onClose }: VideoPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      const v = videoRef.current;
      if (v) {
        try {
          v.pause();
          v.currentTime = 0;
        } catch {
          /* noop */
        }
      }
    }
  }, [open]);

  if (!open || !videoUrl) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-sm">
        <div className="relative aspect-[9/16] w-full rounded-2xl overflow-hidden bg-black border border-gray-800 shadow-2xl">
          <video
            ref={videoRef}
            src={videoUrl}
            poster={posterUrl || undefined}
            controls
            playsInline
            autoPlay
            muted
            className="w-full h-full object-contain"
          />
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close video"
          className="absolute -top-3 -right-3 w-9 h-9 bg-pump-red hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg"
        >
          <X className="w-5 h-5 text-white" />
        </button>
      </div>
    </div>
  );
}
