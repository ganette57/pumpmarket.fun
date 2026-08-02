"use client";

// src/components/result/useResultCardShare.ts
//
// Image-first sharing for a result card.
//
// WHY X NEVER RECEIVES THE IMAGE ON DESKTOP
// -----------------------------------------
// x.com/intent/tweet is a URL. It can carry text and a link, and nothing
// else — there is no parameter for an image, and a web intent cannot read a
// blob out of another origin's page. Posting media needs the X API with an
// OAuth'd account, which is out of scope. So the image has to reach the
// composer through the operating system instead: the clipboard on desktop,
// the native share sheet on mobile. Everything below exists to make that
// hand-off explicit rather than silent.
//
// RULES
//  - the PNG is generated when the modal opens, once per payload, so the
//    clipboard write stays close to the user's click (see POPUP/GESTURE).
//  - X is never opened with text alone and no explanation. If the clipboard
//    is refused, the card downloads first and the message says so.
//  - a cancelled native share sheet is not a failure.
//  - object URLs are revoked on regeneration and on unmount.
//
// POPUP/GESTURE
// -------------
// Clipboard writes are async, and window.open() after an await is treated as
// untrusted by popup blockers. The X tab is therefore opened SYNCHRONOUSLY
// inside the click handler as about:blank, and only navigated once the
// clipboard work settles. If the card cannot be produced at all, that blank
// tab is closed rather than left behind.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSharePostText,
  buildXIntentUrl,
  resolveShareUrl,
  shareFileName,
  type ResultCardView,
} from "@/lib/resultCard";
import { renderResultCardPng } from "@/lib/resultCardImage";

export type ShareImageStatus = "idle" | "generating" | "ready" | "error";
export type ShareActionStatus = "idle" | "working" | "done" | "error";

export type ResultCardShare = {
  imageStatus: ShareImageStatus;
  /** Object URL for the generated PNG — safe to use as an <img> src. */
  imageUrl: string | null;
  imageError: string | null;
  /** Regenerates the card after a failure. */
  retry: () => void;

  actionStatus: ShareActionStatus;
  /** aria-live text describing preparation and share progress. */
  statusMessage: string | null;

  /** True while a native share sheet is open — the modal must not close. */
  sharing: boolean;

  /** navigator.share can carry the PNG itself on this device. */
  canShareImageNatively: boolean;
  /** navigator.clipboard can hold an image/png on this device. */
  canCopyImage: boolean;
  /** "⌘V" on Apple platforms, "Ctrl+V" elsewhere. */
  pasteHint: string;

  postText: string;
  shareUrl: string;

  /** Primary CTA — native sheet with the file where supported. */
  shareWithImage: () => Promise<void>;
  /** Clipboard (or download) first, then the X composer. */
  shareOnX: () => Promise<void>;
  saveCard: () => void;
  copyPostText: () => Promise<void>;
};

/* -------------------------------------------------------------------------- */
/*  Capability detection                                                       */
/* -------------------------------------------------------------------------- */

type NavigatorWithCanShare = Navigator & { canShare?: (data: ShareData) => boolean };
type WindowWithClipboardItem = Window & { ClipboardItem?: typeof ClipboardItem };

/**
 * Probed with a real one-byte PNG File: canShare({files}) is the only
 * trustworthy signal, and some browsers expose navigator.share while
 * refusing files.
 */
function detectNativeFileShare(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const nav = navigator as NavigatorWithCanShare;
  if (typeof nav.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array([0])], "probe.png", { type: "image/png" });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function detectImageClipboard(): boolean {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  const w = window as WindowWithClipboardItem;
  return typeof w.ClipboardItem === "function" && typeof navigator.clipboard.write === "function";
}

function detectApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "AbortError" || name === "NotAllowedError";
}

