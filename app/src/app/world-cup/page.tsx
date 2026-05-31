"use client";

export default function WorldCupPage() {
  return (
    <div className="min-h-[70vh] px-4 py-10 flex items-center justify-center">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 w-24 h-24 rounded-3xl border border-[#EAB54C]/30 bg-[#EAB54C]/10 flex items-center justify-center shadow-[0_0_40px_rgba(234,181,76,0.18)]">
          <span className="text-5xl" aria-hidden="true">🏆</span>
        </div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">
          World Cup Hub
        </h1>
        <p className="mt-2 text-sm text-gray-400">
          Coming Soon
        </p>
      </div>
    </div>
  );
}
