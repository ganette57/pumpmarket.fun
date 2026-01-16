"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabaseClient";
import { Bookmark, Share2 } from "lucide-react";

type Props = {
  // compat ancien prop
  marketId?: string;

  // nouveaux props
  marketAddress?: string; // adresse solana
  marketDbId?: string | null; // uuid markets.id

  question: string;
};

export default function MarketActions({
  marketId,
  marketAddress,
  marketDbId,
  question,
}: Props) {
  const { publicKey } = useWallet();

  const [busy, setBusy] = useState(false);
  const [bookmarkRowId, setBookmarkRowId] = useState<string | null>(null);
  const [marketUuid, setMarketUuid] = useState<string | null>(marketDbId ?? null);

  const address = useMemo(() => marketAddress || marketId || "", [marketAddress, marketId]);
  const userAddress = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const bookmarked = !!bookmarkRowId;

  async function getMarketUuidFallback(): Promise<string | null> {
    if (!address) return null;
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("id")
        .eq("market_address", address)
        .maybeSingle();

      if (error) return null;
      return data?.id ?? null;
    } catch {
      return null;
    }
  }

  async function fetchBookmarkRowId(params: { user: string; mid: string }) {
    const { user, mid } = params;

    const { data, error } = await supabase
      .from("bookmarks")
      .select("id")
      .eq("user_address", user)
      .eq("market_id", mid)
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  }

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!userAddress) {
        if (alive) setBookmarkRowId(null);
        return;
      }

      let mid = marketDbId ?? marketUuid ?? null;
      if (!mid) mid = await getMarketUuidFallback();

      if (!alive) return;

      setMarketUuid(mid);

      if (!mid) {
        setBookmarkRowId(null);
        return;
      }

      try {
        const rowId = await fetchBookmarkRowId({ user: userAddress, mid });
        if (!alive) return;
        setBookmarkRowId(rowId);
      } catch {
        if (!alive) return;
        setBookmarkRowId(null);
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress, marketDbId, address]);

  async function toggleBookmark() {
    if (!userAddress) return alert("Connect your wallet");
    if (!address) return;

    setBusy(true);
    const prev = bookmarkRowId;

    try {
      let mid = marketUuid ?? marketDbId ?? null;
      if (!mid) mid = await getMarketUuidFallback();

      if (!mid) {
        alert("Market not indexed yet (no DB id). Refresh in a few seconds.");
        return;
      }

      // optimistic
      if (prev) setBookmarkRowId(null);
      else setBookmarkRowId("optimistic");

      if (prev) {
        const { error } = await supabase.from("bookmarks").delete().eq("id", prev);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("bookmarks")
          .insert({ user_address: userAddress, market_id: mid })
          .select("id")
          .single();

        if (error) throw error;
        setBookmarkRowId(data?.id ?? null);
      }
    } catch (e: any) {
      setBookmarkRowId(prev);
      alert(e?.message || "Bookmark failed");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!address) return;

    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/trade/${address}`
        : `/trade/${address}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Funmarket",
          text: question,
          url,
        });
        return;
      }
    } catch {
      return; // user cancelled
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied ✅");
    } catch {
      prompt("Copy link:", url);
    }
  }

  return (
    <div className="flex items-center gap-3 shrink-0">
      {/* Bookmark (no circle, clean like Polymarket) */}
      <button
        type="button"
        disabled={busy}
        onClick={toggleBookmark}
        className={[
          "p-2 rounded-lg transition",
          "hover:bg-white/5 active:scale-[0.98]",
          bookmarked ? "text-pump-green" : "text-gray-300",
          busy ? "opacity-60" : "",
        ].join(" ")}
        title={bookmarked ? "Bookmarked" : "Bookmark"}
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark market"}
      >
        <Bookmark
          className="w-6 h-6"
          fill={bookmarked ? "currentColor" : "none"}
        />
      </button>

      {/* Share */}
      <button
        type="button"
        onClick={share}
        className="p-2 rounded-lg text-gray-300 hover:bg-white/5 active:scale-[0.98] transition"
        title="Share"
        aria-label="Share market"
      >
        <Share2 className="w-6 h-6" />
      </button>
    </div>
  );
}