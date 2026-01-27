"use client";

import Image from "next/image";

export default function LeaderboardPage() {
  return (
    <div className="min-h-[70vh] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        {/* Pulsing Image */}
        <div className="mx-auto mb-6 w-24 h-24 rounded-3xl border border-pump-green/30 bg-pump-green/10 flex items-center justify-center shadow-[0_0_40px_rgba(97,255,154,0.18)] animate-[pulseGlow_1.4s_ease-in-out_infinite] overflow-hidden">
          <Image
            src="/leader.png"
            alt="Leaderboard"
            width={64}
            height={64}
            className="object-contain"
            priority
          />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          Leaderboard
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-sm text-gray-400">
          Coming soon.
        </p>

        {/* Hint */}
        <div className="mt-4 text-sm text-gray-200 font-semibold">
          Earn FunPoints. Top traders. Real reputation. Pure signal.
        </div>

        {/* Animation */}
        <style jsx>{`
          @keyframes pulseGlow {
            0% {
              transform: translateY(0) scale(1);
              box-shadow: 0 0 0 rgba(97, 255, 154, 0);
            }
            50% {
              transform: translateY(-1px) scale(1.03);
              box-shadow: 0 0 28px rgba(97, 255, 154, 0.28);
            }
            100% {
              transform: translateY(0) scale(1);
              box-shadow: 0 0 0 rgba(97, 255, 154, 0);
            }
          }
        `}</style>
      </div>
    </div>
  );
}