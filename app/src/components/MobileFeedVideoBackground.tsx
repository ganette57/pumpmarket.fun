"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

interface MobileFeedVideoBackgroundProps {
  videoUrl: string;
  posterUrl?: string | null;
  /** Class for the absolute-positioned wrapper. Match the existing image wrapper's classes. */
  wrapperClassName?: string;
  /** Class for the inner <video>/<img> element. */
  mediaClassName?: string;
  /** Optional gradient overlay node — passed-through so callers keep visual hierarchy identical. */
  overlay?: React.ReactNode;
  alt?: string;
  /** Render a small mute/unmute toggle in the top-right of the wrapper. Default false. */
  showMuteToggle?: boolean;
}

/**
 * Background-only video for the mobile feed.
 *
 * - The poster image renders immediately so the first paint never waits on the video.
 * - The <video> element is only mounted once the item is "near" (within ~1 viewport),
 *   so off-screen feed items don't even fetch metadata.
 * - The video plays only while the item is the active (≥60% visible) feed card,
 *   and pauses + rewinds otherwise.
 * - No controls, no play button — purely background media. Muted/loop/playsInline.
 */
export default function MobileFeedVideoBackground({
  videoUrl,
  posterUrl,
  wrapperClassName,
  mediaClassName,
  overlay,
  alt,
  showMuteToggle = false,
}: MobileFeedVideoBackgroundProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isNear, setIsNear] = useState(false);
  const [isActive, setIsActive] = useState(false);
  /** User-controlled mute. Defaults to true (browser autoplay policy needs muted to start). */
  const [userMuted, setUserMuted] = useState(true);

  // "Near" detection — gate even the metadata fetch behind ~1 viewport of vertical proximity.
  // Bidirectional: when the user scrolls more than ~1 viewport away the <video> unmounts
  // so we don't accumulate decoders/buffers as the feed gets longer.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setIsNear(e.isIntersecting);
      },
      { rootMargin: "100% 0px 100% 0px", threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // "Active" detection — the snap-scroll feed has full-viewport items, so ≥60% visible
  // means this is the user's current card.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          setIsActive(e.intersectionRatio >= 0.6);
        }
      },
      { threshold: [0, 0.3, 0.6, 0.9, 1] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Drive play/pause from active state. Pause-and-rewind off-screen items so they never
  // burn battery decoding in the background.
  // We also retry play() on `canplay` — if the item mounts already-active, the first play()
  // can race ahead of metadata and silently fail; canplay is a clean second chance.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const tryPlay = () => {
      const p = v.play();
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {
          /* autoplay may be blocked; muted should normally allow it. ignore. */
        });
      }
    };

    if (isActive) {
      tryPlay();
      v.addEventListener("canplay", tryPlay);
      return () => v.removeEventListener("canplay", tryPlay);
    }

    try {
      v.pause();
      v.currentTime = 0;
    } catch {
      /* noop */
    }
    return undefined;
  }, [isActive]);

  // Re-mute when the item leaves the active state, so the next time the user
  // scrolls back the video starts silent again (matches TikTok/Reels semantics).
  useEffect(() => {
    if (!isActive) setUserMuted(true);
  }, [isActive]);

  // Sync the muted attribute. Defer setting on the element until after mount.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = userMuted;
    if (!userMuted) {
      // Some browsers require a fresh play() call after toggling muted=false.
      const p = v.play();
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {});
      }
    }
  }, [userMuted, isNear]);

  // Pause when the document/tab is hidden — saves CPU when the user is in another tab/app.
  useEffect(() => {
    const onVis = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) {
        try {
          v.pause();
        } catch {
          /* noop */
        }
      } else if (isActive) {
        const p = v.play();
        if (p && typeof (p as Promise<void>).catch === "function") {
          (p as Promise<void>).catch(() => {});
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isActive]);

  return (
    <div ref={wrapperRef} className={wrapperClassName}>
      {/* Instant poster — present even before the <video> is mounted. */}
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt={alt || ""}
          className={mediaClassName}
          aria-hidden="true"
          draggable={false}
        />
      ) : null}

      {isNear && (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={posterUrl || undefined}
          muted={userMuted}
          loop
          playsInline
          // metadata is enough for the first frame; the actual video stream only starts
          // when play() is called on the active item.
          preload="metadata"
          aria-hidden="true"
          className={mediaClassName}
          style={{ position: "absolute", inset: 0 }}
        />
      )}

      {overlay}

      {showMuteToggle && isActive && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setUserMuted((m) => !m);
          }}
          aria-label={userMuted ? "Unmute video" : "Mute video"}
          className="absolute top-20 right-4 z-20 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-white shadow-md active:scale-95 transition-transform"
        >
          {userMuted ? (
            <VolumeX className="w-4 h-4" />
          ) : (
            <Volume2 className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
}
