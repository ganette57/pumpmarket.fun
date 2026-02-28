"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ContestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Contest page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-xl w-full rounded-2xl border border-white/10 bg-black/30 p-6 text-center">
        <h2 className="text-xl font-bold text-white">Something went wrong on Dispute page</h2>
        <p className="text-sm text-gray-400 mt-2">
          Please go back to the market and try again.
        </p>
        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded-lg bg-pump-green text-black font-semibold"
          >
            Back to market
          </button>
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-lg border border-white/20 text-white"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

