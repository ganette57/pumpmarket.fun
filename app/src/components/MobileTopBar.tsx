// src/components/MobileTopBar.tsx
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function MobileTopBar({ showSearch }: { showSearch: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();

  const initialQ = useMemo(() => sp.get("q") || "", [sp]);
  const [q, setQ] = useState(initialQ);

  const inputRef = useRef<HTMLInputElement | null>(null);

  // keep local input synced when querystring changes
  useEffect(() => {
    setQ(sp.get("q") || "");
  }, [sp]);

  // auto-focus when arriving on /search
  useEffect(() => {
    if (!showSearch) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [showSearch]);

  function submit(next?: string) {
    const value = (next ?? q).trim();
    router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
  }

  return (
    <>
      {/* Fixed top bar */}
      <div className="fixed top-0 left-0 right-0 z-[70] border-b border-gray-800 bg-black/80 backdrop-blur">
        {/* Row 1 */}
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-0.5 min-w-0">
          <img
  src="/logo2.png"
  alt="FunMarket"
  className="h-12 w-12 shrink-0 object-contain"
/>

            <div className="leading-tight min-w-0">
            <div className="flex items-center gap-2 min-w-0">
  <div className="font-semibold text-white truncate">FunMarket</div>
  <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-pump-green text-black">
    beta
  </span>
</div>             
            </div>
          </Link>

          {/* Real wallet button (Wallet Adapter) */}
          <div className="shrink-0">
            <WalletMultiButton className="!h-10 !px-3 !rounded-xl !bg-pump-green !text-black hover:!opacity-90 !font-semibold" />
          </div>
        </div>

        {/* Row 2: Search only when active */}
        {showSearch && (
          <div className="px-4 pb-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Search markets, creators, categories…"
                className="w-full rounded-xl bg-black/40 border border-gray-800 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none focus:border-pump-green/60"
              />

              <button
                type="button"
                onClick={() => submit()}
                className="rounded-xl px-4 py-3 text-sm font-extrabold bg-pump-green text-black hover:opacity-90 transition"
              >
                Go
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer so page content doesn't hide under fixed bar */}
      <div className={showSearch ? "h-[124px]" : "h-[60px]"} />
    </>
  );
}