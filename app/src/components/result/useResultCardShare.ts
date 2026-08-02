"use client";

// src/components/result/useResultCardShare.ts
//
// The share lifecycle for a result card: generate once, then share it through
// whichever channel the browser actually supports.
//
// Honesty rules baked in here:
//  - an X web intent CANNOT attach a local image, so the desktop path copies
//    the PNG to the clipboard FIRST and tells the user to paste it. It never
//    implies the card travelled with the intent.
//  - every failure surfaces a message and a retry. Nothing fails silently.
//  - a cancelled native share sheet is not an error — it returns to idle.
//  - object URLs are revoked when the card is regenerated and on unmount.

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Live-region text describing generation and share progress. */
  statusMessage: string | null;

  /** True while a native share sheet is open — the modal must not close. */
  sharing: boolean;

  postText: string;
  shareUrl: string;

  /** Primary CTA: native sheet where supported, clipboard + X intent otherwise. */
  shareResult: () => Promise<void>;
  /** Copies the card, then opens the X composer. */
  shareOnX: () => Promise<void>;
  /** Final fallbacks. */
  saveCard: () => void;
  copyPostText: () => Promise<void>;
};

function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

function isAbort(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    ((err as { name?: string }).name === "AbortError" ||
      (err as { name?: string }).name === "NotAllowedError")
  );
}

async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  const w = window as Window & { ClipboardItem?: typeof ClipboardItem };
  if (typeof w.ClipboardItem !== "function" || typeof navigator.clipboard.write !== "function") {
    return false;
  }
  try {
    await navigator.clipboard.write([new w.ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}

export function useResultCardShare(view: ResultCardView | null): ResultCardShare {
  const [imageStatus, setImageStatus] = useState<ShareImageStatus>("idle");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ShareActionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const blobRef = useRef<Blob | null>(null);
  const urlRef = useRef<string | null>(null);
  // Guards against a second click while the first share is still in flight —
  // rapid taps must not open two sheets or leak a stale object URL.
  const busyRef = useRef(false);

  const releaseUrl = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const shareUrl = view ? resolveShareUrl(view.marketPath) : "";
  const postText = view ? buildSharePostText(view, shareUrl) : "";

  /* ── Generate the PNG whenever the result changes ─────────────────────── */
  useEffect(() => {
    if (!view) return;

    let cancelled = false;
    setImageStatus("generating");
    setImageError(null);
    setStatusMessage("Generating your result card…");

    void (async () => {
      try {
        const blob = await renderResultCardPng(view);
        if (cancelled) return;
        releaseUrl();
        blobRef.current = blob;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setImageUrl(url);
        setImageStatus("ready");
        setStatusMessage("Result card ready.");
      } catch (e) {
        if (cancelled) return;
        blobRef.current = null;
        releaseUrl();
        setImageUrl(null);
        setImageStatus("error");
        const message =
          e instanceof Error && e.message ? e.message : "The result card could not be generated.";
        setImageError(message);
        setStatusMessage(message);
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
    view?.verb,
    view?.rows.map((r) => `${r.label}:${r.value}`).join("|"),
    attempt,
    releaseUrl,
  ]);

  useEffect(() => releaseUrl, [releaseUrl]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  const ensureBlob = useCallback(async (): Promise<Blob | null> => {
    if (blobRef.current) return blobRef.current;
    if (!view) return null;
    try {
      const blob = await renderResultCardPng(view);
      blobRef.current = blob;
      releaseUrl();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setImageUrl(url);
      setImageStatus("ready");
      return blob;
    } catch {
      setImageStatus("error");
      setImageError("The result card could not be generated.");
      return null;
    }
  }, [view, releaseUrl]);

  const openXIntent = useCallback(() => {
    if (typeof window === "undefined") return;
    window.open(buildXIntentUrl(postText), "_blank", "noopener,noreferrer");
  }, [postText]);

  const shareResult = useCallback(async () => {
    if (!view || busyRef.current) return;
    busyRef.current = true;
    setActionStatus("working");
    setStatusMessage("Preparing your result card…");

    try {
      const blob = await ensureBlob();
      if (!blob) {
        setActionStatus("error");
        setStatusMessage("Could not generate the card. Retry, or copy the post text instead.");
        return;
      }

      const file = new File([blob], shareFileName(view), { type: "image/png" });

      if (canShareFiles([file])) {
        setSharing(true);
        try {
          await navigator.share({ files: [file], text: postText });
          setActionStatus("done");
          setStatusMessage("Shared.");
          return;
        } catch (err) {
          if (isAbort(err)) {
            setActionStatus("idle");
            setStatusMessage(null);
            return;
          }
          // Fall through to the desktop path below.
        } finally {
          setSharing(false);
        }
      }

      const copied = await copyBlobToClipboard(blob);
      openXIntent();
      setActionStatus("done");
      setStatusMessage(
        copied
          ? "Result card copied — paste it into your X post."
          : "X opened with your post text. Use “Save result card” to attach the image."
      );
    } finally {
      busyRef.current = false;
    }
  }, [view, ensureBlob, postText, openXIntent]);

  const shareOnX = useCallback(async () => {
    if (!view || busyRef.current) return;
    busyRef.current = true;
    setActionStatus("working");
    setStatusMessage("Preparing your post…");
    try {
      const blob = await ensureBlob();
      const copied = blob ? await copyBlobToClipboard(blob) : false;
      openXIntent();
      setActionStatus("done");
      setStatusMessage(
        copied
          ? "Result card copied — paste it into your X post."
          : "X opened with your post text. Use “Save result card” to attach the image."
      );
    } finally {
      busyRef.current = false;
    }
  }, [view, ensureBlob, openXIntent]);

  const saveCard = useCallback(() => {
    if (!view || !urlRef.current) return;
    const a = document.createElement("a");
    a.href = urlRef.current;
    a.download = shareFileName(view);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatusMessage("Result card saved.");
  }, [view]);

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
    postText,
    shareUrl,
    shareResult,
    shareOnX,
    saveCard,
    copyPostText,
  };
}
