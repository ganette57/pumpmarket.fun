"use client";

// src/components/wallet/RealWalletSelector.tsx
//
// Which wallet Real trades spend from, when there is a choice.
//
// RENDERS NOTHING FOR A NORMAL USER. Someone with only an embedded
// wallet, or only Phantom, has no decision to make, and a "picker" with
// one item is just clutter that implies a complexity that is not there.
// It appears exactly when the user has BOTH.
//
// Balances are read per wallet and shown per wallet. They are never
// added together: two wallets are two piles of money, and a combined
// figure would be a number the user cannot spend.

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { Check } from "lucide-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { formatBalanceSol } from "@/lib/compactBalance";

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export default function RealWalletSelector() {
  const { options, address: activeAddress, select } = useFunMarketWallet();
  const { connection } = useConnection();
  const [lamports, setLamports] = useState<Record<string, number | null>>({});

  // Join the addresses into the dependency so this reruns when the SET of
  // wallets changes, not on every render of a new array with the same
  // contents.
  const key = options.map((o) => o.address).join(",");

  useEffect(() => {
    if (options.length < 2) return;
    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        options.map(async (o) => {
          try {
            const value = await connection.getBalance(
              new PublicKey(o.address),
              "confirmed"
            );
            return [o.address, value] as const;
          } catch {
            // A failed read shows a dash, never a zero: "unknown" and
            // "empty" mean very different things to someone choosing
            // which wallet to trade from.
            return [o.address, null] as const;
          }
        })
      );
      if (!cancelled) setLamports(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connection]);

  if (options.length < 2) return null;

  return (
    <div className="px-1">
      <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Real wallet
      </div>

      <div className="space-y-1">
        {options.map((option) => {
          const isActive = option.address === activeAddress;
          const balance = lamports[option.address];
          return (
            <button
              key={option.address}
              type="button"
              onClick={() => select(option.address)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition ${
                isActive
                  ? "border border-pump-green/40 bg-pump-green/10"
                  : "border border-transparent hover:bg-white/5"
              }`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                  {option.label}
                  {isActive && <Check className="h-3.5 w-3.5 text-pump-green" />}
                </span>
                <span className="block font-mono text-[11px] text-gray-500">
                  {short(option.address)}
                </span>
              </span>

              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-200">
                {balance === undefined
                  ? "…"
                  : formatBalanceSol(balance) ?? "—"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
