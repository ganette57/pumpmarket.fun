// app/src/components/MarketActions.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabaseClient";
import { Heart, Share2 } from "lucide-react";

type Props = {
  // ✅ compat: ancien prop (parfois c’était l’adresse solana)
  marketId?: string;

  // ✅ nouveaux props
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

  // ✅ On stocke l'id du bookmark (source of truth) -> coeur rempli si non-null
  const [bookmarkRowId, setBookmarkRowId] = useState<string | null>(null);

  // ✅ On stocke le market uuid (markets.id) une seule fois
  const [marketUuid, setMarketUuid] = useState<string | null>(marketDbId ?? null);

  // source of truth: solana address pour share + fallback lookup markets.id
  const address = useMemo(
    () => marketAddress || marketId || "",
    [marketAddress, marketId]
  );

  const userAddress = useMemo(
    () => publicKey?.toBase58() ?? null,
    [publicKey]
  );

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

  // ✅ AU MOUNT / quand wallet ou market change:
  // 1) resolve marketUuid
  // 2) fetch bookmarkRowId
  useEffect(() => {
    let alive = true;

    async function run() {
      if (!userAddress) {
        if (alive) setBookmarkRowId(null);
        return;
      }

      // Resolve market uuid (db id)
      let mid = marketDbId ?? marketUuid ?? null;

      if (!mid) {
        const fallback = await getMarketUuidFallback();
        mid = fallback ?? null;
      }

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
      } catch (e) {
        console.warn("fetch bookmark failed", e);
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

    // optimistic snapshot
    const prev = bookmarkRowId;

    try {
      let mid = marketUuid ?? marketDbId ?? null;
      if (!mid) mid = await getMarketUuidFallback();

      if (!mid) {
        alert("Market not indexed yet (no DB id). Refresh in a few seconds.");
        return;
      }

      // ✅ OPTIMISTIC UI
      if (prev) setBookmarkRowId(null);
      else setBookmarkRowId("optimistic");

      if (prev) {
        // delete by bookmark row id (no re-fetch)
        const { error } = await supabase.from("bookmarks").delete().eq("id", prev);
        if (error) throw error;
        // already null
      } else {
        // insert with ONLY the columns that exist: user_address + market_id
        const { data, error } = await supabase
          .from("bookmarks")
          .insert({ user_address: userAddress, market_id: mid })
          .select("id")
          .single();

        if (error) throw error;
        setBookmarkRowId(data?.id ?? null);
      }
    } catch (e: any) {
      console.error("bookmark error", e);
      // rollback
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

    // Try native share
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
      // user canceled share -> ignore
      return;
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied ✅");
    } catch {
      prompt("Copy link:", url);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Bookmark */}
      <button
        disabled={busy}
        onClick={toggleBookmark}
        className={`w-10 h-10 rounded-full border transition flex items-center justify-center ${
          bookmarked
            ? "border-pump-green bg-pump-green/10"
            : "border-gray-700 hover:border-pump-green"
        }`}
        title={bookmarked ? "Bookmarked" : "Bookmark"}
      >
        <Heart
          className={`w-5 h-5 ${
            bookmarked ? "text-pump-green fill-pump-green" : "text-gray-300"
          }`}
        />
      </button>

      {/* Share */}
      <button
        onClick={share}
        className="w-10 h-10 rounded-full border border-gray-700 hover:border-gray-500 transition flex items-center justify-center"
        title="Share"
      >
        <Share2 className="w-5 h-5 text-gray-300" />
      </button>
    </div>
  );
}