async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (!detectImageClipboard()) return false;
  const w = window as WindowWithClipboardItem;
  try {
    await navigator.clipboard.write([new w.ClipboardItem!({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Messages (§7)                                                              */
/* -------------------------------------------------------------------------- */

const MSG_PREPARING = "Preparing result card…";
const MSG_READY = "Result card ready.";
const MSG_OPENING_X = "Opening X…";
const MSG_DOWNLOADED = "Result card downloaded. Attach the PNG to your X post.";
const MSG_FAILED = "Could not prepare the result card. Retry.";
const MSG_SHARED = "Result shared.";

function copiedMessage(pasteHint: string): string {
  return `Result card copied. Press ${pasteHint} to attach it to your X post.`;
}

export function useResultCardShare(view: ResultCardView | null): ResultCardShare {
  const [imageStatus, setImageStatus] = useState<ShareImageStatus>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ShareActionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Capabilities are resolved after mount so the server render and the first
  // client render agree (no hydration mismatch on the helper copy).
  const [canShareImageNatively, setCanShareImageNatively] = useState(false);
  const [canCopyImage, setCanCopyImage] = useState(false);
  const [isApple, setIsApple] = useState(false);

  useEffect(() => {
    setCanShareImageNatively(detectNativeFileShare());
    setCanCopyImage(detectImageClipboard());
    setIsApple(detectApplePlatform());
  }, []);

  const pasteHint = isApple ? "⌘V" : "Ctrl+V";

  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  // Guards a second click while the first share is still in flight — rapid
  // taps must not open two tabs or leak a stale object URL.
  const busyRef = useRef(false);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const shareUrl = view ? resolveShareUrl(view.marketPath) : "";
  const postText = useMemo(
    () => (view ? buildSharePostText(view, shareUrl) : ""),
    [view, shareUrl]
  );

  /** Replaces the cached blob and its object URL as one atomic swap. */
  const adoptBlob = useCallback(
    (blob: Blob) => {
      releaseUrl();
      blobRef.current = blob;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setImageUrl(url);
      setImageStatus("ready");
    },
    [releaseUrl]
  );

  /* ── Pre-generate on open, and again only when the payload changes ────── */
  useEffect(() => {
    if (!view) return;

    let cancelled = false;
    setImageStatus("generating");
    setImageError(null);
    setStatusMessage(MSG_PREPARING);

    void (async () => {
      try {
        const blob = await renderResultCardPng(view);
        if (cancelled) return;
        adoptBlob(blob);
        setStatusMessage(MSG_READY);
      } catch {
        if (cancelled) return;
        blobRef.current = null;
        releaseUrl();
        setImageUrl(null);
        setImageStatus("error");
        setImageError(MSG_FAILED);
        setStatusMessage(MSG_FAILED);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `view` is rebuilt on every render by the caller, so key the effect on the
    // values that actually change the picture rather than on object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view?.mode,
    view?.state,
    view?.marketTitle,
    view?.pickLabel,
    view?.primaryValue,
    view?.primaryLabel,
    view?.verb,
    view?.provisional,
    view?.rows.map((r) => `${r.label}:${r.value}`).join("|"),
    attempt,
    adoptBlob,
    releaseUrl,
  ]);

  useEffect(() => releaseUrl, [releaseUrl]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  /** The cached blob, or a fresh one if pre-generation has not landed yet. */
  const ensureBlob = useCallback(async (): Promise<Blob | null> => {
    if (blobRef.current) return blobRef.current;
    if (!view) return null;
    try {
      const blob = await renderResultCardPng(view);
      adoptBlob(blob);
      return blob;
    } catch {
      setImageStatus("error");
      setImageError(MSG_FAILED);
      return null;
    }
  }, [view, adoptBlob]);

  const downloadBlob = useCallback(
    (blob: Blob) => {
      if (!view) return;
      // Prefer the cached object URL so a download does not mint a second one.
      const href = urlRef.current ?? URL.createObjectURL(blob);
      const temporary = href !== urlRef.current;
      const a = document.createElement("a");
      a.href = href;
      a.download = shareFileName(view);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (temporary) URL.revokeObjectURL(href);
    },
    [view]
  );

  /**
   * Copy-or-download, then X.
   *
   * `target` MUST have been opened synchronously by the caller's click
   * handler — see the POPUP/GESTURE note at the top of this file. Passing it
   * in keeps the one synchronous open at the top of every entry point.
   */
  const runClipboardThenX = useCallback(
    async (target: Window | null) => {
      const blob = await ensureBlob();
      if (!blob) {
        // Nothing to attach — do not dump the user on a text-only composer,
        // and do not leave an empty tab behind.
        if (target) target.close();
        setActionStatus("error");
        setStatusMessage(MSG_FAILED);
        return;
      }

      const copied = await copyBlobToClipboard(blob);
      if (!copied) downloadBlob(blob);

      const intent = buildXIntentUrl(postText);
      if (target) target.location.replace(intent);
      else window.open(intent, "_blank", "noopener,noreferrer");

      setActionStatus("done");
      setStatusMessage(copied ? copiedMessage(pasteHint) : MSG_DOWNLOADED);
    },
    [ensureBlob, postText, downloadBlob, pasteHint]
  );

  /** about:blank in the click's own task, so the popup blocker trusts it. */
  const openPlaceholderWindow = useCallback((): Window | null => {
    const target = window.open("about:blank", "_blank");
    try {
      if (target) target.opener = null;
    } catch {
      /* cross-origin guard — harmless, the tab is still ours to navigate */
    }
    return target;
  }, []);

  const shareWithImage = useCallback(async () => {
    if (!view || busyRef.current) return;

    // Decided BEFORE any await: on a device without native file sharing this
    // is the desktop route, and its X tab has to be opened synchronously.
    const target = canShareImageNatively ? null : openPlaceholderWindow();

    busyRef.current = true;
    setActionStatus("working");
    setStatusMessage(canShareImageNatively ? MSG_PREPARING : MSG_OPENING_X);

    try {
      if (!canShareImageNatively) {
        await runClipboardThenX(target);
        return;
      }

      const blob = await ensureBlob();
      if (!blob) {
        setActionStatus("error");
        setStatusMessage(MSG_FAILED);
        return;
      }

      const file = new File([blob], shareFileName(view), { type: "image/png" });
      const nav = navigator as NavigatorWithCanShare;
      let shareable = false;
      try {
        shareable = typeof nav.canShare === "function" && nav.canShare({ files: [file] });
      } catch {
        shareable = false;
      }

      if (shareable) {
        setSharing(true);
        try {
          // The URL already lives in postText; passing it separately makes
          // some targets show it twice.
          await navigator.share({ files: [file], text: postText });
          setActionStatus("done");
          setStatusMessage(MSG_SHARED);
          return;
        } catch (err) {
          if (isAbort(err)) {
            // Sheet dismissed. Not a failure; the modal stays open and the
            // card is still there to share again.
            setActionStatus("idle");
            setStatusMessage(MSG_READY);
            return;
          }
        } finally {
          setSharing(false);
        }
      }

      // Native share was advertised but refused this file. The clipboard
      // route is the honest fallback, minus the pre-opened tab (activation
      // is already spent, so window.open may be blocked — the message still
      // tells the user what happened to their image).
      await runClipboardThenX(null);
    } finally {
      busyRef.current = false;
    }
  }, [
    view,
    canShareImageNatively,
    openPlaceholderWindow,
    runClipboardThenX,
    ensureBlob,
    postText,
  ]);

  const shareOnX = useCallback(async () => {
    if (!view || busyRef.current) return;
    const target = openPlaceholderWindow();
    busyRef.current = true;
    setActionStatus("working");
    setStatusMessage(MSG_OPENING_X);
    try {
      await runClipboardThenX(target);
    } finally {
      busyRef.current = false;
    }
  }, [view, openPlaceholderWindow, runClipboardThenX]);

  const saveCard = useCallback(() => {
    const blob = blobRef.current;
    if (!blob) return;
    downloadBlob(blob);
    setStatusMessage(MSG_DOWNLOADED);
  }, [downloadBlob]);

  const copyPostText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(postText);
      setStatusMessage("Post text copied.");
    } catch {
      setStatusMessage("Could not copy the text — select it manually to copy.");
    }
  }, [postText]);

  return {
    imageStatus,
    imageUrl,
    imageError,
    retry,
    actionStatus,
    statusMessage,
    sharing,
    canShareImageNatively,
    canCopyImage,
    pasteHint,
    postText,
    shareUrl,
    shareWithImage,
    shareOnX,
    saveCard,
    copyPostText,
  };
}
