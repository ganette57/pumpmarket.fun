"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, Heart, MessageCircle, Share2 } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabaseClient";

type CreatorProfile = {
  display_name?: string | null;
  avatar_url?: string | null;
} | null;

type HomeFeedActionRailProps = {
  marketAddress: string;
  marketDbId?: string | null;
  question: string;
  creatorAddress?: string | null;
  creatorProfile?: CreatorProfile;
  commentsCount?: number | null;
  onOpenComments: () => void;
};

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.max(0, Math.floor(value)));
}

function shortAddr(addr?: string | null): string {
  if (!addr) return "FM";
  return addr.length > 8 ? `${addr.slice(0, 2)}${addr.slice(-2)}` : addr.slice(0, 4);
}

function isLikeTableMissing(error: any): boolean {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return code === "42p01" || msg.includes("relation") && msg.includes("does not exist");
}

export default function HomeFeedActionRail({
  marketAddress,
  marketDbId = null,
  question,
  creatorAddress,
  creatorProfile = null,
  commentsCount = null,
  onOpenComments,
}: HomeFeedActionRailProps) {
  const { publicKey } = useWallet();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [remoteLikeRowId, setRemoteLikeRowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookmarkRowId, setBookmarkRowId] = useState<string | null>(null);
  const likeMarketIdRef = useRef<string | null>(null);
  const userAddress = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const bookmarked = !!bookmarkRowId;

  async function resolveLikeMarketId(): Promise<string | null> {
    if (likeMarketIdRef.current) return likeMarketIdRef.current;
    let mid = marketDbId ?? null;
    if (!mid) mid = await getMarketUuidFallback();
    likeMarketIdRef.current = mid ?? null;
    return likeMarketIdRef.current;
  }

  async function loadLikeSnapshot(marketId: string, walletAddress: string | null) {
    const countRes = await supabase
      .from("market_likes")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId);
    if (countRes.error) return { ok: false as const, error: countRes.error };

    if (!walletAddress) {
      return {
        ok: true as const,
        count: Number(countRes.count || 0),
        rowId: null,
      };
    }

    const userRes = await supabase
      .from("market_likes")
      .select("id")
      .eq("market_id", marketId)
      .eq("wallet_address", walletAddress)
      .maybeSingle();
    if (userRes.error) return { ok: false as const, error: userRes.error };

    return {
      ok: true as const,
      count: Number(countRes.count || 0),
      rowId: userRes.data?.id ?? null,
    };
  }

  useEffect(() => {
    setLiked(false);
    setLikeCount(0);
    setRemoteLikeRowId(null);
    likeMarketIdRef.current = null;

    let cancelled = false;

    (async () => {
      if (!marketAddress) return;

      const marketId = await resolveLikeMarketId();
      if (!marketId || cancelled) return;

      const snap = await loadLikeSnapshot(marketId, userAddress);
      if (!snap.ok) {
        if (isLikeTableMissing(snap.error)) return;
        return;
      }

      if (cancelled) return;
      setRemoteLikeRowId(snap.rowId);
      setLiked(!!snap.rowId);
      setLikeCount(snap.count);
    })();

    return () => {
      cancelled = true;
    };
  }, [marketAddress, marketDbId, userAddress]);

  async function toggleLike() {
    if (likeBusy) return;
    if (!userAddress) {
      alert("Connect your wallet");
      return;
    }

    const prevLiked = liked;
    const prevCount = likeCount;
    const prevRowId = remoteLikeRowId;
    const nextLiked = !prevLiked;

    setLiked(nextLiked);
    setLikeCount((v) => Math.max(0, v + (nextLiked ? 1 : -1)));
    setLikeBusy(true);

    try {
      const marketId = await resolveLikeMarketId();
      if (!marketId) {
        throw new Error("Market not indexed yet. Try again in a few seconds.");
      }

      if (nextLiked) {
        const { data, error } = await supabase
          .from("market_likes")
          .insert({ wallet_address: userAddress, market_id: marketId })
          .select("id")
          .single();
        if (error) throw error;
        setRemoteLikeRowId(data?.id ?? null);
      } else {
        if (prevRowId) {
          const { error } = await supabase.from("market_likes").delete().eq("id", prevRowId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("market_likes")
            .delete()
            .eq("wallet_address", userAddress)
            .eq("market_id", marketId);
          if (error) throw error;
        }
        setRemoteLikeRowId(null);
      }
    } catch (e: any) {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      setRemoteLikeRowId(prevRowId);
      alert(e?.message || "Like failed");
    } finally {
      setLikeBusy(false);
    }
  }

  async function getMarketUuidFallback(): Promise<string | null> {
    if (!marketAddress) return null;
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("id")
        .eq("market_address", marketAddress)
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

      let mid = marketDbId ?? null;
      if (!mid) mid = await getMarketUuidFallback();
      if (!alive) return;

      if (!mid) {
        setBookmarkRowId(null);
        return;
      }

      try {
        const rowId = await fetchBookmarkRowId({ user: userAddress, mid });
        if (alive) setBookmarkRowId(rowId);
      } catch {
        if (alive) setBookmarkRowId(null);
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress, marketAddress, marketDbId]);

  async function toggleBookmark() {
    if (!userAddress) return alert("Connect your wallet");
    if (!marketAddress) return;

    setBusy(true);
    const prev = bookmarkRowId;

    try {
      let mid = marketDbId ?? null;
      if (!mid) mid = await getMarketUuidFallback();
      if (!mid) {
        alert("Market not indexed yet. Try again in a few seconds.");
        return;
      }

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
    if (!marketAddress) return;
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/trade/${marketAddress}`
        : `/trade/${marketAddress}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "FunMarket",
          text: question,
          url,
        });
        return;
      }
    } catch {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied ✅");
    } catch {
      prompt("Copy link:", url);
    }
  }

  const avatarUrl = String(creatorProfile?.avatar_url || "").trim() || null;
  const avatarLabel =
    String(creatorProfile?.display_name || "").trim() ||
    (creatorAddress ? `${creatorAddress.slice(0, 4)}…${creatorAddress.slice(-4)}` : "Creator");

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-1.5">
        <div className="relative">
          <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-[#61ff9a] via-[#8ee6ff] to-[#ff7ab6] opacity-80" />
          <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-black/60 bg-black/60 text-white shadow-lg">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={avatarLabel} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-bold uppercase">{shortAddr(creatorAddress)}</span>
            )}
          </div>
        </div>
        <span className="max-w-[58px] truncate text-[10px] font-semibold leading-none text-white/85">
          {avatarLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void toggleLike()}
        className="group flex flex-col items-center gap-1.5"
        aria-label="Like market"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md transition group-active:scale-95">
          <Heart className={`h-5 w-5 ${liked ? "fill-[#ff4d6d] text-[#ff4d6d]" : "text-white"}`} />
        </span>
        <span className="text-[11px] font-semibold leading-none text-white/90">{compactCount(likeCount)}</span>
      </button>

      <button
        type="button"
        onClick={onOpenComments}
        className="group flex flex-col items-center gap-1.5"
        aria-label="Open comments"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md transition group-active:scale-95">
          <MessageCircle className="h-5 w-5 text-white" />
        </span>
        <span className="text-[11px] font-semibold leading-none text-white/90">
          {commentsCount == null ? "…" : compactCount(commentsCount)}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void toggleBookmark()}
        disabled={busy}
        className="group flex flex-col items-center gap-1.5"
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark market"}
      >
        <span className={`flex h-11 w-11 items-center justify-center rounded-full border bg-black/45 shadow-lg backdrop-blur-md transition group-active:scale-95 ${
          bookmarked ? "border-[#61ff9a]/80 text-[#61ff9a]" : "border-white/20 text-white"
        }`}>
          <Bookmark className="h-5 w-5" fill={bookmarked ? "currentColor" : "none"} />
        </span>
        <span className={`text-[11px] font-semibold leading-none ${bookmarked ? "text-[#61ff9a]" : "text-white/90"}`}>
          {bookmarked ? "Saved" : "Save"}
        </span>
      </button>

      <button
        type="button"
        onClick={() => void share()}
        className="group flex flex-col items-center gap-1.5"
        aria-label="Share market"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white shadow-lg backdrop-blur-md transition group-active:scale-95">
          <Share2 className="h-5 w-5 text-white" />
        </span>
        <span className="text-[11px] font-semibold leading-none text-white/90">Share</span>
      </button>
    </div>
  );
}
