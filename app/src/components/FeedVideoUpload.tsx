"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, X, Video } from "lucide-react";

export const FEED_VIDEO_MAX_DURATION_SEC = 8;
export const FEED_VIDEO_MAX_SIZE_MB = 8;
export const FEED_VIDEO_MAX_SIZE_BYTES = FEED_VIDEO_MAX_SIZE_MB * 1024 * 1024;

interface FeedVideoUploadProps {
  file: File | null;
  previewUrl: string;
  onChange: (file: File | null, previewUrl: string) => void;
}

export default function FeedVideoUpload({ file, previewUrl, onChange }: FeedVideoUploadProps) {
  const [error, setError] = useState<string>("");
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

    if (duration > FEED_VIDEO_MAX_DURATION_SEC + 0.5) {
      URL.revokeObjectURL(url);
      setError(`Video must be ${FEED_VIDEO_MAX_DURATION_SEC} seconds or shorter (got ${duration.toFixed(1)}s).`);
      return;
    }

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    onChange(f, url);
  };

  const handleRemove = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }
    setError("");
    onChange(null, "");
  };

  return (
    <div>
      <label className="block text-white font-semibold mb-2">Feed Video (Optional)</label>
      <p className="text-xs text-gray-500 mb-3">Add a short vertical video.</p>

      {!previewUrl ? (
        <>
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-700 rounded-lg cursor-pointer hover:border-pump-green transition-colors bg-pump-dark/50">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-10 h-10 text-gray-500 mb-2" />
              <p className="text-sm text-gray-400 mb-1">
                <span className="font-semibold text-pump-green">Upload / Record video</span>
              </p>
              <p className="text-xs text-gray-500">
                Max {FEED_VIDEO_MAX_DURATION_SEC} sec · Vertical recommended
              </p>
            </div>
            <input
              type="file"
              accept="video/*"
              capture="environment"
              onChange={handleFile}
              className="hidden"
            />
          </label>
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
