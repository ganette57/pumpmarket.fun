'use client';

export function SkeletonCard() {
  return (
    <div className="bg-pump-gray border border-gray-800 rounded-xl p-5 animate-pulse">
      <div className="flex gap-4">
        {/* Image skeleton */}
        <div className="flex-shrink-0 w-24 h-24 rounded-lg bg-gray-700/50"></div>

        {/* Content skeleton */}
        <div className="flex-1 py-1">
          {/* Title */}
          <div className="h-5 bg-gray-700/50 rounded w-3/4 mb-2"></div>
          <div className="h-5 bg-gray-700/50 rounded w-full mb-3"></div>

          {/* Description */}
          <div className="h-4 bg-gray-700/30 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-700/30 rounded w-2/3 mb-3"></div>

          {/* YES/NO */}
          <div className="flex gap-3 mt-3 mb-3">
            <div className="h-6 bg-blue-500/10 rounded w-20"></div>
            <div className="h-6 bg-red-500/10 rounded w-20"></div>
          </div>

          {/* Stats */}
          <div className="flex gap-2">
            <div className="h-3 bg-gray-700/30 rounded w-16"></div>
            <div className="h-3 bg-gray-700/30 rounded w-16"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkeletonFeaturedCard() {
  return (
    <div className="bg-pump-gray border border-gray-700 rounded-xl overflow-hidden animate-pulse">
      {/* Desktop */}
      <div className="hidden md:flex h-[500px]">
        {/* Left */}
        <div className="flex-1 p-8 flex flex-col">
          <div className="flex gap-6 flex-1">
            {/* Image */}
            <div className="flex-shrink-0 w-32 h-32 rounded-xl bg-gray-700/50"></div>

            {/* Content */}
            <div className="flex-1 flex flex-col">
              {/* Category */}
              <div className="h-6 bg-blue-500/10 rounded-full w-20 mb-3"></div>

              {/* Title */}
              <div className="h-8 bg-gray-700/50 rounded w-full mb-2"></div>
              <div className="h-8 bg-gray-700/50 rounded w-3/4 mb-4"></div>

              {/* Creator */}
              <div className="h-4 bg-gray-700/30 rounded w-48 mb-6"></div>

              {/* Stats */}
              <div className="flex gap-6 mb-6">
                <div className="h-4 bg-gray-700/30 rounded w-24"></div>
                <div className="h-4 bg-gray-700/30 rounded w-24"></div>
              </div>

              {/* YES/NO */}
              <div className="flex gap-4 mt-auto">
                <div className="flex-1 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
                  <div className="h-4 bg-blue-500/20 rounded w-12 mb-2"></div>
                  <div className="h-10 bg-blue-500/20 rounded w-24"></div>
                </div>
                <div className="flex-1 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
                  <div className="h-4 bg-red-500/20 rounded w-12 mb-2"></div>
                  <div className="h-10 bg-red-500/20 rounded w-24"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right - Chart */}
        <div className="w-[40%] bg-pump-dark/50 p-6 border-l border-gray-800">
          <div className="h-4 bg-gray-700/30 rounded w-32 mb-4"></div>
          <div className="h-64 bg-gray-700/20 rounded"></div>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden p-5">
        <div className="flex gap-4 mb-4">
          <div className="flex-shrink-0 w-24 h-24 rounded-xl bg-gray-700/50"></div>
          <div className="flex-1">
            <div className="h-5 bg-blue-500/10 rounded-full w-16 mb-2"></div>
            <div className="h-5 bg-gray-700/50 rounded w-full mb-1"></div>
            <div className="h-5 bg-gray-700/50 rounded w-3/4"></div>
          </div>
        </div>

        <div className="flex gap-4 mb-4">
          <div className="h-3 bg-gray-700/30 rounded w-20"></div>
          <div className="h-3 bg-gray-700/30 rounded w-20"></div>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="flex-1 bg-blue-500/10 rounded-lg h-20"></div>
          <div className="flex-1 bg-red-500/10 rounded-lg h-20"></div>
        </div>

        <div className="bg-pump-dark/50 p-4 rounded-lg border border-gray-800 h-48"></div>
      </div>
    </div>
  );
}
