"use client";

export function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-gray-900 bg-[#050506] p-4 animate-pulse space-y-4">
      <div className="h-32 rounded-xl bg-gradient-to-b from-gray-900/70 to-black/80" />
      <div className="h-4 w-3/4 rounded bg-gray-800" />
      <div className="h-3 w-1/2 rounded bg-gray-800/80" />
      <div className="flex items-center justify-between pt-2 border-t border-gray-900 mt-2">
        <div className="h-3 w-16 rounded bg-gray-800/90" />
        <div className="h-3 w-12 rounded bg-emerald-500/40" />
      </div>
    </div>
  );
}

export function SkeletonFeaturedCard() {
  return (
    <div className="hidden md:flex h-[480px] rounded-3xl border border-gray-900 bg-[#050506] overflow-hidden animate-pulse">
      {/* LEFT */}
      <div className="w-1/2 p-8 flex flex-col gap-4">
        <div className="flex gap-4">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-gray-900/80 to-black/90" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-24 rounded-full bg-black/80 border border-gray-900" />
            <div className="h-6 w-5/6 rounded bg-gray-800" />
            <div className="h-6 w-3/5 rounded bg-gray-800/80" />
          </div>
        </div>

        <div className="flex gap-6 mt-4">
          <div className="h-4 w-28 rounded bg-gray-800/80" />
          <div className="h-4 w-20 rounded bg-gray-800/60" />
        </div>

        <div className="mt-auto space-y-3">
          <div className="h-12 rounded-xl bg-gray-900/80" />
          <div className="h-12 rounded-xl bg-gray-900/80" />
        </div>
      </div>

      {/* RIGHT */}
      <div className="w-1/2 bg-gradient-to-br from-black/80 to-gray-950/90 flex items-center justify-center">
        <div className="w-[90%] h-[70%] rounded-2xl bg-[#050708] border border-gray-900 flex flex-col justify-between p-4">
          <div className="h-3 w-20 rounded bg-gray-800/80" />
          <div className="flex-1 mt-3 rounded-xl bg-gray-900/80" />
          <div className="flex justify-end gap-3 mt-3">
            <div className="h-2 w-10 rounded-full bg-emerald-500/40" />
            <div className="h-2 w-10 rounded-full bg-red-500/40" />
          </div>
        </div>
      </div>
    </div>
  );
}