"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

// ⚠️ suppose que tu as déjà ce composant qui ouvre TA pop-up
// (celui que tu utilisais avant dans le header)
import HowItWorksButton from "@/components/HowItWorksModal";

export default function Header() {
  const router = useRouter();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();

  const [query, setQuery] = useState("");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    // adapte l’URL si ton ancienne recherche était ailleurs
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  const accountCircle = useMemo(() => {
    if (!publicKey) return "FM";
    return publicKey.toBase58().slice(0, 2).toUpperCase();
  }, [publicKey]);

  return (
    <header className="sticky top-0 z-50 bg-[#050607]/95 border-b border-[#151515] backdrop-blur">
      <div className="max-w-7xl mx-auto flex items-center gap-4 px-5 py-3">
        {/* LOGO + NAME */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2a2a2a] bg-black/40 text-xs font-bold text-white">
            F
          </div>

          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-white"
          >
            Funmarket.pump
          </Link>
        </div>

        {/* SEARCH BAR */}
        <form
          onSubmit={handleSearch}
          className="flex flex-1 justify-center"
        >
          <div className="w-full max-w-xl flex items-center gap-2 rounded-full bg-[#101214] border border-[#1f2933] px-4 py-2 text-sm">
            <span className="text-gray-500 text-xs">⌕</span>
            <input
              className="flex-1 bg-transparent text-sm text-gray-200 focus:outline-none placeholder:text-gray-500"
              placeholder="Search markets, creators, categories..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </form>

        {/* RIGHT SIDE ACTIONS */}
        <div className="flex items-center gap-3">
          {/* HOW IT WORKS → ta pop-up existante */}
          <HowItWorksButton />

          {/* CREATE MARKET – vert pump.fun */}
          <Link href="/create">
            <button
              className="
                h-10
                rounded-full
                bg-[#00ff88]
                px-5
                text-sm
                font-semibold
                text-black
                hover:bg-[#00e67b]
                transition
              "
            >
              Create
            </button>
          </Link>

          {/* WALLET – rouge pump.fun, ouvre la même modale que WalletMultiButton */}
          <button
            onClick={() => setVisible(true)}
            className="
              h-10
              rounded-full
              bg-[#00ff88]
              px-5
              text-sm
              font-semibold
              text-black
              hover:bg-[#ff2626]
              transition
            "
          >
            {publicKey ? "Wallet" : "Select Wallet"}
          </button>

          {/* DASHBOARD – petit rond à droite, comme Polymarket */}
          {publicKey && (
            <Link
              href="/dashboard"
              className="
                flex
                h-10
                w-10
                items-center
                justify-center
                rounded-full
                bg-[#101214]
                border border-[#222]
                text-white text-xs font-bold
                hover:border-[#00ff88]
              "
            >
              {accountCircle}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}