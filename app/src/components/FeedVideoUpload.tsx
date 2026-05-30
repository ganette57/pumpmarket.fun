"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, X, Video, Image as ImageIcon } from "lucide-react";

export const FEED_VIDEO_MAX_SIZE_MB = 8;
export const FEED_VIDEO_MAX_SIZE_BYTES = FEED_VIDEO_MAX_SIZE_MB * 1024 * 1024;

const THUMBNAIL_MAX_DIMENSION = 720;

interface FeedVideoUploadProps {
  file: File | null;
  previewUrl: string;
  thumbnailBlob: Blob | null;
  onChange: (file: File | null, previewUrl: string, thumbnailBlob: Blob | null) => void;
}

async function generateThumbnail(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* noop */
      }
    };

    let settled = false;
    const finish = (result: { blob: Blob; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timeout = setTimeout(() => finish(null), 8000);

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration) {
        clearTimeout(timeout);
        return finish(null);
      }
      const target = Math.min(0.5, duration * 0.1);
      try {
        video.currentTime = Math.max(0, target);
      } catch {
        clearTimeout(timeout);
        return finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        if (!vw || !vh) {
          clearTimeout(timeout);
          return finish(null);
        }
        const scale = Math.min(1, THUMBNAIL_MAX_DIMENSION / Math.max(vw, vh));
        const w = Math.max(1, Math.round(vw * scale));
        const h = Math.max(1, Math.round(vh * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          clearTimeout(timeout);
          return finish(null);
        }
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timeout);
            if (!blob) return finish(null);
            finish({ blob, width: w, height: h });
          },
          "image/jpeg",
          0.85
        );
      } catch {
        clearTimeout(timeout);
        finish(null);
      }
    };

    video.onerror = () => {
      clearTimeout(timeout);
      finish(null);
    };

    video.src = url;
  });
}

export default function FeedVideoUpload({
  file,
  previewUrl,
  thumbnailBlob,
  onChange,
}: FeedVideoUploadProps) {
  const [error, setError] = useState<string>("");
  const [thumbnailing, setThumbnailing] = useState(false);
  const objectUrlRef = useRef<string>("");

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    setError("");

    if (!f.type.startsWith("video/")) {
      setError("File must be a video.");
      return;
    }

    if (f.size > FEED_VIDEO_MAX_SIZE_BYTES) {
      setError(`Video must be smaller than ${FEED_VIDEO_MAX_SIZE_MB} MB.`);
      return;
    }

    const url = URL.createObjectURL(f);

    const duration = await new Promise<number>((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve(Number.isFinite(video.duration) ? video.duration : 0);
      };
      video.onerror = () => resolve(0);
      video.src = url;
    });

    if (!duration || !Number.isFinite(duration)) {
      URL.revokeObjectURL(url);
      setError("Could not read video. Try a different file.");
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;

    onChange(f, url, null);

    setThumbnailing(true);
    let thumb: Blob | null = null;
    try {
      const result = await generateThumbnail(f);
      thumb = result?.blob ?? null;
    } catch {
      thumb = null;
    }
    setThumbnailing(false);
    onChange(f, url, thumb);
  };

  const handleRemove = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
    setError("");
    setThumbnailing(false);
    onChange(null, "", null);
  };

  return (
    <div>
      <label className="block text-white font-semibold mb-2">Feed Video (Optional)</label>
      <p className="text-xs text-gray-500 mb-3">Add a short vertical video.</p>

      {!previewUrl ? (
        <>
          <div className="flex flex-col items-center justify-center w-full border-2 border-dashed border-gray-700 rounded-lg bg-pump-dark/50 px-4 py-6">
            <Upload className="w-9 h-9 text-gray-500 mb-2" />
            <p className="text-xs text-gray-500 mb-4">Vertical video recommended</p>
            <div className="flex w-full gap-3">
              {/* Upload from library — no `capture`, so mobile shows the
                  Photos/Files picker (does NOT force the camera). */}
              <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-700 bg-pump-dark text-sm font-semibold text-pump-green cursor-pointer hover:border-pump-green transition-colors">
                Upload video
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFile}
                  className="hidden"
                />
              </label>
              {/* Record — opt-in camera capture only when the user chooses it. */}
              <label className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-gray-700 bg-pump-dark text-sm font-semibold text-gray-300 cursor-pointer hover:border-pump-green transition-colors">
                Record video
                <input
                  type="file"
                  accept="video/*"
                  capture="environment"
                  onChange={handleFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          {error && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {error}</p>}
        </>
      ) : (
        <>
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0 w-40 sm:w-48 aspect-[9/16] rounded-lg overflow-hidden bg-black border border-gray-700">
              <video
                src={previewUrl}
                playsInline
                muted
                loop
                autoPlay
                controls
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={handleRemove}
                className="absolute top-2 right-2 w-8 h-8 bg-pump-red hover:bg-red-600 rounded-full flex items-center justify-center transition-colors shadow-lg"
                title="Remove video"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            <div className="flex-1 min-w-0 text-sm">
              <div className="flex items-center gap-2 text-gray-300">
                <Video className="w-4 h-4 text-pump-green" />
                <span className="truncate">{file?.name || "Video"}</span>
              </div>
              {file && (
                <div className="mt-1 text-xs text-gray-500">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </div>
              )}
              <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                <ImageIcon className="w-3.5 h-3.5" />
                {thumbnailing ? (
                  <span className="text-gray-400">Generating thumbnail…</span>
                ) : thumbnailBlob ? (
                  <span className="text-pump-green">Thumbnail ready</span>
                ) : (
                  <span className="text-gray-500">No thumbnail</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleRemove}
                className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 text-white hover:bg-white/15 transition"
              >
                Remove
              </button>
            </div>
          </div>
          {error && <p className="text-pump-red text-sm mt-2 font-semibold">❌ {error}</p>}
        </>
      )}
    </div>
  );
}
