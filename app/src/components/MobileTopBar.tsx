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

  useEffect(() => {
    setQ(sp.get("q") || "");
  }, [sp]);

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
      <div className="fixed top-0 left-0 right-0 z-[70] border-b border-gray-800 bg-black/80 backdrop-blur">
        {/* Row 1 */}
        <div className="px-4 py-2 flex items-center gap-3">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img
              src="/logo2.png"
              alt="FunMarket"
              className="h-12 w-12 shrink-0 object-contain"
            />

            <div className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-white truncate">
                FunMarket
              </span>

              <span className="shrink-0 px-2 py-0.5 text-[9px] font-bold uppercase rounded-full bg-pump-green text-black">
                beta
              </span>
            </div>
          </Link>

          {/* Wallet – ultra compact */}
          <div className="shrink-0">
            <WalletMultiButton
              className={[
                "!h-8 !rounded-lg !bg-pump-green !text-black",
                "!px-2 !text-xs !font-semibold",
                "!min-w-0 !max-w-[96px]",
                "truncate",
              ].join(" ")}
            />
          </div>
        </div>

        {/* Search */}
        {showSearch && (
          <div className="px-4 pb-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="Search markets…"
                className="w-full rounded-xl bg-black/40 border border-gray-800 px-4 py-3 text-sm text-white placeholder:text-gray-500 outline-none focus:border-pump-green/60"
              />

              <button
                type="button"
                onClick={() => submit()}
                className="rounded-xl px-4 py-3 text-sm font-extrabold bg-pump-green text-black"
              >
                Go
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className={showSearch ? "h-[112px]" : "h-[52px]"} />
    </>
  );
}