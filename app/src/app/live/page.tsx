// src/app/live/page.tsx
"use client";

export default function LivePage() {
  return (
    <div className="min-h-[70vh] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 w-20 h-20 rounded-3xl border border-pump-green/30 bg-pump-green/10 flex items-center justify-center shadow-[0_0_40px_rgba(97,255,154,0.18)] animate-[pulseGlow_1.4s_ease-in-out_infinite]">
          {/* same live icon as navbar, bigger */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-10 h-10 text-pump-green"
          >
            <circle cx="12" cy="12" r="2" />
            <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
            <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          Streaming mode
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-sm text-gray-400">
          Coming soon.
        </p>

        {/* Small hint card (optional but clean) */}
        
          <div className="text-sm text-gray-200 font-semibold">
            Live drops, crowd trades, instant hype.
          
        </div>

        <style jsx>{`
          @keyframes pulseGlow {
            0% {
              transform: translateY(0) scale(1);
              box-shadow: 0 0 0 rgba(97, 255, 154, 0.0);
            }
            50% {
              transform: translateY(-1px) scale(1.02);
              box-shadow: 0 0 28px rgba(97, 255, 154, 0.28);
            }
            100% {
              transform: translateY(0) scale(1);
              box-shadow: 0 0 0 rgba(97, 255, 154, 0.0);
            }
          }
        `}</style>
      </div>
    </div>
  );
}